import { useEffect, useMemo, useState } from "react";
import { API_URL, Camera, RecordingClip, fetchCameras, fetchRecordings } from "../lib/api";
import { portalTodayDateInput } from "../lib/time";

function today() {
  return portalTodayDateInput();
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Recordings() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [day, setDay] = useState(today());
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const [selected, setSelected] = useState<RecordingClip | null>(null);
  const [loading, setLoading] = useState(false);
  const [nameQuery, setNameQuery] = useState("");

  useEffect(() => {
    fetchCameras().then((rows) => {
      setCameras(rows);
      if (rows[0]) setCameraId(rows[0].id);
    });
  }, []);

  const load = async () => {
    if (!cameraId || !day) return;
    setLoading(true);
    try {
      const rows = await fetchRecordings(cameraId, day);
      setClips(rows);
      setSelected((current) =>
        current && rows.some((clip) => clip.filename === current.filename) ? current : rows[0] || null,
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cameraId) load();
  }, [cameraId, day]);

  const filteredClips = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return clips;

    return clips.filter((clip) =>
      [clip.display_name, clip.filename].some((value) => value.toLowerCase().includes(q)),
    );
  }, [clips, nameQuery]);

  return (
    <main className="page">
      <div className="page-inner">
        <h2 className="page-title">Recordings</h2>
        <p className="page-sub">Search and play saved camera recordings.</p>

        {/* Filters */}
        <div className="recording-card">
          <div className="recording-filters">
            <label>
              Camera
              <select
                className="input"
                value={cameraId}
                onChange={(e) => {
                  setCameraId(e.target.value);
                  setNameQuery("");
                }}
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                className="input"
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setNameQuery("");
                }}
              />
            </label>

            <label>
              Recording time
              <select
                className="input"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                disabled={clips.length === 0}
              >
                <option value="">All recordings</option>
                {clips.map((clip) => (
                  <option key={clip.filename} value={clip.display_name}>
                    {clip.display_name}
                  </option>
                ))}
              </select>
            </label>

            <button className="btn primary" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Search"}
            </button>
          </div>
        </div>

        {/* Player + clip list */}
        <div className="recording-layout">
          <div className="recording-player">
            {selected ? (
              <>
                <video key={selected.url} controls autoPlay className="recording-video">
                  <source src={`${API_URL}${selected.url}`} type="video/mp4" />
                </video>

                <div className="recording-player-info">
                  <strong>{selected.display_name}</strong>
                  <a className="btn" href={`${API_URL}${selected.url}`} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </div>
              </>
            ) : (
              <div className="empty">No recording selected.</div>
            )}
          </div>

          <div className="recording-list">
            <h3>Clips</h3>

            {clips.length === 0 ? (
              <div className="empty !border-0 !rounded-none">No recordings found for this date.</div>
            ) : filteredClips.length === 0 ? (
              <div className="empty !border-0 !rounded-none">No recordings match this time filter.</div>
            ) : (
              filteredClips.map((clip) => (
                <button
                  key={clip.filename}
                  className={`recording-clip ${selected?.filename === clip.filename ? "active" : ""}`}
                  onClick={() => setSelected(clip)}
                >
                  <span>{clip.display_name}</span>
                  <small>{mb(clip.size_bytes)}</small>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
