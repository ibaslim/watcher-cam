// API + MediaMTX endpoints.
//
// By default we target the SAME host the dashboard was opened from, on the
// conventional ports — so reaching the dashboard at http://<server-lan-ip>:5173
// or through a port-forward "just works" without re-baking the bundle for each
// deployment. Set VITE_API_URL / VITE_MEDIAMTX_URL at build time only for
// reverse-proxy / HTTPS setups where the API lives on a different origin.
function sameHost(port: number): string {
  if (typeof window === "undefined") return `http://localhost:${port}`;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export const API_URL = import.meta.env.VITE_API_URL || sameHost(8100);
export const MEDIAMTX_URL = import.meta.env.VITE_MEDIAMTX_URL || sameHost(8889);

// ------------- auth -------------
const TOKEN_KEY = "cs-auth-token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchAuthStatus(): Promise<{ auth_required: boolean }> {
  const r = await fetch(`${API_URL}/api/auth/status`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export type CurrentUser = {
  id: number;
  full_name: string;
  username: string;
  role: "administrator" | "operator";
  is_active: boolean;
};

export async function login(
  username: string,
  password: string,
): Promise<{ token: string; auth_required: boolean; user: CurrentUser }> {
  try {
    const r = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (r.status === 401) throw new Error("invalid username or password");
    if (!r.ok) throw new Error(`login request failed (${r.status})`);

    return r.json();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`cannot reach the backend at ${API_URL}`);
    }
    throw error;
  }
}

export async function fetchMe(): Promise<CurrentUser> {
  const r = await fetch(`${API_URL}/api/auth/me`, authed());
  return ok<CurrentUser>(r);
}
export async function renewSession(): Promise<string> {
    const r = await fetch(
        `${API_URL}/api/auth/renew`,
        authed({
            method: "POST",
        }),
    );

    if (!r.ok) {
        throw new Error("session renewal failed");
    }

    const data = await r.json();

    setToken(data.token);

    return data.token;
}

export type Camera = {
  id: string;
  name: string;
  webrtc_url: string;
  hls_url: string;
  detect: boolean;
  host?: string;
  rtsp_port?: number;
  http_port?: number;
  username?: string;
  channel?: number;
  recording_enabled: boolean;
  rtsp_url_override?: string;
  recorder_id?: string;
  recorder_name?: string;
  // Only set on create/update responses: a non-fatal message when the camera
  // saved but its stream couldn't be registered with MediaMTX.
  stream_warning?: string | null;
};

export type CameraInput = {
  id: string;
  name: string;
  host: string;
  rtsp_port: number;
  http_port: number;
  username: string;
  password: string;
  channel: number;
  detect: boolean;
  recording_enabled: boolean;
  rtsp_url_override: string;
};

export type EventRow = {
  id: number;
  entity_id?: string | null;
  camera_id: string;
  created_at: string;
  source: "hikvision" | "yolo";
  event_type: string;
  label: string | null;
  confidence: number | null;
  snapshot_url: string | null;
};

export type ClassificationRow = {
  id: number;
  entity_id: string;
  camera_id: string;
  category: string;
  label: string | null;
  crop_url: string | null;
  image_url?: string | null;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
  confidence: number | null;
  source_event_type: string | null;
  classification_key: string;
};

export type PersonIdentityRow = {
  entity_id: string;
  display_name: string | null;
  status: string;
  image_url: string | null;
  appearance_count: number;
  first_seen: string;
  last_seen: string;
};

export type PersonAppearanceRow = {
  id: number;
  entity_id: string;
  event_id: number | null;
  camera_id: string;
  track_id: number | null;
  snapshot_url: string | null;
  person_crop_url: string | null;
  face_crop_url: string | null;
  match_score: number | null;
  face_quality: number | null;
  match_method: string;
  created_at: string;
};

export type AmbiguousAppearanceRow = {
  id: number;
  entity_id: string;
  event_id: number | null;
  camera_id: string;
  track_id: number | null;
  snapshot_url: string | null;
  person_crop_url: string | null;
  reason: string;
  created_at: string;
};

export type ReportSummary = {
  total_events: number;
  intrusion: number;
  line_crossing: number;
  camera_breakdown: {
    camera_id: string;
    camera_name: string;
    total: number;
    intrusion: number;
    line_crossing: number;
  }[];
};

export type ReportFilters = {
  camera_id?: string;
  event_type?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
};
export type AppUser = {
  id: number;
  full_name: string;
  username: string;
  role: "administrator" | "operator";
  is_active: boolean;
  created_at: string;
};

export type UserCreateInput = {
  full_name: string;
  username: string;
  password: string;
  role: "administrator" | "operator";
};

export type UserUpdateInput = {
  full_name: string;
  password: string;
  role: "administrator" | "operator";
  is_active: boolean;
};

async function ok<T>(r: Response): Promise<T> {
  if (r.status === 401) {
    setToken("");
    // Trigger a reload so the App re-runs the auth gate.
    window.location.reload();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function authed(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers || {}), ...authHeaders() } };
}

// ------------- cameras -------------
export const fetchCameras = () =>
  fetch(`${API_URL}/api/cameras`, authed()).then((r) => ok<Camera[]>(r));
export const createCamera = (body: CameraInput) =>
  fetch(`${API_URL}/api/cameras`, authed({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).then((r) => ok<Camera>(r));
export const updateCamera = (id: string, body: Omit<CameraInput, "id">) =>
  fetch(`${API_URL}/api/cameras/${id}`, authed({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).then((r) => ok<Camera>(r));
export async function deleteCamera(id: string): Promise<void> {
  const r = await fetch(`${API_URL}/api/cameras/${id}`, authed({ method: "DELETE" }));
  if (r.status === 401) { setToken(""); window.location.reload(); throw new Error("unauthorized"); }
  if (!r.ok && r.status !== 204) throw new Error(await r.text());
}
export async function deleteRecorder(id: string): Promise<void> {
  const r = await fetch(`${API_URL}/api/cameras/recorders/${id}`, authed({ method: "DELETE" }));
  if (r.status === 401) { setToken(""); window.location.reload(); throw new Error("unauthorized"); }
  if (!r.ok && r.status !== 204) throw new Error(await r.text());
}
export type EventFilters = {
  limit?: number;
  date_from?: string;
  date_to?: string;
  camera_id?: string;
  entity_id?: string;
};

export const fetchEvents = (filters: EventFilters = {}) => {
  const p = new URLSearchParams();
  if (filters.limit !== undefined) p.set("limit", String(filters.limit));
  if (filters.date_from) p.set("date_from", filters.date_from);
  if (filters.date_to) p.set("date_to", filters.date_to);
  if (filters.camera_id) p.set("camera_id", filters.camera_id);
  if (filters.entity_id) p.set("entity_id", filters.entity_id);

  return fetch(`${API_URL}/api/events?${p.toString()}`, authed()).then((r) => ok<EventRow[]>(r));
};

export type ClassificationFilters = {
  date_from?: string;
  date_to?: string;
};

export const fetchClassifications = (
  cameraId: string,
  category?: string,
  limit = 12,
  filters: ClassificationFilters = {},
) => {
  const p = new URLSearchParams();
  p.set("camera_id", cameraId);
  if (category) p.set("category", category);
  p.set("limit", String(limit));
  if (filters.date_from) p.set("date_from", filters.date_from);
  if (filters.date_to) p.set("date_to", filters.date_to);

  return fetch(`${API_URL}/api/events/classifications?${p.toString()}`, authed()).then((r) => ok<ClassificationRow[]>(r));
};

export const fetchPersons = (cameraId?: string, filters: ClassificationFilters = {}) => {
  const p = new URLSearchParams();
  if (cameraId) p.set("camera_id", cameraId);
  if (filters.date_from) p.set("date_from", filters.date_from);
  if (filters.date_to) p.set("date_to", filters.date_to);
  return fetch(`${API_URL}/api/events/persons?${p.toString()}`, authed()).then((r) => ok<PersonIdentityRow[]>(r));
};

export const fetchPersonAppearances = (entityId: string, cameraId?: string) => {
  const p = new URLSearchParams();
  if (cameraId) p.set("camera_id", cameraId);
  return fetch(`${API_URL}/api/events/persons/${encodeURIComponent(entityId)}/appearances?${p.toString()}`, authed()).then((r) => ok<PersonAppearanceRow[]>(r));
};

export const fetchAmbiguousAppearances = (cameraId?: string) => {
  const p = new URLSearchParams();
  if (cameraId) p.set("camera_id", cameraId);
  return fetch(`${API_URL}/api/events/ambiguous?${p.toString()}`, authed()).then((r) => ok<AmbiguousAppearanceRow[]>(r));
};
export async function ptzMove(id: string, dir: string): Promise<void> {
  await fetch(`${API_URL}/api/ptz/${id}/move/${dir}`, authed({ method: "POST" }));
}
export async function ptzZoom(id: string, dir: "in" | "out" | "stop"): Promise<void> {
  await fetch(`${API_URL}/api/ptz/${id}/zoom/${dir}`, authed({ method: "POST" }));
}

// ------------- reports -------------
function reportQuery(filters: ReportFilters): string {
  const p = new URLSearchParams();

  if (filters.camera_id) p.set("camera_id", filters.camera_id);
  if (filters.event_type) p.set("event_type", filters.event_type);
  if (filters.source) p.set("source", filters.source);
  if (filters.date_from) p.set("date_from", filters.date_from);
  if (filters.date_to) p.set("date_to", filters.date_to);

  return p.toString();
}

export const fetchReportEvents = (filters: ReportFilters, limit = 500, offset = 0) => {
  const query = new URLSearchParams(reportQuery(filters));
  query.set("limit", String(limit));
  query.set("offset", String(offset));

  return fetch(`${API_URL}/api/reports/events?${query.toString()}`, authed()).then((r) =>
    ok<EventRow[]>(r),
  );
};
export async function deleteEventsBulk(eventIds: number[]): Promise<{
    ok: boolean;
    deleted_events: number;
    deleted_snapshots: number;
}> {
    const r = await fetch(`${API_URL}/api/events/bulk`, authed({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_ids: eventIds }),
    }));

    if (r.status === 401) {
        setToken("");
        window.location.reload();
        throw new Error("unauthorized");
    }

    if (!r.ok) throw new Error(await r.text());

    return r.json();
}
export const fetchReportSummary = (filters: ReportFilters) =>
  fetch(`${API_URL}/api/reports/summary?${reportQuery(filters)}`, authed()).then((r) =>
    ok<ReportSummary>(r),
  );

export async function downloadEventsCsv(filters: ReportFilters): Promise<void> {
  const r = await fetch(`${API_URL}/api/reports/events.csv?${reportQuery(filters)}`, authed());

  if (r.status === 401) {
    setToken("");
    window.location.reload();
    throw new Error("unauthorized");
  }

  if (!r.ok) throw new Error(await r.text());

  const blob = await r.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "ai-camera-events-report.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(url);
}
export function logout(): void {
  setToken("");
  window.location.reload();
}
// ------------- users -------------
export const fetchUsers = () =>
  fetch(`${API_URL}/api/users`, authed()).then((r) => ok<AppUser[]>(r));

export const createUser = (body: UserCreateInput) =>
  fetch(`${API_URL}/api/users`, authed({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).then((r) => ok<AppUser>(r));

export const updateUser = (id: number, body: UserUpdateInput) =>
  fetch(`${API_URL}/api/users/${id}`, authed({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).then((r) => ok<AppUser>(r));

export async function deleteUser(id: number): Promise<void> {
  const r = await fetch(`${API_URL}/api/users/${id}`, authed({ method: "DELETE" }));

  if (r.status === 401) {
    setToken("");
    window.location.reload();
    throw new Error("unauthorized");
  }

  if (!r.ok && r.status !== 204) throw new Error(await r.text());
}
// ------------- recordings -------------
export type RecordingClip = {
  camera_id: string;
  day: string;
  filename: string;
  display_name: string;
  size_bytes: number;
  url: string;
};

export const fetchRecordings = (cameraId: string, day: string) =>
  fetch(`${API_URL}/api/recordings?camera_id=${cameraId}&day=${day}`, authed()).then((r) =>
    ok<RecordingClip[]>(r),
  );
