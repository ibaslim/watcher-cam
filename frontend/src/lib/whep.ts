/**
 * Minimal WHEP (WebRTC-HTTP Egress Protocol) client for MediaMTX.
 *
 * MediaMTX exposes each published path as:
 *   POST http://<host>:8889/<path>/whep   body: SDP offer   returns: SDP answer
 *
 * We only consume (receive audio/video), so the peer connection is recvonly.
 */

export type WhepHandle = { stop: () => Promise<void> };
export type WhepState = "connecting" | "live" | "error";

export async function startWhep(
  mediamtxUrl: string,
  path: string,
  video: HTMLVideoElement,
  onStateChange?: (state: WhepState) => void,
): Promise<WhepHandle> {
  let live = false;
  let visualTimer: ReturnType<typeof setTimeout> | null = null;
  let frameCallbackId: number | null = null;

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  onStateChange?.("connecting");

  const clearVisualWatch = () => {
    if (visualTimer) {
      clearTimeout(visualTimer);
      visualTimer = null;
    }
    if (frameCallbackId != null && "cancelVideoFrameCallback" in video) {
      video.cancelVideoFrameCallback(frameCallbackId);
      frameCallbackId = null;
    }
    video.removeEventListener("loadeddata", markLiveIfReady);
    video.removeEventListener("canplay", markLiveIfReady);
  };

  const markLiveIfReady = () => {
    if (live) return;
    if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    live = true;
    clearVisualWatch();
    onStateChange?.("live");
  };

  const armVisualWatch = () => {
    clearVisualWatch();
    video.addEventListener("loadeddata", markLiveIfReady);
    video.addEventListener("canplay", markLiveIfReady);

    if ("requestVideoFrameCallback" in video) {
      frameCallbackId = video.requestVideoFrameCallback(() => {
        frameCallbackId = null;
        markLiveIfReady();
      });
    }

    visualTimer = setTimeout(() => {
      markLiveIfReady();
      if (!live) onStateChange?.("error");
    }, 10000);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      markLiveIfReady();
    } else if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected"
    ) {
      onStateChange?.("error");
    }
  };

  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (ev) => {
    if (video.srcObject !== ev.streams[0]) {
      video.srcObject = ev.streams[0];
    }
    video.play().catch(() => {});
    armVisualWatch();
    markLiveIfReady();
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // Send the offer once ICE gathering completes — but don't block on it.
  // Waiting for "complete" means waiting on every candidate, including the
  // STUN server-reflexive one, which can take seconds (or hang if STUN is
  // slow/unreachable). For LAN/MediaMTX the host candidates already gathered
  // are enough, so we proceed after a short cap. This shaves the multi-second
  // stall off every connect — including returning to the dashboard tab.
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", check);
    timer = setTimeout(finish, 350);
  });

  const url = `${mediamtxUrl.replace(/\/$/, "")}/${path}/whep`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription!.sdp,
  });
  if (!res.ok) {
    pc.close();
    onStateChange?.("error");
    throw new Error(`WHEP ${res.status}: ${await res.text()}`);
  }
  const answerSdp = await res.text();
  const location = res.headers.get("location");
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    stop: async () => {
      try {
        if (location) {
          const del = location.startsWith("http") ? location : `${mediamtxUrl}${location}`;
          await fetch(del, { method: "DELETE" }).catch(() => {});
        }
      } finally {
        clearVisualWatch();
        if (video.srcObject) video.srcObject = null;
        pc.close();
      }
    },
  };
}
