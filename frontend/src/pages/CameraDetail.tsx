import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  API_URL,
  Camera,
  ClassificationRow,
  EventRow,
  MEDIAMTX_URL,
  fetchClassifications,
  fetchEvents,
} from "../lib/api";
import { formatPortalDateTime, PORTAL_TIME_ZONE_LABEL } from "../lib/time";
import { startWhep, WhepHandle } from "../lib/whep";
import { connectEvents } from "../lib/ws";

type Props = { cameras: Camera[] };

export function CameraDetail({ cameras }: Props) {
  const { cameraId } = useParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [classifications, setClassifications] = useState<ClassificationRow[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingClassifications, setLoadingClassifications] = useState(false);
  const [activeEvidenceTab, setActiveEvidenceTab] = useState<"snapshots" | "detections">("snapshots");
  const [snapshotFilter, setSnapshotFilter] = useState<"all" | "person" | "animal" | "vehicle">("all");
  const [detectionFilter, setDetectionFilter] = useState<"all" | "person" | "animal" | "vehicle">("all");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [classificationStartDate, setClassificationStartDate] = useState("");
  const [classificationStartTime, setClassificationStartTime] = useState("");
  const [classificationEndDate, setClassificationEndDate] = useState("");
  const [classificationEndTime, setClassificationEndTime] = useState("");
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [detectionPage, setDetectionPage] = useState(1);
  const [selectedMedia, setSelectedMedia] = useState<{ src: string; title: string; meta: string } | null>(null);
  const mountedRef = useRef(true);

  const camera = cameras.find((item) => item.id === cameraId);

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
  }, [camera?.id]);

  const refreshEvidence = useCallback(async () => {
    if (!camera) return;

    const classificationDateFrom = buildRangeBoundary(classificationStartDate, classificationStartTime, false);
    const classificationDateTo = buildRangeBoundary(classificationEndDate, classificationEndTime, true);

    setLoadingEvents(true);
    try {
      const rows = await fetchEvents({
        camera_id: camera.id,
        entity_id: selectedEntityId || undefined,
        limit: selectedEntityId ? 200 : 50,
      });
      if (mountedRef.current) setEvents(rows);
    } catch {
      if (mountedRef.current) setEvents([]);
    } finally {
      if (mountedRef.current) setLoadingEvents(false);
    }

    setLoadingClassifications(true);
    try {
      const rows = await fetchClassifications(camera.id, undefined, 48, {
        date_from: classificationDateFrom,
        date_to: classificationDateTo,
      });
      if (mountedRef.current) setClassifications(rows);
    } catch {
      if (mountedRef.current) setClassifications([]);
    } finally {
      if (mountedRef.current) setLoadingClassifications(false);
    }
  }, [camera?.id, classificationEndDate, classificationEndTime, classificationStartDate, classificationStartTime, selectedEntityId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!camera) return;

    void refreshEvidence();

    return () => {};
  }, [camera?.id, refreshEvidence]);

  useEffect(() => {
    if (!camera) return;

    if (selectedEntityId) {
      return () => {};
    }

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

        const withoutDuplicate = prev.filter((item) => item.id !== nextEvent.id);
        return [nextEvent, ...withoutDuplicate].slice(0, 12);
      });
    });

    return () => {
      disconnect();
    };
  }, [camera?.id, refreshEvidence, selectedEntityId]);

  const normalizeEvidenceCategory = (value: string | null | undefined) => {
    const raw = (value || "").trim().toLowerCase();
    if (!raw) return "all";
    if (raw.includes("person")) return "person";
    if (raw.includes("animal") || raw.includes("cat") || raw.includes("dog")) return "animal";
    if (raw.includes("vehicle") || raw.includes("car") || raw.includes("truck") || raw.includes("bus")) return "vehicle";
    return "all";
  };

  const filteredEvents = useMemo(() => {
    const rows = events.filter((event) => {
      if (selectedEntityId && event.entity_id !== selectedEntityId) return false;
      if (snapshotFilter === "all") return true;
      return normalizeEvidenceCategory(event.label || event.event_type) === snapshotFilter;
    });
    return rows;
  }, [events, selectedEntityId, snapshotFilter]);

  const filteredClassifications = useMemo(() => {
    return classifications.filter((item) => detectionFilter === "all" || item.category === detectionFilter);
  }, [classifications, detectionFilter]);

  const clearClassificationRange = () => {
    setClassificationStartDate("");
    setClassificationStartTime("");
    setClassificationEndDate("");
    setClassificationEndTime("");
    setDetectionPage(1);
  };

  const snapshotPageCount = Math.max(1, Math.ceil(filteredEvents.length / 6));
  const detectionPageCount = Math.max(1, Math.ceil(filteredClassifications.length / 6));
  const safeSnapshotPage = Math.min(snapshotPage, snapshotPageCount);
  const safeDetectionPage = Math.min(detectionPage, detectionPageCount);
  const visibleEvents = filteredEvents.slice((safeSnapshotPage - 1) * 6, safeSnapshotPage * 6);
  const visibleClassifications = filteredClassifications.slice((safeDetectionPage - 1) * 6, safeDetectionPage * 6);
  const latestEvent = events[0];
  const latestLabel = latestEvent ? (latestEvent.label || latestEvent.event_type.replace(/_/g, " ")) : "Waiting for detections";

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

  return (
    <main className="flex-1 overflow-auto bg-verkada-canvas p-4 md:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[28px] border border-verkada-border bg-verkada-card shadow-sm">
          <div className="border-b border-verkada-border bg-verkada-hover px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">Live recording</p>
                <h2 className="text-2xl font-semibold text-theme">{camera.name}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  {status === "live" ? "Live" : status === "error" ? "Offline" : "Connecting"}
                </span>
                {camera.detect ? (
                  <span className="rounded-full border border-verkada-border bg-verkada-hover px-2.5 py-1 text-[11px] font-semibold text-theme-muted">
                    AI detection enabled
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
              <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="h-[460px] w-full object-contain bg-black" />
                <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/50 to-transparent px-4 py-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">Camera feed</p>
                    <p className="text-sm font-semibold text-white">{camera.name}</p>
                  </div>
                  <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-slate-100 backdrop-blur-sm">
                    {latestLabel}
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent px-4 py-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">Current stream</p>
                      <p className="text-sm font-semibold text-white">{latestLabel}</p>
                    </div>
                    {latestEvent?.confidence != null && (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                        {(latestEvent.confidence * 100).toFixed(0)}% confidence
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-[24px] border border-verkada-border bg-verkada-surface p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-theme-muted">Camera details</p>
                  <div className="mt-3 space-y-3 text-sm text-theme-muted">
                    <div className="flex items-center justify-between gap-3">
                      <span>Camera ID</span>
                      <span className="font-semibold text-theme">{camera.id}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Recording</span>
                      <span className="font-semibold text-theme">{camera.recording_enabled ? "Enabled" : "Disabled"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Detection</span>
                      <span className="font-semibold text-theme">{camera.detect ? "On" : "Off"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Stream mode</span>
                      <span className="font-semibold text-theme">WebRTC</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-verkada-border bg-verkada-surface p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-theme-muted">Operational status</p>
                  <div className="mt-3 space-y-2 text-sm text-theme-muted">
                    <div className="rounded-[16px] border border-verkada-border bg-verkada-hover p-3">
                      <p className="font-semibold text-theme">Reliable stream delivery</p>
                      <p className="mt-1 text-theme-muted">The live feed reconnects automatically and keeps the latest detections synced.</p>
                    </div>
                    <div className="rounded-[16px] border border-verkada-border bg-verkada-hover p-3">
                      <p className="font-semibold text-theme">Evidence timeline</p>
                      <p className="mt-1 text-theme-muted">Recent snapshots and unique detections refresh below the live view for rapid review.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-verkada-border bg-verkada-card shadow-sm">
          <div className="border-b border-verkada-border bg-verkada-hover px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">Camera evidence</p>
                <h3 className="text-xl font-semibold text-theme">Media gallery</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveEvidenceTab("snapshots");
                    setSnapshotPage(1);
                  }}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${activeEvidenceTab === "snapshots" ? "bg-emerald-400 text-black" : "border border-verkada-border bg-verkada-hover text-theme"}`}
                >
                  Recent snapshots
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveEvidenceTab("detections");
                    setDetectionPage(1);
                  }}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${activeEvidenceTab === "detections" ? "bg-emerald-400 text-black" : "border border-verkada-border bg-verkada-hover text-theme"}`}
                >
                  Unique detections
                </button>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {(["all", "person", "animal", "vehicle"] as const).map((value) => {
                  const isActive = activeEvidenceTab === "snapshots" ? snapshotFilter === value : detectionFilter === value;
                  const onClick = activeEvidenceTab === "snapshots"
                    ? () => {
                        setSnapshotFilter(value);
                        setSnapshotPage(1);
                      }
                    : () => {
                        setDetectionFilter(value);
                        setDetectionPage(1);
                      };

                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={onClick}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${isActive ? "bg-emerald-400 text-black" : "border border-verkada-border bg-verkada-hover text-theme"}`}
                    >
                      {value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}
                    </button>
                  );
                })}
                {activeEvidenceTab === "snapshots" && selectedEntityId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEntityId(null);
                      setSnapshotPage(1);
                    }}
                    className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200"
                  >
                    Entity {selectedEntityId} • Clear
                  </button>
                ) : null}
              </div>

              {activeEvidenceTab === "detections" ? (
                <div className="grid gap-2 rounded-[20px] border border-verkada-border bg-verkada-surface p-3 text-[11px] text-theme-muted md:grid-cols-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="font-semibold uppercase tracking-[0.18em] text-theme-muted">Start date</span>
                    <input
                      type="date"
                      className="rounded-full border border-verkada-border bg-verkada-canvas px-3 py-2 text-theme"
                      value={classificationStartDate}
                      onChange={(event) => {
                        setClassificationStartDate(event.target.value);
                        setDetectionPage(1);
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-semibold uppercase tracking-[0.18em] text-theme-muted">Start time</span>
                    <input
                      type="time"
                      className="rounded-full border border-verkada-border bg-verkada-canvas px-3 py-2 text-theme"
                      value={classificationStartTime}
                      onChange={(event) => {
                        setClassificationStartTime(event.target.value);
                        setDetectionPage(1);
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-semibold uppercase tracking-[0.18em] text-theme-muted">End date</span>
                    <input
                      type="date"
                      className="rounded-full border border-verkada-border bg-verkada-canvas px-3 py-2 text-theme"
                      value={classificationEndDate}
                      onChange={(event) => {
                        setClassificationEndDate(event.target.value);
                        setDetectionPage(1);
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-semibold uppercase tracking-[0.18em] text-theme-muted">End time</span>
                    <input
                      type="time"
                      className="rounded-full border border-verkada-border bg-verkada-canvas px-3 py-2 text-theme"
                      value={classificationEndTime}
                      onChange={(event) => {
                        setClassificationEndTime(event.target.value);
                        setDetectionPage(1);
                      }}
                    />
                  </label>
                  <div className="md:col-span-4 flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={clearClassificationRange}
                      className="rounded-full border border-verkada-border bg-verkada-hover px-3 py-1.5 text-[11px] font-semibold text-theme"
                    >
                      Clear range
                    </button>
                    <span className="text-theme-muted">Filters apply to unique detections only.</span>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshEvidence()}
                  disabled={loadingEvents || loadingClassifications}
                  className="rounded-full border border-verkada-border bg-verkada-hover px-3 py-1.5 text-[11px] font-semibold text-theme disabled:opacity-60"
                >
                  {loadingEvents || loadingClassifications ? "Refreshing…" : "Refresh"}
                </button>
                {activeEvidenceTab === "snapshots" ? (
                  <>
                    <span className="rounded-full border border-verkada-border bg-verkada-hover px-3 py-1.5 text-[11px] font-semibold text-theme">
                      Page {safeSnapshotPage} of {snapshotPageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSnapshotPage((page) => Math.max(1, page - 1))}
                      disabled={safeSnapshotPage <= 1}
                      className="rounded-full border border-verkada-border bg-verkada-hover px-2.5 py-1.5 text-[11px] font-semibold text-theme disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnapshotPage((page) => Math.min(snapshotPageCount, page + 1))}
                      disabled={safeSnapshotPage >= snapshotPageCount}
                      className="rounded-full border border-verkada-border bg-verkada-hover px-2.5 py-1.5 text-[11px] font-semibold text-theme disabled:opacity-50"
                    >
                      Next
                    </button>
                  </>
                ) : (
                  <>
                    <span className="rounded-full border border-verkada-border bg-verkada-hover px-3 py-1.5 text-[11px] font-semibold text-theme">
                      Page {safeDetectionPage} of {detectionPageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetectionPage((page) => Math.max(1, page - 1))}
                      disabled={safeDetectionPage <= 1}
                      className="rounded-full border border-verkada-border bg-verkada-hover px-2.5 py-1.5 text-[11px] font-semibold text-theme disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetectionPage((page) => Math.min(detectionPageCount, page + 1))}
                      disabled={safeDetectionPage >= detectionPageCount}
                      className="rounded-full border border-verkada-border bg-verkada-hover px-2.5 py-1.5 text-[11px] font-semibold text-theme disabled:opacity-50"
                    >
                      Next
                    </button>
                  </>
                )}
              </div>
            </div>

            {activeEvidenceTab === "snapshots" ? (
              loadingEvents ? (
                <div className="rounded-[20px] border border-verkada-border bg-verkada-surface p-6 text-sm text-theme-muted">Loading snapshots…</div>
              ) : visibleEvents.length === 0 ? (
                <div className="rounded-[20px] border border-verkada-border bg-verkada-surface p-6 text-sm text-theme-muted">
                  No snapshots match the selected filter yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleEvents.map((event) => {
                    const title = event.label || event.event_type.replace(/_/g, " ");
                    const src = event.snapshot_url ? `${API_URL}${event.snapshot_url}` : null;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => src && setSelectedMedia({ src, title, meta: `${event.event_type} • ${formatPortalDateTime(event.created_at)} ${PORTAL_TIME_ZONE_LABEL}` })}
                        className="overflow-hidden rounded-[24px] border border-verkada-border bg-verkada-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400/40"
                      >
                        <div className="flex items-start justify-between gap-3 border-b border-verkada-border px-3 py-2.5">
                          <div>
                            <p className="text-sm font-semibold text-theme">{title}</p>
                            <p className="text-[11px] text-theme-muted">{event.event_type}</p>
                          </div>
                          {event.confidence != null && (
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                              {(event.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        {src ? (
                          <img src={src} alt={title} className="h-44 w-full object-cover" />
                        ) : (
                          <div className="flex h-44 items-center justify-center bg-verkada-hover text-sm text-theme-muted">No snapshot available</div>
                        )}
                        <div className="px-3 py-2.5 text-[11px] text-theme-muted">
                          {formatPortalDateTime(event.created_at)} {PORTAL_TIME_ZONE_LABEL}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : loadingClassifications ? (
              <div className="rounded-[20px] border border-verkada-border bg-verkada-surface p-6 text-sm text-theme-muted">Loading unique detections…</div>
            ) : visibleClassifications.length === 0 ? (
              <div className="rounded-[20px] border border-verkada-border bg-verkada-surface p-6 text-sm text-theme-muted">
                No unique detections match the selected filter yet.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleClassifications.map((item) => {
                  const title = item.label || item.category;
                  const src = item.image_url || item.crop_url ? `${API_URL}${(item.image_url || item.crop_url)!}` : null;
                  const hasImage = Boolean(src);
                  return (
                      <div
                        key={item.classification_key || `classification-${item.id}`}
                        className="overflow-hidden rounded-[24px] border border-verkada-border bg-verkada-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400/40"
                      >
                        <button
                          type="button"
                          onClick={() => hasImage && setSelectedMedia({ src: src!, title, meta: `${item.category} • entity ${item.entity_id} • ${item.occurrence_count} appearances • last seen ${formatPortalDateTime(item.last_seen)} ${PORTAL_TIME_ZONE_LABEL}` })}
                          className="block w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-3 border-b border-verkada-border px-3 py-2.5">
                            <div>
                              <p className="text-sm font-semibold text-theme">{title}</p>
                              <p className="text-[11px] text-theme-muted">{item.category} • entity {item.entity_id}</p>
                            </div>
                            {item.confidence != null && (
                              <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                                {(item.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          {hasImage ? (
                            <img src={src!} alt={title} className="h-44 w-full object-cover" />
                          ) : (
                            <div className="flex h-44 items-center justify-center bg-verkada-hover text-sm text-theme-muted">No image available</div>
                          )}
                        </button>
                        <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-[11px] text-theme-muted">
                          <span>Last seen {formatPortalDateTime(item.last_seen)} {PORTAL_TIME_ZONE_LABEL}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEntityId(item.entity_id);
                              setSnapshotFilter(item.category as "person" | "animal" | "vehicle");
                              setSnapshotPage(1);
                              setActiveEvidenceTab("snapshots");
                            }}
                            className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200"
                          >
                            View {item.occurrence_count} snapshots
                          </button>
                        </div>
                      </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {selectedMedia ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-4 py-6" onClick={() => setSelectedMedia(null)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-verkada-border bg-verkada-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-verkada-border px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">Full view</p>
                <p className="text-sm font-semibold text-theme">{selectedMedia.title}</p>
              </div>
              <button type="button" onClick={() => setSelectedMedia(null)} className="rounded-full border border-verkada-border bg-verkada-hover px-3 py-1.5 text-sm font-semibold text-theme">
                Close
              </button>
            </div>
            <div className="p-4">
              <img src={selectedMedia.src} alt={selectedMedia.title} className="max-h-[70vh] w-full object-contain" />
            </div>
            <div className="border-t border-verkada-border px-4 py-3 text-sm text-theme-muted">
              {selectedMedia.meta}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function buildRangeBoundary(dateValue: string, timeValue: string, isEnd: boolean): string | undefined {
  const date = dateValue.trim();
  if (!date) return undefined;

  const time = timeValue.trim() || (isEnd ? "23:59" : "00:00");
  return `${date}T${time}`;
}

function stableDelay(value: string, maxMs: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % maxMs;
}
