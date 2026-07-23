#!/usr/bin/env bash
# Local dev runner — starts MediaMTX in Docker, backend + frontend natively.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — edit it and rerun."
  exit 1
fi

docker compose up -d mediamtx

(cd backend && python -m venv .venv 2>/dev/null || true)
source backend/.venv/bin/activate
pip install -q -r backend/requirements.txt

(cd frontend && npm install --silent)

trap 'kill 0' EXIT
(cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
(cd frontend && npm run dev) &
wait
