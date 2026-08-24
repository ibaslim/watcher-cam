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
  { value: "person_detected", label: "Person" },
  { value: "vehicle_detected", label: "Vehicle" },
  { value: "animal_detected", label: "Animal" },
];

export function Events({ events, cameras }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [cameraId, setCameraId] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const todaysEvents = events.filter((event) => isPortalToday(event.created_at));

    return todaysEvents.filter((event) => {
      if (cameraId !== "all" && event.camera_id !== cameraId) return false;
      if (filter !== "all" && filter !== "alert" && event.event_type !== filter) return false;

      if (!q) return true;

      return [
        event.camera_id,
        event.event_type,
        event.source,
        event.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [cameraId, events, filter, query]);

  const todaysEvents = events.filter((event) => isPortalToday(event.created_at));
  const eventCount = todaysEvents.length;
  const personCount = todaysEvents.filter((event) => event.event_type === "person_detected").length;
  const vehicleCount = todaysEvents.filter((event) => event.event_type === "vehicle_detected").length;
  const animalCount = todaysEvents.filter((event) => event.event_type === "animal_detected").length;

  return (
    <main className="page events-page">
      <div className="page-inner events-page-inner">
        {/* Hero section */}
        <section className="events-hero">
          <div>
            <p className="eyebrow">Event center</p>
            <h2 className="page-title">Security Events</h2>
            <p className="page-sub">
              Review live object detections and camera event history.
            </p>
          </div>

          <div className="event-summary-grid">
            <Summary value={todaysEvents.length} label="Today" />
            <Summary value={eventCount} label="Total events" tone="alert" />
            <Summary value={personCount} label="Persons" tone="ok" />
            <Summary value={vehicleCount} label="Vehicles" tone="ok" />
            <Summary value={animalCount} label="Animals" tone="ok" />
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
              placeholder="Camera, event type, label..."
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
