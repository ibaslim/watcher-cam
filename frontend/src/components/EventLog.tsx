import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_URL, EventRow, recordingLink } from "../lib/api";
import { formatPortalDateTime, PORTAL_TIME_ZONE_LABEL } from "../lib/time";

type Props = { events: EventRow[] };

function formatTime(iso: string): string {
  return `${formatPortalDateTime(iso)} ${PORTAL_TIME_ZONE_LABEL}`;
}

function eventBadge(event: EventRow): { label: string; colorClass: string } {
  switch (event.event_type) {
    case "person_detected":
      return { label: "Person detected", colorClass: "text-blue-400" };
    case "vehicle_detected":
      return { label: "Vehicle detected", colorClass: "text-cyan-400" };
    case "animal_detected":
      return { label: "Animal detected", colorClass: "text-emerald-400" };
    default:
      return { label: event.label || event.event_type.replace(/_/g, " "), colorClass: "text-theme" };
  }
}

export function EventLog({ events }: Props) {
  const [selected, setSelected] = useState<EventRow | null>(null);

  return (
    <section className="bg-verkada-surface border-l border-verkada-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-verkada-border">
        <h3 className="text-sm font-semibold text-theme">Event timeline</h3>
        <span className="text-xs text-theme-muted">{events.length} shown</span>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-6 text-theme-muted text-xs">No matching events yet.</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {events.map((event) => {
            const badge = eventBadge(event);

            return (
              <div
                key={event.id}
                className="bg-verkada-card border border-verkada-border hover:bg-verkada-hover p-2.5 rounded-md flex items-center gap-3 transition-colors cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => setSelected(event)}
                onKeyDown={(keyboardEvent) => {
                  if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                    keyboardEvent.preventDefault();
                    setSelected(event);
                  }
                }}
              >
                {event.snapshot_url ? (
                  <img src={`${API_URL}${event.snapshot_url}`} alt="Detection screenshot" width={48} height={48} className="w-12 h-12 rounded border border-verkada-border object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded border border-verkada-border bg-verkada-canvas flex items-center justify-center text-theme-muted font-bold" aria-hidden>
                    !
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold ${badge.colorClass}`}>
                      {badge.label}
                    </span>

                    {event.confidence != null && (
                      <span className="text-[10px] font-mono text-theme-muted">
                        {(event.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  <div className="text-[10px] text-theme-muted font-mono">
                    {event.camera_id} / {event.source}
                  </div>
                </div>

                <span className="text-[10px] font-mono text-theme-muted flex-shrink-0">{formatTime(event.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}

      {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function EventDetail({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const badge = eventBadge(event);

  useEffect(() => {
    const onKey = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal event-modal" onClick={(event) => event.stopPropagation()}>
        <div className="event-modal-head">
          <span className={`ev-type ${badge.colorClass}`}>
            {badge.label}
          </span>

          <button className="modal-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="event-modal-img">
          {event.snapshot_url ? (
            <Link
              to={recordingLink(event.camera_id, event.created_at, event.id)}
              aria-label="Play recording at this detection"
              title="Click image to play video footage at this detection time"
              className="group relative block w-full h-full cursor-pointer overflow-hidden"
            >
              <img
                src={`${API_URL}${event.snapshot_url}`}
                alt="event snapshot"
                width={640}
                height={360}
                className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <span className="flex items-center gap-2 rounded-full bg-blue-600/90 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-sm">
                  ▶ Play Video Footage
                </span>
              </div>
            </Link>
          ) : (
            <div className="event-modal-noimg">
              <span>No snapshot for this event</span>
            </div>
          )}
        </div>

        <Link className="btn primary mb-4" to={recordingLink(event.camera_id, event.created_at, event.id)}>Play recording at this time ↗</Link>
        <dl className="event-detail-grid">
          <Detail label="Event">{event.event_type}</Detail>
          <Detail label="Camera">{event.camera_id}</Detail>
          {event.confidence != null && (
            <Detail label="Detection confidence">{(event.confidence * 100).toFixed(1)}%</Detail>
          )}
          {event.label && <Detail label="Detected object">{event.label}</Detail>}
          <Detail label="Source">{event.source}</Detail>
          <Detail label="Time">{formatTime(event.created_at)}</Detail>
        </dl>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="event-detail-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
