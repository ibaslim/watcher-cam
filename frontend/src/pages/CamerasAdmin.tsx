import { FormEvent, useEffect, useState } from "react";
import { InfoTip } from "../components/InfoTip";
import {
  Camera,
  Site,
  CameraInput,
  createCamera,
  deleteCamera,
  deleteRecorder,
  fetchCameras,
  updateCamera,
} from "../lib/api";

const EMPTY: CameraInput = {
  site_id: "",
  id: "",
  name: "",
  host: "",
  rtsp_port: 554,
  http_port: 80,
  username: "",
  password: "",
  channel: 101,
  detect: true,
  recording_enabled: true,
  rtsp_url_override: "",
};

export function CamerasAdmin({ onCamerasChanged, site, sites }: { onCamerasChanged?: () => void; site: Site; sites: Site[] }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [editing, setEditing] = useState<CameraInput | null>(null);
  const [editingExistingId, setEditingExistingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [expandedRecorders, setExpandedRecorders] = useState<Record<string, boolean>>({});
  const [bulkUpdatingRecorderId, setBulkUpdatingRecorderId] = useState<string | null>(null);

  const reload = () => fetchCameras().then(rows => setCameras(rows.filter(c => c.site_id === site.id))).catch(e => setError((e as Error).message));

  useEffect(() => {
    reload();
  }, []);

  const onNew = () => {
    setError(null);
    setWarning(null);
    setEditingExistingId(null);
    setEditing({ ...EMPTY, site_id: site.id });
  };

  const onEdit = (c: Camera) => {
    setError(null);
    setWarning(null);
    setEditingExistingId(c.id);
    setEditing({
      site_id: c.site_id || site.id,
      id: c.id,
      name: c.name,
      host: c.host ?? "",
      rtsp_port: c.rtsp_port ?? 554,
      http_port: c.http_port ?? 80,
      username: c.username ?? "",
      password: "",
      channel: c.channel ?? 101,
      detect: c.detect,
      recording_enabled: c.recording_enabled ?? true,
      rtsp_url_override: c.rtsp_url_override ?? "",
    });
  };

  const onDelete = async (c: Camera) => {
    if (!confirm(`Delete camera "${c.name}" (${c.id})?`)) return;

    try {
      await deleteCamera(c.id);
      await reload();
      onCamerasChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onDeleteRecorder = async (recorderId: string, recorderName: string, count: number) => {
    if (!confirm(`Delete NVR/DVR "${recorderName}" and ALL its cameras across every location? ${count} are in this location.`)) return;

    try {
      await deleteRecorder(recorderId);
      await reload();
      onCamerasChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toCameraUpdate = (camera: Camera, changes: Partial<Pick<CameraInput, "detect" | "recording_enabled">>): Omit<CameraInput, "id"> => ({
    site_id: camera.site_id || site.id,
    name: camera.name,
    host: camera.host ?? "",
    rtsp_port: camera.rtsp_port ?? 554,
    http_port: camera.http_port ?? 80,
    username: camera.username ?? "",
    password: "",
    channel: camera.channel ?? 101,
    detect: changes.detect ?? camera.detect,
    recording_enabled: changes.recording_enabled ?? camera.recording_enabled ?? true,
    rtsp_url_override: camera.rtsp_url_override ?? "",
  });

  const toggleRecorderExpanded = (recorderId: string) => {
    setExpandedRecorders((prev) => ({ ...prev, [recorderId]: !prev[recorderId] }));
  };

  const applyRecorderSetting = async (
    group: { id: string; name: string; cameras: Camera[] },
    changes: Partial<Pick<CameraInput, "detect" | "recording_enabled">>,
  ) => {
    setError(null);
    setWarning(null);
    setBulkUpdatingRecorderId(group.id);

    try {
      const warnings: string[] = [];

      for (const camera of group.cameras) {
        const saved = await updateCamera(camera.id, toCameraUpdate(camera, changes));

        if (saved.stream_warning) {
          warnings.push(`${camera.name}: ${saved.stream_warning}`);
        }
      }

      await reload();
      onCamerasChanged?.();

      if (warnings.length > 0) {
        setWarning(warnings.join("; "));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkUpdatingRecorderId(null);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    setWarning(null);

    try {
      let saved: Camera;
      if (editingExistingId) {
        const { id: _ignored, ...body } = editing;
        saved = await updateCamera(editingExistingId, body);
      } else {
        saved = await createCamera(editing);
      }

      setEditing(null);
      setEditingExistingId(null);
      await reload();
      onCamerasChanged?.();

      if (saved.stream_warning) setWarning(saved.stream_warning);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const recorderGroups = Array.from(
    cameras
      .filter((camera) => camera.recorder_id)
      .reduce((groups, camera) => {
        const recorderId = camera.recorder_id!;
        const existing = groups.get(recorderId);

        if (existing) {
          existing.cameras.push(camera);
        } else {
          groups.set(recorderId, {
            id: recorderId,
            name: camera.recorder_name || recorderId,
            host: camera.host || "",
            cameras: [camera],
          });
        }

        return groups;
      }, new Map<string, { id: string; name: string; host: string; cameras: Camera[] }>())
      .values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const standaloneCameras = cameras.filter((camera) => !camera.recorder_id);

  return (
    <main className="page">
      <div className="page-inner">
        <div className="flex items-center justify-between mb-4">
          <h2 className="page-title !m-0">{site.name}</h2>
          <div className="flex gap-2">
            <button className="btn primary" onClick={onNew} data-tour="add-camera">+ Add camera</button>
          </div>
        </div>

        <p className="page-sub">
          Add and manage individual Hikvision cameras.
          Camera changes notify MediaMTX and the detector automatically.
          For non-Hikvision RTSP sources, use <em>RTSP URL override</em>.
        </p>

        <div className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          New cameras default to detection on. Turn it off only when you want the camera to record without AI processing.
        </div>

        {error && (
          <div className="alert alert-error mb-3">
            {error}
          </div>
        )}

        {warning && (
          <div className="alert alert-warn mb-3 justify-between">
            <span>Camera saved/imported, but a stream warning occurred: {warning}</span>
            <button className="btn-link" onClick={() => setWarning(null)}>dismiss</button>
          </div>
        )}

        {cameras.length === 0 && (
          <div className="empty">No cameras yet.</div>
        )}

        {recorderGroups.map((group) => (
          <section key={group.id} className="panel overflow-hidden mb-3.5">
                <div className="flex justify-between items-center px-3.5 py-3 bg-verkada-canvas border-b border-verkada-border">
              <div>
                <div className="font-semibold text-theme">NVR/DVR: {group.name}</div>
                <div className="text-theme-muted text-xs mt-0.5">
                  <code>{group.id}</code> · {group.host || "no host"} · {group.cameras.length} camera(s)
                </div>
              </div>
              <button className="btn btn-danger" onClick={() => onDeleteRecorder(group.id, group.name, group.cameras.length)}>
                Delete NVR/DVR
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-verkada-border flex-wrap">
              <button className="btn" onClick={() => toggleRecorderExpanded(group.id)}>
                {expandedRecorders[group.id] ? "Collapse cameras" : "Expand cameras"}
              </button>

              <div className="flex items-center gap-3 flex-wrap">
                <Checkbox
                  checked={group.cameras.every((camera) => camera.detect)}
                  onChange={(checked) => applyRecorderSetting(group, { detect: checked })}
                  text={bulkUpdatingRecorderId === group.id ? "Updating detector..." : "Detector for all cameras"}
                />
                <Checkbox
                  checked={group.cameras.every((camera) => camera.recording_enabled)}
                  onChange={(checked) => applyRecorderSetting(group, { recording_enabled: checked })}
                  text={bulkUpdatingRecorderId === group.id ? "Updating recording..." : "Recording for all cameras"}
                />
              </div>
            </div>

            {expandedRecorders[group.id] && (
              <CameraTable cameras={group.cameras} onEdit={onEdit} onDelete={onDelete} />
            )}
          </section>
        ))}

        {standaloneCameras.length > 0 && (
          <section className="panel overflow-hidden">
            <div className="px-3.5 py-3 bg-verkada-canvas border-b border-verkada-border font-semibold text-theme">
              Individual cameras
            </div>
            <CameraTable cameras={standaloneCameras} onEdit={onEdit} onDelete={onDelete} />
          </section>
        )}

        {editing && (
          <CameraForm
            saving={saving}
            sites={sites}
            error={error}
            value={editing}
            onChange={setEditing}
            isEdit={editingExistingId !== null}
            onSubmit={onSubmit}
            onCancel={() => {
              setEditing(null);
              setEditingExistingId(null);
              setError(null);
            }}
          />
        )}

      </div>
    </main>
  );
}

function CameraTable(props: {
  cameras: Camera[];
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Host</th>
          <th>Channel</th>
          <th>Detect</th>
          <th>Recording</th>
          <th className="w-40"></th>
        </tr>
      </thead>
      <tbody>
        {props.cameras.map((c) => (
          <tr key={c.id}>
            <td><code>{c.id}</code></td>
            <td>{c.name}</td>
            <td>{c.host || <span className="text-theme-muted">—</span>}</td>
            <td>{c.channel ?? "—"}</td>
            <td>
              <span className={`badge ${c.detect ? "badge-ok" : "badge-muted"}`}>
                {c.detect ? "on" : "off"}
              </span>
            </td>
            <td>
              <span className={`badge ${c.recording_enabled ? "badge-ok" : "badge-muted"}`}>
                {c.recording_enabled ? "on" : "off"}
              </span>
            </td>
            <td>
              <div className="flex gap-2 items-center">
                <button className="btn" onClick={() => props.onEdit(c)}>Edit</button>
                <button className="btn btn-danger" onClick={() => props.onDelete(c)}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CameraForm(props: {
  saving: boolean;
  sites: Site[];
  error: string | null;
  value: CameraInput;
  onChange: (v: CameraInput) => void;
  isEdit: boolean;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  const { value, onChange, isEdit, onSubmit, onCancel } = props;
  const set = <K extends keyof CameraInput>(k: K, v: CameraInput[K]) => onChange({ ...value, [k]: v });

  return (
    <Modal>
      <form onSubmit={onSubmit} data-tour="cam-form" className="modal max-w-[560px]">
        <h3>{isEdit ? `Edit ${value.id}` : "Add camera"}</h3>

        {props.error && <div role="alert" className="alert alert-error mb-3">{props.error}</div>}
        <div className="form-grid">
          <label htmlFor="camera-site">Location</label>
          <select id="camera-site" className="input" required value={value.site_id} onChange={e => set("site_id", e.target.value)}>
            {props.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          <label>ID</label>
          <input className="input" type="text" value={value.id} disabled={isEdit} required pattern="[A-Za-z0-9_-]+" placeholder="e.g. gate-1" onChange={(e) => set("id", e.target.value)} />

          <label>Name</label>
          <input className="input" type="text" value={value.name} required placeholder="e.g. Main Gate" onChange={(e) => set("name", e.target.value)} />

          <label>Host / IP <InfoTip text="The camera's address on your network. Leave blank if you use an RTSP URL override below." /></label>
          <input className="input" type="text" value={value.host} placeholder="192.168.1.64" onChange={(e) => set("host", e.target.value)} />

          <label>Username</label>
          <input className="input" type="text" value={value.username} onChange={(e) => set("username", e.target.value)} />

          <label>Password</label>
          <input className="input" type="password" value={value.password} placeholder={isEdit ? "(leave blank to keep)" : ""} onChange={(e) => set("password", e.target.value)} />

          <label>RTSP port</label>
          <input className="input w-[120px]" type="number" min={1} max={65535} value={value.rtsp_port} onChange={(e) => set("rtsp_port", Number(e.target.value))} />

          <label>HTTP port</label>
          <input className="input w-[120px]" type="number" min={1} max={65535} value={value.http_port} onChange={(e) => set("http_port", Number(e.target.value))} />

          <label>Channel <InfoTip text="Hikvision stream channel: 101 = channel 1 main stream, 102 = channel 1 substream, 201 = channel 2 main stream." /></label>
          <input className="input w-[120px]" type="number" min={1} value={value.channel} onChange={(e) => set("channel", Number(e.target.value))} />

          <label>Face / AI detect</label>
          <Checkbox checked={value.detect} onChange={(checked) => set("detect", checked)} text="Run detector on this camera" />

          <label>Recording</label>
          <Checkbox checked={value.recording_enabled} onChange={(checked) => set("recording_enabled", checked)} text="Save continuous recordings for this camera" />

          <label>RTSP URL override <InfoTip text="For non-Hikvision sources, paste a full RTSP URL to use instead of host/credentials." /></label>
          <input className="input" type="text" value={value.rtsp_url_override} placeholder="(optional) rtsp://..." onChange={(e) => set("rtsp_url_override", e.target.value)} />
        </div>

        <div className="mt-4 flex gap-2 justify-end">
          <button type="button" className="btn" disabled={props.saving} onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={props.saving}>{props.saving ? "Saving…" : isEdit ? "Save" : "Add"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="modal-overlay">
      {children}
    </div>
  );
}

function Checkbox(props: { checked: boolean; onChange: (checked: boolean) => void; text: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="text-xs text-theme-muted">{props.text}</span>
    </label>
  );
}
