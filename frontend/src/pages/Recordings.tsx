import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  API_URL,
  Camera,
  RecordingDay,
  RecordingDetection,
  RecordingDetectionRange,
  RecordingTimelineClip,
  fetchCameras,
  fetchRecordingAt,
  fetchRecordingDay,
} from "../lib/api";
import { portalTodayDateInput, portalDateInput, formatPortalDateTime, PORTAL_TIME_ZONE_LABEL, PORTAL_TIME_ZONE } from "../lib/time";

function mb(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

const DAY_SECONDS = 24 * 60 * 60;
const RECORDING_JUMP_RETRY_DELAY_MS = 10_000;
const RECORDING_JUMP_MAX_RETRIES = 6;
const RECENT_DETECTION_RETRY_WINDOW_MS = 10 * 60 * 1000;

function isRecentDetection(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const age = Date.now() - time;
  return age >= -60_000 && age <= RECENT_DETECTION_RETRY_WINDOW_MS;
}

function timeLabel(seconds: number) {
  const safe = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(seconds)));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shortClockLabel(seconds: number) {
  const safe = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(seconds)));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function playbackDate(value: RecordingDay | null, timelineSecond: number) {
  if (!value?.start) return null;
  const start = new Date(value.start).getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + Math.max(0, timelineSecond) * 1000);
}

function formatPlaybackPill(value: Date | null, timeZone = PORTAL_TIME_ZONE) {
  if (!value) return "Select footage";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("weekday")}   ${get("month")}/${get("day")}/${get("year")}   ${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")}`;
}

function detectionClass(type: string) {
  if (type.includes("vehicle")) return "vehicle";
  if (type.includes("animal")) return "animal";
  return "person";
}

function findClip(day: RecordingDay | null, second: number): RecordingTimelineClip | null {
  if (!day) return null;
  return day.clips.find((clip) => second >= Math.max(0, clip.start_second) && second < Math.min(DAY_SECONDS, clip.end_second)) || null;
}

export function Recordings() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStageRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const cameraId = params.get("camera") || cameras[0]?.id || "";
  const at = params.get("at") || "";
  const eventId = params.get("event");
  const fullView = location.pathname === "/recordings/player" || Boolean(cameraId && at && eventId) || params.get("view") === "player";
  const validTime = !at || Number.isFinite(Date.parse(at));
  const dayParam = params.get("day") || (at && validTime ? portalDateInput(at) : portalTodayDateInput());
  const [day, setDay] = useState<RecordingDay | null>(null);
  const [selected, setSelected] = useState<RecordingTimelineClip | null>(null);
  const [timelineSecond, setTimelineSecond] = useState(0);
  const [pendingSecond, setPendingSecond] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [revision, setRevision] = useState(0);
  const [autoRetry, setAutoRetry] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pointerEnabled, setPointerEnabled] = useState(false);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [speedOpen, setSpeedOpen] = useState(false);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCameras().then(rows => { if (!cancelled) { setCameras(rows); setCameraError(""); } })
      .catch(() => { if (!cancelled) setCameraError("Could not load cameras. Please retry."); });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    const canAutoRetry = Boolean(at) && isRecentDetection(at);
    setDay(null); setSelected(null); setTimelineSecond(0); setPendingSecond(null); setError("");
    if (!validTime) { setError("This recording link contains an invalid timestamp."); setLoading(false); return; }
    if (!cameraId || !dayParam) { setLoading(false); return; }
    setLoading(true);

    async function load() {
      try {
        if (at) {
          const match = await fetchRecordingAt(cameraId, at, eventId);
          if (cancelled) return;

          setSelected(match.clip);
          setTimelineSecond(match.timeline_second);
          setPendingSecond(match.timeline_second);
          setLoading(false);

          try {
            const manifest = await fetchRecordingDay(cameraId, match.clip.day);
            if (cancelled) return;
            const nextClip = findClip(manifest, match.timeline_second) || match.clip;
            setDay(manifest);
            setSelected(nextClip);
            setPendingSecond(match.timeline_second);
          } catch {
            if (!cancelled) setDay(null);
          }
          return;
        }

        const manifest = await fetchRecordingDay(cameraId, dayParam);
        if (cancelled) return;
        const nextSecond = Math.max(0, manifest.clips[0]?.start_second ?? 0);
        const nextClip = findClip(manifest, nextSecond);
        setDay(manifest);
        setTimelineSecond(nextSecond);
        setSelected(nextClip);
        setPendingSecond(nextClip ? nextSecond : null);
        if (!nextClip && manifest.clips.length === 0) {
          setError("No recordings found for this date.");
        } else if (!nextClip) {
          setError("No footage is available at the selected time.");
        }
      } catch (e) {
        if (!cancelled) {
          if (canAutoRetry && autoRetry < RECORDING_JUMP_MAX_RETRIES) {
            window.setTimeout(() => {
              if (!cancelled) setAutoRetry(value => value + 1);
            }, RECORDING_JUMP_RETRY_DELAY_MS);
          } else {
            setError((e as Error).message);
          }
        }
      } finally { if (!cancelled) setLoading(false); }
    }

    void load();
    return () => { cancelled = true; };
  }, [cameraId, dayParam, at, eventId, validTime, revision, autoRetry]);

  useEffect(() => {
    setAutoRetry(0);
  }, [cameraId, at]);

  useEffect(() => {
    setIsPlaying(false);
    setVideoTime(0);
    setVideoDuration(0);
    setZoom(1);
    setPlaybackRate(1);
    setSettingsOpen(false);
    setPointerPosition(null);
    setPan({ x: 0, y: 0 });
    setSpeedOpen(false);
    setIsDraggingVideo(false);
  }, [selected?.url]);

  const load = () => { setAutoRetry(0); setRevision(value => value + 1); };

  function browse(nextCamera: string, nextDay: string) {
    setAutoRetry(0);
    setParams(fullView ? { camera: nextCamera, day: nextDay, view: "player" } : { camera: nextCamera, day: nextDay });
  }

  function seekTo(second: number, play = false) {
    if (!day) return;
    const clamped = Math.max(0, Math.min(DAY_SECONDS - 1, second));
    const clip = findClip(day, clamped);
    setTimelineSecond(clamped);
    setError("");

    if (!clip) {
      setSelected(null);
      setPendingSecond(null);
      setError("No footage is available at this time.");
      return;
    }

    setPendingSecond(clamped);
    setSelected(clip);
    const video = videoRef.current;
    if (video && selected?.url === clip.url) {
      video.currentTime = Math.max(0, clamped - clip.start_second);
      if (play) void video.play().catch(() => undefined);
    }
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  function seekWithinClip(nextTime: number) {
    const video = videoRef.current;
    if (!video || !selected) return;
    const clamped = Math.max(0, Math.min(videoDuration || selected.duration_seconds || 0, nextTime));
    video.currentTime = clamped;
    setVideoTime(clamped);
    setTimelineSecond(Math.max(0, Math.min(DAY_SECONDS - 1, selected.start_second + clamped)));
  }

  function rewind10Seconds() {
    seekWithinClip(videoTime - 10);
  }

  function forward10Seconds() {
    seekWithinClip(videoTime + 10);
  }

  function stepBackward() {
    seekWithinClip(videoTime - (1 / 30));
  }

  function stepForward() {
    seekWithinClip(videoTime + (1 / 30));
  }

  function changePlaybackRate(nextRate: number) {
    setPlaybackRate(nextRate);
    setSpeedOpen(false);
    if (videoRef.current) videoRef.current.playbackRate = nextRate;
  }

  function goToLive() {
    if (!cameraId) {
      setError("Camera is currently down.");
      return;
    }
    navigate(`/cameras/${encodeURIComponent(cameraId)}`);
  }

  function changeZoom(nextZoom: number) {
    const value = Math.max(1, Math.min(4, Number(nextZoom.toFixed(2))));
    setZoom(value);
    if (value <= 1) setPan({ x: 0, y: 0 });
  }

  function zoomIn() {
    changeZoom(zoom + 0.25);
  }

  function zoomOut() {
    changeZoom(zoom - 0.25);
  }

  function captureSnapshot() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          setError("Snapshot capture is not available for this video source.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${cameraName || "camera"}-${timeLabel(timelineSecond).replace(/:/g, "-")}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
    } catch {
      setError("Snapshot capture is not available for this video source.");
    }
  }

  function createClip() {
    setSettingsOpen(false);
  }

  function openStreamAction() {
    setPointerEnabled((value) => !value);
  }

  function toggleFullscreen() {
    const element = videoStageRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void element.requestFullscreen().catch(() => undefined);
    }
  }

  function handleVideoPointer(event: MouseEvent<HTMLDivElement>) {
    if (!pointerEnabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    setPointerPosition({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
  }

  function handleVideoPanStart(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= 1 || pointerEnabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsDraggingVideo(true);
  }

  function handleVideoPanMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const limit = Math.min(45, (zoom - 1) * 18);
    const nextX = Math.max(-limit, Math.min(limit, drag.panX + ((event.clientX - drag.x) / Math.max(1, event.currentTarget.clientWidth)) * 100));
    const nextY = Math.max(-limit, Math.min(limit, drag.panY + ((event.clientY - drag.y) / Math.max(1, event.currentTarget.clientHeight)) * 100));
    setPan({ x: nextX, y: nextY });
  }

  function handleVideoPanEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragStartRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragStartRef.current = null;
      setIsDraggingVideo(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  const activeClipOffset = selected ? Math.max(0, timelineSecond - selected.start_second) : 0;
  const cameraName = cameras.find(camera => camera.id === cameraId)?.name || cameraId;
  const currentPlaybackDate = playbackDate(day, timelineSecond);

  const currentRanges = useMemo(() => {
    if (!day) return [];
    return day.detection_ranges.filter((range) => timelineSecond >= range.start_second && timelineSecond <= Math.max(range.start_second + 1, range.end_second));
  }, [day, timelineSecond]);

  return (
    <main className={fullView ? "recording-full-page" : "page"}>
      <div className={fullView ? "recording-full-inner" : "page-inner"}>
        {!fullView && (
          <>
            <h2 className="page-title">Recordings</h2>
            <p className="page-sub">Play a full day of footage with detection markers.</p>
          </>
        )}

        {!fullView && at && validTime && <div className="recording-jump-notice" role="status"><div><strong>Detection playback</strong><p>{formatPortalDateTime(at)} {PORTAL_TIME_ZONE_LABEL} · {cameraName}{loading && autoRetry > 0 ? ` · waiting for footage ${autoRetry}/${RECORDING_JUMP_MAX_RETRIES}` : ""}</p></div><button className="btn" onClick={() => browse(cameraId, day?.day || dayParam)}>Browse this day</button></div>}
        {(error || cameraError) && <div role="alert" className="alert alert-warn mb-4"><span>{error || cameraError}</span><button className="btn" onClick={load} disabled={loading}>Retry</button></div>}

        {!fullView && <div className="recording-card">
          <div className="recording-filters">
            <label>
              Camera
              <select className="input" value={cameraId} onChange={(e) => browse(e.target.value, day?.day || dayParam)}>
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
              </select>
            </label>

            <label>
              Date
              <input className="input" type="date" value={day?.day || dayParam} onChange={(e) => browse(cameraId, e.target.value)} />
            </label>

            <button className="btn primary" onClick={load} disabled={loading}>
              {loading ? "Loading..." : "Search"}
            </button>
          </div>
        </div>}

        <div className={`recording-layout ${fullView ? "full-view" : ""}`}>
          <div className={`recording-player surveillance-player ${fullView ? "full-view" : ""}`}>
            {selected ? (
              <>
                <div
                  ref={videoStageRef}
                  className={`recording-video-stage ${pointerEnabled ? "pointer-enabled" : ""} ${zoom > 1 && !pointerEnabled ? "is-zoomed" : ""} ${isDraggingVideo ? "is-dragging" : ""}`}
                  onClick={handleVideoPointer}
                  onPointerDown={handleVideoPanStart}
                  onPointerMove={handleVideoPanMove}
                  onPointerUp={handleVideoPanEnd}
                  onPointerCancel={handleVideoPanEnd}
                >
                  <video
                    ref={videoRef}
                    key={selected.url}
                    src={`${API_URL}${selected.url}`}
                    controls={false}
                    autoPlay
                    playsInline
                    className="recording-video"
                    style={{ transform: `translate(${pan.x}%, ${pan.y}%) scale(${zoom})` }}
                    onLoadedMetadata={(event) => {
                      const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : selected.duration_seconds;
                      setVideoDuration(nextDuration || 0);
                      event.currentTarget.playbackRate = playbackRate;
                      if (pendingSecond == null) return;
                      const nextTime = Math.max(0, pendingSecond - selected.start_second);
                      event.currentTarget.currentTime = nextTime;
                      setVideoTime(nextTime);
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={(event) => {
                      setVideoTime(event.currentTarget.currentTime);
                      setTimelineSecond(Math.max(0, Math.min(DAY_SECONDS - 1, selected.start_second + event.currentTarget.currentTime)));
                    }}
                    onEnded={() => {
                      setIsPlaying(false);
                      if (!day) return;
                      const nextSecond = Math.min(DAY_SECONDS - 1, selected.end_second + 0.01);
                      const nextClip = findClip(day, nextSecond);
                      if (nextClip) seekTo(nextSecond, true);
                    }}
                    onError={() => setError("This recording cannot be played yet. It may still be saving or is no longer available. Please retry.")}
                  />
                  <div className="recording-camera-label">
                    <span className="recording-status-dot" />
                    <span>{cameraName}</span>
                  </div>
                  <button type="button" className="recording-close-button" onClick={() => window.history.back()} aria-label="Close player">
                    <Icon name="close" />
                  </button>
                  <div className="recording-zoom-controls" aria-label="Zoom controls">
                    <button type="button" onClick={zoomIn} disabled={zoom >= 4} aria-label="Zoom in">
                      <Icon name="zoomIn" />
                    </button>
                    <button type="button" onClick={zoomOut} disabled={zoom <= 1} aria-label="Zoom out">
                      <Icon name="zoomOut" />
                    </button>
                  </div>
                  {pointerPosition ? (
                    <span
                      className="recording-pointer"
                      style={{ left: `${pointerPosition.x}%`, top: `${pointerPosition.y}%` }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <div className="recording-zoom-badge">{Math.round(zoom * 100)}%</div>
                </div>

                <Timeline day={day} value={timelineSecond} onSeek={(second) => seekTo(second, true)} />

                <div className="recording-control-deck">
                  <div className="recording-controls-left">
                    <button type="button" className="recording-icon-button primary" onClick={togglePlayback} aria-label={isPlaying ? "Pause" : "Play"}>
                      <Icon name={isPlaying ? "pause" : "play"} />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={rewind10Seconds} aria-label="Rewind 10 seconds">
                      <Icon name="rewind10" />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={forward10Seconds} aria-label="Forward 10 seconds">
                      <Icon name="forward10" />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={stepBackward} aria-label="Previous frame">
                      <Icon name="stepBack" />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={stepForward} aria-label="Next frame">
                      <Icon name="stepForward" />
                    </button>
                    <div className="recording-speed-menu">
                      <button type="button" className={`recording-speed-trigger ${speedOpen ? "active" : ""}`} onClick={() => setSpeedOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={speedOpen} aria-label="Playback speed">
                        {playbackRate}x
                      </button>
                      {speedOpen ? (
                        <div className="recording-speed-options" role="listbox" aria-label="Playback speed">
                          {[0.25, 0.5, 1, 1.5, 2].map((rate) => (
                            <button key={rate} type="button" className={playbackRate === rate ? "active" : ""} role="option" aria-selected={playbackRate === rate} onClick={() => changePlaybackRate(rate)}>
                              {rate}x
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button type="button" className="recording-live-button" onClick={goToLive}>
                      <span className="recording-status-dot" />
                      Live
                    </button>
                  </div>

                  <button type="button" className="recording-date-pill" onClick={() => setSettingsOpen((value) => !value)}>
                    <span>{formatPlaybackPill(currentPlaybackDate, day?.timezone || PORTAL_TIME_ZONE)}</span>
                    <Icon name="chevronUp" />
                  </button>

                  <div className="recording-actions-right">
                    <button type="button" className={`recording-icon-button ${pointerEnabled ? "active" : ""}`} onClick={openStreamAction} aria-label="Stream action">
                      <Icon name="stream" />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={captureSnapshot} aria-label="Capture snapshot">
                      <Icon name="camera" />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={createClip} aria-label="Create clip">
                      <Icon name="scissors" />
                    </button>
                    <button type="button" className={`recording-icon-button ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((value) => !value)} aria-label="Player settings">
                      <Icon name="settings" />
                    </button>
                    <button type="button" className="recording-icon-button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
                      <Icon name="fullscreen" />
                    </button>
                  </div>
                </div>

                {settingsOpen ? (
                  <div className="recording-settings-panel">
                    <button type="button" className="recording-setting-row" onClick={() => { changeZoom(1); setPointerPosition(null); }}>
                      <span>Reset zoom and pointer</span>
                      <strong>{Math.round(zoom * 100)}%</strong>
                    </button>
                    <a className="recording-setting-row" href={`${API_URL}${selected.url}`} target="_blank" rel="noreferrer">
                      <span>Download segment</span>
                      <strong>{selected.display_name}</strong>
                    </a>
                    <div className="recording-setting-row muted">
                      <span>{timeLabel(activeClipOffset)} in segment</span>
                      <strong>{timeLabel(Math.max(0, selected.duration_seconds))}</strong>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <PlayerPlaceholder loading={loading} hasError={Boolean(error || cameraError)} />
            )}
          </div>

          {!fullView && <div className="recording-list">
            <h3>Detections</h3>
            {currentRanges.map((range) => (
              <DetectionRangeButton key={range.id} range={range} onClick={() => seekTo(Math.max(0, range.start_second - 2), true)} />
            ))}
            {day?.detections.length ? day.detections.slice(0, 30).map((detection) => (
              <DetectionButton key={detection.event_id} detection={detection} onClick={() => seekTo(Math.max(0, detection.timeline_second - 2), true)} />
            )) : (
              <div className="empty !border-0 !rounded-none">No detections found for this date.</div>
            )}

            <h3>Segments</h3>
            {day?.clips.length ? day.clips.map((clip) => (
              <button key={clip.filename} className={`recording-clip ${selected?.filename === clip.filename ? "active" : ""}`} onClick={() => seekTo(Math.max(0, clip.start_second), true)}>
                <span>{clip.display_name}</span>
                <small>{mb(clip.size_bytes)}</small>
              </button>
            )) : (
              <div className="empty !border-0 !rounded-none">No segments found.</div>
            )}
          </div>}
        </div>
      </div>
    </main>
  );
}

function PlayerPlaceholder({ loading, hasError }: { loading: boolean; hasError: boolean }) {
  if (loading) {
    return (
      <div className="recording-player-placeholder loading" role="status" aria-live="polite">
        <div className="recording-loader-frame" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>Retrieving video</strong>
        <p>Preparing the selected recording.</p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="recording-player-placeholder missing" role="status" aria-live="polite">
        <BrokenVideoIcon />
        <strong>Video not found</strong>
        <p>This recording is unavailable or has not finished saving.</p>
      </div>
    );
  }

  return (
    <div className="recording-player-placeholder" role="status">
      <strong>No footage selected</strong>
      <p>Choose a recording segment or detection marker.</p>
    </div>
  );
}

function Timeline({ day, value, onSeek }: { day: RecordingDay | null; value: number; onSeek: (second: number) => void }) {
  const ticks = useMemo(() => Array.from({ length: 97 }, (_, index) => ({
    left: `${(index / 96) * 100}%`,
    major: index % 8 === 0,
  })), []);

  return (
    <div className="recording-timeline">
      <div className="recording-track">
        <div className="recording-ticks" aria-hidden="true">
          {ticks.map((tick, index) => <span key={index} className={tick.major ? "major" : ""} style={{ left: tick.left }} />)}
        </div>
        {day?.clips.map((clip) => (
          <span
            key={clip.filename}
            className="recording-coverage"
            style={{
              left: `${(Math.max(0, clip.start_second) / DAY_SECONDS) * 100}%`,
              width: `${((Math.min(DAY_SECONDS, clip.end_second) - Math.max(0, clip.start_second)) / DAY_SECONDS) * 100}%`,
            }}
          />
        ))}
        {day?.detection_ranges.map((range) => (
          <button
            key={range.id}
            className={`recording-range ${range.category}`}
            data-tooltip={`${range.label || `${range.category} detected`} · ${timeLabel(range.start_second)}-${timeLabel(range.end_second)}`}
            style={{
              left: `${(range.start_second / DAY_SECONDS) * 100}%`,
              width: `${(Math.max(6, range.end_second - range.start_second) / DAY_SECONDS) * 100}%`,
            }}
            aria-label={`${range.label || `${range.category} detected`} from ${timeLabel(range.start_second)} to ${timeLabel(range.end_second)}`}
            onClick={() => onSeek(Math.max(0, range.start_second - 2))}
          />
        ))}
        {day?.detections.map((detection) => (
          <button
            key={detection.event_id}
            className={`recording-marker ${detectionClass(detection.type)}`}
            data-tooltip={`${detection.label || detection.type.replace(/_/g, " ")} · ${timeLabel(detection.timeline_second)}`}
            style={{ left: `${(detection.timeline_second / DAY_SECONDS) * 100}%` }}
            aria-label={`${detection.label || detection.type.replace(/_/g, " ")} at ${timeLabel(detection.timeline_second)}`}
            onClick={() => onSeek(Math.max(0, detection.timeline_second - 2))}
          />
        ))}
        <span className="recording-playhead" style={{ left: `${(value / DAY_SECONDS) * 100}%` }} />
        <input
          type="range"
          min={0}
          max={DAY_SECONDS - 1}
          step={1}
          value={Math.floor(value)}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Recording timeline"
        />
        <div className="recording-timeline-labels">
          <span>{shortClockLabel(0)}</span>
          <strong>{timeLabel(value)}</strong>
          <span>{shortClockLabel(DAY_SECONDS - 1)}</span>
        </div>
      </div>
    </div>
  );
}

function BrokenVideoIcon() {
  return (
    <svg className="recording-broken-icon" viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <path d="M14 18h30a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H14z" />
      <path d="M52 30l8-5v22l-8-5" />
      <path d="M25 20l-5 10 8 7-7 15" />
      <path d="M34 20l-4 8 7 6-4 18" />
    </svg>
  );
}

type IconName =
  | "camera"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp"
  | "close"
  | "forward10"
  | "fullscreen"
  | "pause"
  | "play"
  | "rewind10"
  | "scissors"
  | "settings"
  | "stepBack"
  | "stepForward"
  | "stream"
  | "zoomIn"
  | "zoomOut";

const ICON_PATHS: Record<IconName, string[]> = {
  camera: ["M5 7h3l1.5-2h5L16 7h3v11H5z", "M12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  chevronRight: ["M9 18l6-6-6-6"],
  chevronUp: ["M6 15l6-6 6 6"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  forward10: ["M13 7l5 5-5 5", "M6 8v8", "M9 9h2v6", "M14 9h1.5v6"],
  fullscreen: ["M8 4H4v4", "M16 4h4v4", "M20 16v4h-4", "M4 16v4h4"],
  pause: ["M8 6v12", "M16 6v12"],
  play: ["M8 5v14l11-7z"],
  rewind10: ["M11 7l-5 5 5 5", "M18 8v8", "M13 9h2v6", "M8.5 9H10v6"],
  scissors: ["M4 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0z", "M4 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z", "M8 8l12 8", "M8 16l12-8"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M4 12h2", "M18 12h2", "M12 4v2", "M12 18v2", "M6.4 6.4l1.4 1.4", "M16.2 16.2l1.4 1.4", "M17.6 6.4l-1.4 1.4", "M7.8 16.2l-1.4 1.4"],
  stepBack: ["M11 7l-5 5 5 5", "M17 7v10"],
  stepForward: ["M13 7l5 5-5 5", "M7 7v10"],
  stream: ["M5 8a10 10 0 0 1 14 0", "M8 11a6 6 0 0 1 8 0", "M12 14h.01", "M12 14v5"],
  zoomIn: ["M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M16 16l4 4", "M11 8v6", "M8 11h6"],
  zoomOut: ["M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z", "M16 16l4 4", "M8 11h6"],
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICON_PATHS[name].map((path, index) => (
        <path key={index} d={path} />
      ))}
    </svg>
  );
}

function DetectionButton({ detection, onClick }: { detection: RecordingDetection; onClick: () => void }) {
  return (
    <button className={`recording-clip detection ${detectionClass(detection.type)}`} onClick={onClick}>
      <span>{detection.label || detection.type.replace(/_/g, " ")}</span>
      <small>{timeLabel(detection.timeline_second)}</small>
    </button>
  );
}

function DetectionRangeButton({ range, onClick }: { range: RecordingDetectionRange; onClick: () => void }) {
  return (
    <button className={`recording-clip detection ${range.category}`} onClick={onClick}>
      <span>{range.label || `${range.category} visible`}</span>
      <small>{timeLabel(range.start_second)}-{timeLabel(range.end_second)}</small>
    </button>
  );
}
