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
    : "Waiting for detections";

  return (
    <div
      className="group relative bg-verkada-card border border-verkada-border hover:border-slate-500 rounded-lg overflow-hidden flex flex-col transition-all shadow-sm aspect-video cursor-pointer"
      onClick={() => navigate(`/cameras/${camera.id}`)}
      role="link"
      tabIndex={0}
      aria-label={`Open camera ${camera.name}`}
      onKeyDown={event => { if (event.key === "Enter") navigate(`/cameras/${camera.id}`); }}
      title="Open camera detail page"
    >
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover bg-black" />

        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-2.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
          <span className="text-xs font-medium text-white truncate">{camera.name}</span>

          <span>
            {status === "live" ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">LIVE</span>
            ) : status === "error" ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-500/10 text-red-400 border border-red-500/20">OFFLINE</span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">CONNECTING</span>
            )}
          </span>
        </div>

        <div className="absolute left-2.5 top-11 z-10 rounded-full border border-white/20 bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-100 backdrop-blur-sm">
          {latestDisplayLabel}
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-black/60 backdrop-blur-sm">
          {latestEvent ? (
            <div className="px-2.5 py-2 text-[10px] text-slate-100">
              <span className="font-semibold">Latest: {latestEvent.label || latestEvent.event_type.replace(/_/g, " ")}</span>
            </div>
          ) : (
            <div className="px-2.5 py-2 text-[10px] text-slate-300">Waiting for detections…</div>
          )}
        </div>

      <div className="absolute left-1/2 bottom-3 z-10 transform -translate-x-1/2 translate-y-2 opacity-0 pointer-events-none text-white bg-black/50 border border-white/20 rounded-full px-3 py-1.5 text-[10px] font-medium backdrop-blur-sm transition-all group-hover:opacity-100 group-hover:translate-y-0">
        Open detail page
      </div>
    </div>
  );
}
