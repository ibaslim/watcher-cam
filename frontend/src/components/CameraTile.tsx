import { useEffect, useRef, useState } from "react";
import { Camera, MEDIAMTX_URL, ptzMove, ptzZoom } from "../lib/api";
import { startWhep, WhepHandle } from "../lib/whep";

type Props = { camera: Camera };

export function CameraTile({ camera }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullVideoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [fullScreen, setFullScreen] = useState(false);

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
    const connectDelayMs = stableDelay(camera.id, 12000);

    const scheduleRetry = () => {
      if (cancelled || retryScheduled) return;
      retryScheduled = true;
      retryTimer = setTimeout(() => {
        retryScheduled = false;
        connect();
      }, 5000 + connectDelayMs);
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

    const initialTimer = setTimeout(connect, connectDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (connectTimer) clearTimeout(connectTimer);
      handle?.stop();
    };
  }, [camera.id]);

  useEffect(() => {
    if (!fullScreen || !fullVideoRef.current) return;

    let handle: WhepHandle | null = null;
    let cancelled = false;

    (async () => {
      try {
        handle = await startWhep(MEDIAMTX_URL, camera.id, fullVideoRef.current!);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [fullScreen, camera.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullScreen(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stopMove = () => ptzMove(camera.id, "stop");
  const stopZoom = () => ptzZoom(camera.id, "stop");

  const hold = (fn: () => Promise<void>, stop: () => Promise<void>) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      fn().catch(() => {});
    },
    onPointerUp: () => stop().catch(() => {}),
    onPointerCancel: () => stop().catch(() => {}),
    onPointerLeave: () => stop().catch(() => {}),
  });

  const PtzControls = ({ full = false }: { full?: boolean }) => (
    <>
      <div className={full ? "ptz ptz-full" : "ptz"}>
        <button {...hold(() => ptzMove(camera.id, "up-left"), stopMove)}>↖</button>
        <button {...hold(() => ptzMove(camera.id, "up"), stopMove)}>↑</button>
        <button {...hold(() => ptzMove(camera.id, "up-right"), stopMove)}>↗</button>

        <button {...hold(() => ptzMove(camera.id, "left"), stopMove)}>←</button>
        <span className="spacer" />
        <button {...hold(() => ptzMove(camera.id, "right"), stopMove)}>→</button>

        <button {...hold(() => ptzMove(camera.id, "down-left"), stopMove)}>↙</button>
        <button {...hold(() => ptzMove(camera.id, "down"), stopMove)}>↓</button>
        <button {...hold(() => ptzMove(camera.id, "down-right"), stopMove)}>↘</button>
      </div>

      <div className={full ? "zoom zoom-full" : "zoom"}>
        <button {...hold(() => ptzZoom(camera.id, "in"), stopZoom)}>+</button>
        <button {...hold(() => ptzZoom(camera.id, "out"), stopZoom)}>−</button>
      </div>
    </>
  );

  return (
    <>
      <div
        className="group relative bg-verkada-card border border-verkada-border hover:border-slate-500 rounded-lg overflow-hidden flex flex-col transition-all shadow-sm aspect-video cursor-zoom-in"
        ref={tileRef}
        onDoubleClick={() => setFullScreen(true)}
        title="Double-click to open full screen"
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

        <span className="absolute left-1/2 bottom-3 z-10 transform -translate-x-1/2 translate-y-2 opacity-0 pointer-events-none text-white bg-black/50 border border-white/20 rounded-full px-3 py-1.5 text-[10px] font-medium backdrop-blur-sm transition-all group-hover:opacity-100 group-hover:translate-y-0">
          Double-click for full screen
        </span>
      </div>

      {fullScreen && (
        <div className="fixed inset-0 z-120 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-6xl h-full max-h-screen overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl">
            <video ref={fullVideoRef} autoPlay playsInline muted className="w-full h-full object-contain bg-black" />

            <div className="absolute top-4 left-4 right-4 z-30 flex justify-between items-center gap-3">
              <span className="text-white bg-black/60 border border-white/20 rounded-full px-3 py-1.5 text-sm font-semibold backdrop-blur-sm">
                {camera.name}
              </span>

              <button
                className="w-10 h-10 flex items-center justify-center border border-white/20 rounded-full bg-white/90 text-black font-bold text-xl cursor-pointer hover:bg-white transition-colors"
                onClick={() => setFullScreen(false)}
                title="Close"
              >
                ×
              </button>
            </div>

            <PtzControls full />
          </div>
        </div>
      )}
    </>
  );
}

function stableDelay(value: string, maxMs: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % maxMs;
}
