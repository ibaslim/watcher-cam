import { API_URL, getToken } from "./api";

export type WsEvent = {
  id: number;
  camera_id: string;
  source: "hikvision" | "yolo";
  event_type: string;
  label?: string | null;
  confidence?: number | null;
  snapshot_path?: string | null;
  created_at: string;
};

export type WsStatus = "connecting" | "open" | "closed";

export function connectEvents(
  onEvent: (e: WsEvent) => void,
  onStatus?: (status: WsStatus) => void,
): () => void {
  const token = getToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  const wsUrl = API_URL.replace(/^http/, "ws") + "/ws" + qs;

  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 1000;

  const open = () => {
    if (closed) return;

    onStatus?.("connecting");
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      retry = 1000;
      onStatus?.("open");
    };

    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      onStatus?.("closed");

      if (closed) return;

      setTimeout(open, retry);
      retry = Math.min(retry * 2, 10_000);
    };

    ws.onerror = () => {
      onStatus?.("closed");
      ws?.close();
    };
  };

  open();

  return () => {
    closed = true;
    onStatus?.("closed");
    ws?.close();
  };
}

export async function requestDesktopNotifications(): Promise<void> {
  if (typeof Notification === "undefined") return;

  if (Notification.permission === "default") {
    await Notification.requestPermission().catch(() => {});
  }
}

export function notify(title: string, body: string): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  try {
    new Notification(title, { body });
  } catch {
    /* ignore */
  }
}
