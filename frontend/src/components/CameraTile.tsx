import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, EventRow, MEDIAMTX_URL } from "../lib/api";
import { startWhep, WhepHandle } from "../lib/whep";

type Props = { camera: Camera; events: EventRow[] };

export function CameraTile({ camera, events }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();

  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [latestEvent, setLatestEvent] = useState<EventRow | null>(null);

  useEffect(() => {
    if (!videoRef.current) {
      setStatus("connecting");
      return;
    }

    let handle: WhepHandle | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryScheduled = false;
    let cancelled = false;

    const scheduleRetry = () => {
      if (cancelled || retryScheduled) return;
      retryScheduled = true;
      retryTimer = setTimeout(() => {
        retryScheduled = false;
        connect();
      }, 3000);
    };

    const connect = async () => {
      try {
        await handle?.stop();
        setStatus("connecting");
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = setTimeout(() => {
          if (cancelled) return;
          setStatus("error");
          handle?.stop().catch(() => {});
          scheduleRetry();
        }, 15000);
        handle = await startWhep(
          MEDIAMTX_URL,
          camera.id,
          videoRef.current!,
          (nextStatus) => {
            if (cancelled) return;
            if (nextStatus === "live" && connectTimer) {
              clearTimeout(connectTimer);
              connectTimer = null;
            }
            setStatus(nextStatus);
            if (nextStatus === "error") scheduleRetry();
          },
        );
      } catch {
        if (!cancelled) {
          setStatus("error");
          scheduleRetry();
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (connectTimer) clearTimeout(connectTimer);
      handle?.stop();
    };
  }, [camera.id]);

  const cameraEvents = events
    .filter((event) => event.camera_id === camera.id)
    .slice(0, 12);

  useEffect(() => {
    setLatestEvent(cameraEvents[0] ?? null);
  }, [cameraEvents[0]?.id]);

  const latestDisplayLabel = latestEvent
    ? (latestEvent.label || latestEvent.event_type.replace(/_/g, " "))
    : "No recent detections";

  return (
    <div
      className={`camera-tile ${status === "error" ? "is-offline" : ""}`}
      onClick={() => navigate(`/cameras/${camera.id}`)}
      role="link"
      tabIndex={0}
      aria-label={`Open camera ${camera.name}`}
      onKeyDown={event => { if (event.key === "Enter") navigate(`/cameras/${camera.id}`); }}
      title="Open camera detail page"
    >
        <video ref={videoRef} autoPlay playsInline muted className="camera-tile-video" />

        <div className={`camera-status-badge ${status}`}>
          <span />
          {status === "live" ? "Live" : status === "error" ? "Offline" : "Connecting"}
        </div>

        {status === "error" && <div className="camera-offline-state">Offline</div>}

        <div className="camera-name-overlay">
          <span>{camera.name}</span>
        </div>

        <div className="camera-detection-chip">{latestDisplayLabel}</div>
    </div>
  );
}
