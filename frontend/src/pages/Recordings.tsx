import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { portalTodayDateInput, portalDateInput, formatPortalDateTime, PORTAL_TIME_ZONE_LABEL } from "../lib/time";

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
  const [params, setParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const cameraId = params.get("camera") || cameras[0]?.id || "";
  const at = params.get("at") || "";
  const eventId = params.get("event");
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

  const load = () => { setAutoRetry(0); setRevision(value => value + 1); };

  function browse(nextCamera: string, nextDay: string) {
    setAutoRetry(0);
    setParams({ camera: nextCamera, day: nextDay });
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

  const activeClipOffset = selected ? Math.max(0, timelineSecond - selected.start_second) : 0;
  const cameraName = cameras.find(camera => camera.id === cameraId)?.name || cameraId;

  const currentRanges = useMemo(() => {
    if (!day) return [];
    return day.detection_ranges.filter((range) => timelineSecond >= range.start_second && timelineSecond <= Math.max(range.start_second + 1, range.end_second));
  }, [day, timelineSecond]);

  return (
    <main className="page">
      <div className="page-inner">
        <h2 className="page-title">Recordings</h2>
        <p className="page-sub">Play a full day of footage with detection markers.</p>

        {at && validTime && <div className="recording-jump-notice" role="status"><div><strong>Detection playback</strong><p>{formatPortalDateTime(at)} {PORTAL_TIME_ZONE_LABEL} · {cameraName}{loading && autoRetry > 0 ? ` · waiting for footage ${autoRetry}/${RECORDING_JUMP_MAX_RETRIES}` : ""}</p></div><button className="btn" onClick={() => browse(cameraId, day?.day || dayParam)}>Browse this day</button></div>}
        {(error || cameraError) && <div role="alert" className="alert alert-warn mb-4"><span>{error || cameraError}</span><button className="btn" onClick={load} disabled={loading}>Retry</button></div>}

        <div className="recording-card">
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
        </div>

        <div className="recording-layout">
          <div className="recording-player">
            {selected ? (
              <>
                <video
                  ref={videoRef}
                  key={selected.url}
                  src={`${API_URL}${selected.url}`}
                  controls
                  autoPlay
                  playsInline
                  className="recording-video"
                  onLoadedMetadata={(event) => {
                    if (pendingSecond == null) return;
                    event.currentTarget.currentTime = Math.max(0, pendingSecond - selected.start_second);
                  }}
                  onTimeUpdate={(event) => {
                    setTimelineSecond(Math.max(0, Math.min(DAY_SECONDS - 1, selected.start_second + event.currentTarget.currentTime)));
                  }}
                  onEnded={() => {
                    if (!day) return;
                    const nextSecond = Math.min(DAY_SECONDS - 1, selected.end_second + 0.01);
                    const nextClip = findClip(day, nextSecond);
                    if (nextClip) seekTo(nextSecond, true);
                  }}
                  onError={() => setError("This recording cannot be played yet. It may still be saving or is no longer available. Please retry.")}
                />

                <div className="recording-player-info">
                  <div>
                    <strong>{timeLabel(timelineSecond)}</strong>
                    <span>{selected.display_name} · {timeLabel(activeClipOffset)} in segment</span>
                  </div>
                  <a className="btn" href={`${API_URL}${selected.url}`} target="_blank" rel="noreferrer">Download segment</a>
                </div>
              </>
            ) : (
              <div className="empty">{loading ? "Finding recording..." : "No footage selected."}</div>
            )}

            <Timeline day={day} value={timelineSecond} onSeek={(second) => seekTo(second, true)} />
          </div>

          <div className="recording-list">
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
          </div>
        </div>
      </div>
    </main>
  );
}

function Timeline({ day, value, onSeek }: { day: RecordingDay | null; value: number; onSeek: (second: number) => void }) {
  return (
    <div className="recording-timeline">
      <div className="recording-timeline-labels">
        <span>00:00</span>
        <strong>{timeLabel(value)}</strong>
        <span>24:00</span>
      </div>
      <div className="recording-track">
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
            style={{
              left: `${(range.start_second / DAY_SECONDS) * 100}%`,
              width: `${(Math.max(6, range.end_second - range.start_second) / DAY_SECONDS) * 100}%`,
            }}
            title={`${range.category} ${timeLabel(range.start_second)}-${timeLabel(range.end_second)}`}
            onClick={() => onSeek(Math.max(0, range.start_second - 2))}
          />
        ))}
        {day?.detections.map((detection) => (
          <button
            key={detection.event_id}
            className={`recording-marker ${detectionClass(detection.type)}`}
            style={{ left: `${(detection.timeline_second / DAY_SECONDS) * 100}%` }}
            title={`${detection.label || detection.type} ${timeLabel(detection.timeline_second)}`}
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
      </div>
    </div>
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
