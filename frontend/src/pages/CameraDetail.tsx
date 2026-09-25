import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  API_URL,
  Camera,
  ClassificationRow,
  EventRow,
  MEDIAMTX_URL,
  Site,
  fetchClassifications,
  fetchEvents,
  recordingLink,
} from "../lib/api";
import { PORTAL_TIME_ZONE } from "../lib/time";
import { startWhep, WhepHandle } from "../lib/whep";
import { connectEvents } from "../lib/ws";

type Props = { cameras: Camera[]; sites: Site[]; isAdmin: boolean };
type EvidenceFilter = "all" | "person" | "vehicle" | "animal";

const EVENT_PAGE_SIZE = 24;

function fullViewRecordingLink(cameraId: string, at: string, eventId?: number): string {
  const url = recordingLink(cameraId, at, eventId);
  return url.replace("/recordings?", "/recordings/player?");
}

export function CameraDetail({ cameras, sites, isAdmin }: Props) {
  const { cameraId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const loadingPageRef = useRef(false);
  const evidenceRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventOffset, setEventOffset] = useState(0);
  const [hasMoreEvents, setHasMoreEvents] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingMoreEvents, setLoadingMoreEvents] = useState(false);
  const [eventFilter, setEventFilter] = useState<EvidenceFilter>("all");
  const [classificationPreviewByEntity, setClassificationPreviewByEntity] = useState<Record<string, ClassificationRow>>({});
  const camera = cameras.find((item) => item.id === cameraId);
  const site = sites.find((item) => item.id === camera?.site_id);
  const latestEvent = events[0];
  const latestLabel = latestEvent ? (latestEvent.label || latestEvent.event_type.replace(/_/g, " ")) : "No recent detections";

  useEffect(() => {
    if (!videoRef.current || !camera) {
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
  }, [camera?.id]);

  const normalizeEvidenceCategory = useCallback((value: string | null | undefined): EvidenceFilter | "motion" => {
    const raw = (value || "").trim().toLowerCase();
    if (raw.includes("person")) return "person";
    if (raw.includes("animal") || raw.includes("cat") || raw.includes("dog")) return "animal";
    if (
      raw.includes("vehicle")
      || raw.includes("car")
      || raw.includes("truck")
      || raw.includes("bus")
      || raw.includes("van")
      || raw.includes("motorbike")
      || raw.includes("motorcycle")
      || raw.includes("bicycle")
      || raw.includes("bike")
    ) return "vehicle";
    return "motion";
  }, []);

  const mergeEvents = useCallback((current: EventRow[], nextRows: EventRow[]) => {
    const seen = new Set<number>();
    return [...current, ...nextRows].filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  }, []);

  const loadEventsPage = useCallback(async (offset: number, mode: "replace" | "append") => {
    if (!camera) return;
    if (loadingPageRef.current) return;
    loadingPageRef.current = true;
    if (mode === "append") setLoadingMoreEvents(true);
    else setLoadingEvents(true);

    try {
      const rows = await fetchEvents({
        camera_id: camera.id,
        limit: EVENT_PAGE_SIZE,
        offset,
      });

      if (!mountedRef.current) return;

      setHasMoreEvents(rows.length === EVENT_PAGE_SIZE);
      setEventOffset(offset + rows.length);
      setEvents((current) => mode === "append" ? mergeEvents(current, rows) : rows);
    } finally {
      loadingPageRef.current = false;
      if (mountedRef.current) {
        setLoadingEvents(false);
        setLoadingMoreEvents(false);
      }
    }
  }, [camera?.id, mergeEvents]);

  const refreshEvidence = useCallback(async () => {
    setHasMoreEvents(true);
    setEventOffset(0);
    await loadEventsPage(0, "replace");
  }, [loadEventsPage]);

  const loadNextPage = useCallback(() => {
    if (loadingEvents || loadingMoreEvents || !hasMoreEvents) return;
    void loadEventsPage(eventOffset, "append");
  }, [eventOffset, hasMoreEvents, loadEventsPage, loadingEvents, loadingMoreEvents]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (evidenceRefreshTimerRef.current) {
        clearTimeout(evidenceRefreshTimerRef.current);
        evidenceRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!camera) return;
    void refreshEvidence();
  }, [camera?.id, refreshEvidence]);

  useEffect(() => {
    if (!camera) {
      setClassificationPreviewByEntity({});
      return;
    }

    let cancelled = false;
    fetchClassifications(camera.id, undefined, 500)
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, ClassificationRow> = {};
        for (const row of rows) {
          const previewUrl = row.crop_url || row.image_url;
          if (row.entity_id && previewUrl && !next[row.entity_id]) {
            next[row.entity_id] = row;
          }
        }
        setClassificationPreviewByEntity(next);
      })
      .catch(() => {
        if (!cancelled) setClassificationPreviewByEntity({});
      });

    return () => {
      cancelled = true;
    };
  }, [camera?.id]);

  useEffect(() => {
    if (!camera) return;

    const disconnect = connectEvents((payload) => {
      if (payload.camera_id !== camera.id) return;

      setEvents((prev) => {
        const nextEvent = {
          id: payload.id,
          entity_id: null,
          camera_id: payload.camera_id,
          created_at: payload.created_at,
          source: payload.source,
          event_type: payload.event_type,
          label: payload.label ?? null,
          confidence: payload.confidence ?? null,
          snapshot_url: payload.snapshot_path ? `/snapshots/${payload.snapshot_path}` : null,
        } satisfies EventRow;

        return mergeEvents([nextEvent], prev);
      });

      if (evidenceRefreshTimerRef.current) {
        clearTimeout(evidenceRefreshTimerRef.current);
      }
      evidenceRefreshTimerRef.current = setTimeout(() => {
        evidenceRefreshTimerRef.current = null;
        if (mountedRef.current) void refreshEvidence();
      }, 750);
    });

    return () => {
      disconnect();
    };
  }, [camera?.id, mergeEvents, refreshEvidence]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadNextPage();
      }
    }, { rootMargin: "420px 0px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadNextPage]);

  const filteredEvents = useMemo(() => {
    if (eventFilter === "all") return events;
    return events.filter((event) => normalizeEvidenceCategory(event.label || event.event_type) === eventFilter);
  }, [eventFilter, events, normalizeEvidenceCategory]);

  const groupedEvents = useMemo(() => {
    return filteredEvents.reduce<Array<{ key: string; label: string; events: EventRow[] }>>((groups, event) => {
      const date = new Date(event.created_at);
      const key = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "unknown";
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.events.push(event);
      } else {
        groups.push({
          key,
          label: Number.isFinite(date.getTime())
            ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "2-digit", year: "numeric" }).format(date)
            : "Unknown date",
          events: [event],
        });
      }
      return groups;
    }, []);
  }, [filteredEvents]);

  if (!camera) {
    return (
      <main className="page">
        <div className="page-inner">
          <h2 className="page-title">Camera not found</h2>
          <p className="page-sub">The requested camera could not be located.</p>
        </div>
      </main>
    );
  }

  const recordingUrl = latestEvent ? recordingLink(camera.id, latestEvent.created_at, latestEvent.id) : `/recordings?camera=${encodeURIComponent(camera.id)}`;

  return (
    <main className="camera-detail-page">
      <div className="camera-detail-shell">
        <section className="camera-live-panel" aria-label={`${camera.name} live stream`}>
          <div className="camera-live-frame">
            <video ref={videoRef} autoPlay playsInline muted className="camera-live-video" />
            <div className={`camera-live-status ${status}`}>
              <span />
              {status === "live" ? "Live" : status === "error" ? "Camera is currently down" : "Connecting"}
            </div>
            <div className="camera-live-meta">
              <span>{latestLabel}</span>
              {latestEvent?.confidence != null && <strong>{(latestEvent.confidence * 100).toFixed(0)}%</strong>}
            </div>
          </div>
        </section>

        <section className="camera-detail-titlebar">
          <div>
            <h1>{camera.name}</h1>
            <p>{site?.name || camera.recorder_name || "Unassigned location"}</p>
          </div>
          <div className="camera-action-nav" aria-label="Camera actions">
            <button type="button" className={eventFilter === "all" ? "is-active" : ""} onClick={() => setEventFilter("all")}>
              <DetailIcon name="motion" />
              <span>Motion</span>
            </button>
            <button type="button" className={eventFilter === "all" ? "is-active" : ""} onClick={() => setEventFilter("all")}>
              <DetailIcon name="history" />
              <span>History</span>
            </button>
            <button type="button" className={eventFilter === "person" ? "is-active" : ""} onClick={() => setEventFilter("person")}>
              <DetailIcon name="person" />
              <span>People</span>
            </button>
            <button type="button" className={eventFilter === "vehicle" ? "is-active" : ""} onClick={() => setEventFilter("vehicle")}>
              <DetailIcon name="vehicle" />
              <span>Vehicles</span>
            </button>
            <button type="button" className={eventFilter === "animal" ? "is-active" : ""} onClick={() => setEventFilter("animal")}>
              <DetailIcon name="animal" />
              <span>Animals</span>
            </button>
            <Link to={recordingUrl}>
              <DetailIcon name="archive" />
              <span>Archive</span>
            </Link>
            <Link to="/reports">
              <DetailIcon name="analytics" />
              <span>Analytics</span>
            </Link>
            {isAdmin && (
              <Link to={camera.site_id ? `/cameras?site=${encodeURIComponent(camera.site_id)}` : "/cameras"}>
                <DetailIcon name="settings" />
                <span>Settings</span>
              </Link>
            )}
          </div>
        </section>

        <section className="camera-history-section">
          <div className="camera-history-toolbar">
            <nav aria-label="Evidence filters">
              {(["all", "person", "vehicle", "animal"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={eventFilter === value ? "is-active" : ""}
                  onClick={() => setEventFilter(value)}
                >
                  {value === "all" ? "All" : value === "person" ? "People" : value === "vehicle" ? "Vehicles" : "Animals"}
                </button>
              ))}
            </nav>
            <button type="button" className="camera-refresh-button" onClick={() => void refreshEvidence()} disabled={loadingEvents || loadingMoreEvents}>
              {loadingEvents ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {loadingEvents && events.length === 0 ? (
            <div className="camera-history-empty">Loading events...</div>
          ) : groupedEvents.length === 0 ? (
            <div className="camera-history-empty">No events match this camera filter yet.</div>
          ) : (
            <div className="camera-history-groups">
              {groupedEvents.map((group) => (
                <section key={group.key} className="camera-history-group">
                  <h2>{group.label}</h2>
                  <div className="camera-event-grid">
                    {group.events.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        classificationPreview={event.entity_id ? classificationPreviewByEntity[event.entity_id] : undefined}
                        onPlay={(url) => navigate(url)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div ref={loadMoreRef} className="camera-load-sentinel" aria-hidden="true" />
          {loadingMoreEvents && <div className="camera-history-more">Loading more...</div>}
          {!hasMoreEvents && events.length > 0 && <div className="camera-history-more">No more events</div>}
        </section>
      </div>

    </main>
  );
}

function EventCard({
  event,
  classificationPreview,
  onPlay,
}: {
  event: EventRow;
  classificationPreview?: ClassificationRow;
  onPlay: (url: string) => void;
}) {
  const title = event.label || event.event_type.replace(/_/g, " ");
  const src = event.snapshot_url ? `${API_URL}${event.snapshot_url}` : null;
  const cropUrl = classificationPreview?.crop_url || classificationPreview?.image_url || null;
  const cropSrc = cropUrl ? `${API_URL}${cropUrl}` : null;
  const recUrl = fullViewRecordingLink(event.camera_id, event.created_at, event.id);
  const eventDate = new Date(event.created_at);
  const hasRecordingTarget = Boolean(event.camera_id && Number.isFinite(eventDate.getTime()));
  const timeLabel = Number.isFinite(eventDate.getTime())
    ? new Intl.DateTimeFormat("en-US", { timeZone: PORTAL_TIME_ZONE, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(eventDate)
    : "Unknown time";
  const detectionLabel = title.toLowerCase() === event.event_type.toLowerCase().replace(/_/g, " ") ? title : `${title} ${event.event_type.replace(/_/g, " ")}`;
  const accessibleLabel = hasRecordingTarget
    ? `Open recording from ${timeLabel}`
    : `Recording unavailable for ${timeLabel}`;

  return (
    <article className="camera-event-shell">
      <button
        type="button"
        className="camera-event-card"
        onClick={() => {
          if (hasRecordingTarget) onPlay(recUrl);
        }}
        disabled={!hasRecordingTarget}
        aria-label={accessibleLabel}
      >
        <span className="camera-event-media">
          {src ? (
            <img src={src} alt="" loading="lazy" />
          ) : (
            <span>No snapshot available</span>
          )}
          <span className="camera-event-overlay">
            {hasRecordingTarget ? "Open recording" : "Recording unavailable"}
          </span>
        </span>
        <span className="camera-event-foot">
          <span>{timeLabel}</span>
          <span>{detectionLabel}</span>
          {event.confidence != null && <strong>{(event.confidence * 100).toFixed(0)}%</strong>}
        </span>
        {cropSrc ? (
          <span className="camera-event-object-preview" aria-hidden="true">
            <img src={cropSrc} alt="" loading="lazy" />
            <span>{classificationPreview?.label || title}</span>
          </span>
        ) : null}
      </button>
    </article>
  );
}

type DetailIconName = "motion" | "history" | "person" | "vehicle" | "animal" | "archive" | "analytics" | "settings";

const detailIconPaths: Record<DetailIconName, string[]> = {
  motion: ["M4 12h4l2-6 4 12 2-6h4"],
  history: ["M4 7v5h5", "M5 12a7 7 0 1 0 2-5"],
  person: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  vehicle: ["M5 16l1.5-5h11L19 16", "M7 16h10", "M7 19h.01", "M17 19h.01"],
  animal: ["M6 12c0-3 2-5 6-5s6 2 6 5c0 4-3 7-6 7s-6-3-6-7z", "M9 10h.01", "M15 10h.01"],
  archive: ["M4 6h16", "M6 6v14h12V6", "M9 10h6"],
  analytics: ["M5 19V9", "M12 19V5", "M19 19v-7"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 12h2", "M18 12h2", "M12 4v2", "M12 18v2"],
};

function DetailIcon({ name }: { name: DetailIconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {detailIconPaths[name].map((path, index) => <path key={index} d={path} />)}
    </svg>
  );
}
