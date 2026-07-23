#!/usr/bin/env bash
# Publish the MacBook's built-in webcam to MediaMTX as RTSP so the dashboard
# can display it — useful for testing the pipeline without a real Hikvision.
#
# Requires: ffmpeg (brew install ffmpeg), MediaMTX running (docker compose up).
# macOS: grants camera permission to the terminal on first run.
#
# Usage:
#   ./scripts/webcam.sh          # uses device 0 (FaceTime HD Camera)
#   ./scripts/webcam.sh 1        # pick a different avfoundation device
set -euo pipefail

DEVICE="${1:-0}"
RTSP_URL="${RTSP_URL:-rtsp://localhost:8554/demo-webcam}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found — install with: brew install ffmpeg" >&2
  exit 1
fi

if ! curl -sS -m 2 http://localhost:9997/v3/paths/list >/dev/null 2>&1; then
  echo "MediaMTX not reachable on :9997 — run 'docker compose up -d' first." >&2
  exit 1
fi

echo "Publishing avfoundation device [$DEVICE] → $RTSP_URL"
echo "Open the dashboard at http://localhost:5173 — the Demo tile should appear."
echo "Ctrl-C to stop."

exec ffmpeg \
  -hide_banner -loglevel warning \
  -f avfoundation -framerate 30 -video_size 1280x720 -pixel_format uyvy422 \
  -i "${DEVICE}:none" \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
  -g 30 -keyint_min 30 -sc_threshold 0 -b:v 1500k -maxrate 1500k -bufsize 3000k \
  -an \
  -f rtsp -rtsp_transport tcp "$RTSP_URL"
