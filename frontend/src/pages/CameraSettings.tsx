import { useEffect, useState } from "react";
import {
  Camera,
  Guard,
  PostConfig,
  fetchCameras,
  fetchGuards,
  fetchPost,
  savePost,
} from "../lib/api";
import { InfoTip } from "../components/InfoTip";

export function CameraSettings() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [guards, setGuards] = useState<Guard[]>([]);

  useEffect(() => {
    fetchCameras().then(setCameras).catch(() => setCameras([]));
    fetchGuards().then(setGuards).catch(() => setGuards([]));
  }, []);

  return (
    <main className="page">
      <div className="page-inner">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="page-title !m-0">Guard Posts</h2>
        </div>

        <p className="page-sub">
          Configure which cameras are guard posts, assign primary/backup guards, and set duty hours.
          Leave <em>Is guarded</em> off for perimeter cameras that do not require a guard.
        </p>

        <div data-tour="posts" className="space-y-4 max-w-3xl">
          {cameras.length === 0 && <div className="empty">No cameras configured.</div>}
          {cameras.map((c) => (
            <CameraRow key={c.id} camera={c} guards={guards} />
          ))}
        </div>
      </div>
    </main>
  );
}

function CameraRow({ camera, guards }: { camera: Camera; guards: Guard[] }) {
  const [cfg, setCfg] = useState<PostConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchPost(camera.id).then(setCfg).catch(() => setCfg(null));
  }, [camera.id]);

  if (!cfg) {
    return (
      <div className="card p-4 text-theme-muted text-sm">
        {camera.name} · loading…
      </div>
    );
  }

  const update = <K extends keyof PostConfig>(key: K, value: PostConfig[K]) => {
    setCfg({ ...cfg, [key]: value });
    setSaved(false);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const { camera_id: _ignored, ...body } = cfg;

      body.is_guarded = Boolean(
        body.assigned_guard_id ||
        body.backup_guard_id ||
        body.alert_guard_absent ||
        body.alert_wrong_guard ||
        body.alert_unknown_person
      );

      const next = await savePost(camera.id, body);
      setCfg(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded="false"
        className="w-full card p-4 text-left flex items-center justify-between gap-3 hover:bg-verkada-hover transition-colors cursor-pointer"
      >
        <span className="font-semibold text-theme">
          {cfg.post_name || camera.name}{" "}
          <span className="text-theme-muted font-normal">- {camera.id}</span>
        </span>
        <span className="text-theme-muted text-lg">+</span>
      </button>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-theme">
          {camera.name} <span className="text-theme-muted font-normal">· {camera.id}</span>
        </div>
        <button type="button" className="btn" onClick={() => setExpanded(false)}>
          Close
        </button>
      </div>

      <div className="form-grid">
        <label>Post name</label>
        <input
          className="input"
          type="text"
          placeholder="e.g. Main Gate"
          value={cfg.post_name}
          onChange={(e) => update("post_name", e.target.value)}
        />

        <label>
          Assigned guard{" "}
          <InfoTip text="Primary guard assigned to this post. Future reports will use this to show duty coverage and compliance." />
        </label>
        <select
          className="input"
          value={cfg.assigned_guard_id ?? ""}
          onChange={(e) =>
            update("assigned_guard_id", e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">No guard assigned</option>
          {guards.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <label>
          Backup guard{" "}
          <InfoTip text="Optional backup guard for the post if primary guard is unavailable." />
        </label>
        <select
          className="input"
          value={cfg.backup_guard_id ?? ""}
          onChange={(e) =>
            update("backup_guard_id", e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">No backup guard</option>
          {guards.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <label>
          Duty hours{" "}
          <InfoTip text="The hours this post must be staffed. Use 24-hour clock. Example: 8 to 20 means 8AM to 8PM." />
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={0}
            max={23}
            className="input w-[90px]"
            value={cfg.duty_start_hour}
            onChange={(e) => update("duty_start_hour", Number(e.target.value))}
          />
          <span className="text-theme-muted">→</span>
          <input
            type="number"
            min={1}
            max={24}
            className="input w-[90px]"
            value={cfg.duty_end_hour}
            onChange={(e) => update("duty_end_hour", Number(e.target.value))}
          />
          <span className="text-theme-muted text-xs">24-hour clock</span>
        </div>

        <label>
          Absence threshold{" "}
          <InfoTip text="How many minutes the post can be empty before an absence alert is raised." />
        </label>
        <div className="flex gap-2 items-center">
          <input
            type="number"
            min={1}
            max={240}
            className="input w-[90px]"
            value={cfg.absence_threshold_min}
            onChange={(e) => update("absence_threshold_min", Number(e.target.value))}
          />
          <span className="text-theme-muted text-xs">minutes without guard → alert</span>
        </div>

        <label>
          AI alert rules{" "}
          <InfoTip text="Choose which AI events should generate alerts for this camera/post." />
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.alert_guard_absent}
              onChange={(e) => update("alert_guard_absent", e.target.checked)}
            />
            <span className="text-xs text-theme-muted">Alert when assigned guard is missing</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.alert_wrong_guard}
              onChange={(e) => update("alert_wrong_guard", e.target.checked)}
            />
            <span className="text-xs text-theme-muted">Alert when wrong guard is present at this post</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.alert_unknown_person}
              onChange={(e) => update("alert_unknown_person", e.target.checked)}
            />
            <span className="text-xs text-theme-muted">Alert unknown/unverified persons</span>
          </label>
        </div>
      </div>

      <div className="mt-4 flex gap-2 items-center">
        <button className="btn primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save Post"}
        </button>
        {saved && <span className="text-emerald-400 text-xs">saved ✓</span>}
      </div>
    </div>
  );
}
