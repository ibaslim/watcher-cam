import { useMemo, useState } from "react";
import { Camera, EventRow } from "../lib/api";
import { EventLog } from "../components/EventLog";
import { isPortalToday } from "../lib/time";

type Props = {
  events: EventRow[];
  cameras: Camera[];
};

const EVENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "alert", label: "Alerts" },
  { value: "guard_present", label: "Guard present" },
  { value: "unknown_person", label: "Unknown" },
  { value: "guard_absent", label: "Absent" },
  { value: "wrong_guard", label: "Wrong guard" },
];

function isAlert(event: EventRow): boolean {
  return [
    "unknown_person",
    "guard_absent",
    "wrong_guard",
    "intrusion",
  ].includes(event.event_type);
}

export function Events({ events, cameras }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [cameraId, setCameraId] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const todaysEvents = events.filter((event) => isPortalToday(event.created_at));

    return todaysEvents.filter((event) => {
      if (cameraId !== "all" && event.camera_id !== cameraId) return false;
      if (filter === "alert" && !isAlert(event)) return false;
      if (filter !== "all" && filter !== "alert" && event.event_type !== filter) return false;

      if (!q) return true;

      return [
        event.camera_id,
        event.event_type,
        event.source,
        event.label,
        event.guard_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [cameraId, events, filter, query]);

  const todaysEvents = events.filter((event) => isPortalToday(event.created_at));
  const alertCount = todaysEvents.filter(isAlert).length;
  const guardCount = todaysEvents.filter((event) => event.event_type === "guard_present").length;

  return (
    <main className="page events-page">
      <div className="page-inner events-page-inner">
        {/* Hero section */}
        <section className="events-hero">
          <div>
            <p className="eyebrow">Event center</p>
            <h2 className="page-title">Security Events</h2>
            <p className="page-sub">
              Review detections, guard presence, absence alerts, and camera smart events.
            </p>
          </div>

          <div className="event-summary-grid">
            <Summary value={todaysEvents.length} label="Today" />
            <Summary value={alertCount} label="Alerts" tone="alert" />
            <Summary value={guardCount} label="Guard checks" tone="ok" />
          </div>
        </section>

        {/* Toolbar */}
        <section className="events-toolbar">
          <label>
            <span>Search</span>
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Camera, guard, event type..."
            />
          </label>

          <label>
            <span>Camera</span>
            <select className="input" value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
              <option value="all">All cameras</option>
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.name}
                </option>
              ))}
            </select>
          </label>

          <div className="event-filter-tabs" aria-label="Event filters">
            {EVENT_FILTERS.map((item) => (
              <button
                key={item.value}
                className={filter === item.value ? "active" : ""}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <EventLog events={filtered} />
      </div>
    </main>
  );
}

function Summary({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "alert" | "ok";
}) {
  return (
    <div className={`event-summary-card ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
