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
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  onStateChange?.("connecting");

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      onStateChange?.("live");
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
    onStateChange?.("live");
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
    timer = setTimeout(finish, 1500);
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
        pc.close();
      }
    },
  };
}
