# Motion Detection AI Camera Portal - Project Context

This is the canonical context file for coding agents and developers. Read it before starting a task. It is intentionally compact: use the file map and targeted commands below to jump to the owning code instead of crawling the repository.

## Project Summary

Docker-based Hikvision IP/PTZ camera monitoring portal with:

- React/Vite dashboard served by Nginx
- FastAPI backend with SQLite, authentication, events, reports, recordings, PTZ, and alerts
- Detector service using InsightFace face recognition and YOLO object detection
- MediaMTX for RTSP ingest and WebRTC/HLS playback
- Optional email alerts and laptop-webcam demo mode

Runtime services:

| Service | Folder | Container | Purpose |
| --- | --- | --- | --- |
| Frontend | `frontend/` | `cs-frontend` | React dashboard on port 5173 |
| Backend | `backend/` | `cs-backend` | FastAPI API and background jobs on port 8100 |
| Detector | `detector/` | `cs-detector` | Face and object detection on port 8001 |
| MediaMTX | `mediamtx/` | `cs-mediamtx` | RTSP, WebRTC, and HLS streaming |

Data is persisted under `data/`: SQLite database, guard photos, snapshots, and recordings. The main flow is:

```text
Camera RTSP -> MediaMTX -> Browser (WebRTC/HLS)
                     \\-> Detector -> Backend -> SQLite/WebSocket/email
Camera smart events ----------------^
```

## Agent Startup Rules

1. Read this file before every task.
2. Identify the owning service and exact file from the map below.
3. Read only the relevant nearby implementation and its tests or call sites.
4. Check current configuration before changing behavior.
5. Make the smallest focused change and run the narrowest useful validation.
6. Update this file only when architecture, commands, routes, configuration, or operational behavior changes.

Specialized documentation:

- `COMPUTER_USE_TESTING.md`: end-to-end browser and webcam verification steps.
- `training/README.md`: animal-model training workflow.

## Repository Map

### Backend

- `backend/app/main.py`: FastAPI application, startup, health, static files.
- `backend/app/config.py`: environment-backed settings.
- `backend/app/db.py`: SQLAlchemy engine and sessions.
- `backend/app/models.py`: database models.
- `backend/app/api/auth.py`: login, session, and authentication endpoints.
- `backend/app/api/cameras.py`: camera CRUD and post configuration.
- `backend/app/api/guards.py`: guard enrollment and face photos.
- `backend/app/api/detections.py`: detector event ingestion.
- `backend/app/api/events.py`: event queries and snapshots.
- `backend/app/api/alarm.py`: Hikvision smart-event webhook.
- `backend/app/api/ptz.py`: PTZ commands.
- `backend/app/api/recordings.py`: recording queries and media.
- `backend/app/api/reports.py`: reports and CSV output.
- `backend/app/api/users.py`: portal user administration.
- `backend/app/api/ws.py`: live event WebSocket.
- `backend/app/services/cameras.py`: camera projection and runtime config.
- `backend/app/services/mediamtx.py`: MediaMTX path synchronization.
- `backend/app/services/hikvision.py`: Hikvision ISAPI requests and snapshots.
- `backend/app/services/presence.py`: guard presence and absence detection.
- `backend/app/services/alerts.py`: notification policy and email delivery.
- `backend/app/services/recording.py`: MP4 recording.
- `backend/app/services/retention.py`: snapshot and recording cleanup.

### Detector

- `detector/api.py`: embedding and matching HTTP API.
- `detector/face.py`: InsightFace setup and face recognition.
- `detector/face_bank.py`: enrolled embedding storage and matching.
- `detector/object_detection.py`: YOLO classes and inference.
- `detector/person.py`: person tracking and movement re-alert logic.
- `detector/worker.py`: per-camera detection loop.
- `detector/supervisor.py`: camera worker lifecycle.
- `detector/config.py`: detector environment settings.
- `detector/tests/`: detector tests.

### Frontend

- `frontend/src/App.tsx`: routing and authenticated app shell.
- `frontend/src/components/NavBar.tsx`: navigation and session controls.
- `frontend/src/components/CameraTile.tsx`: live stream tile and PTZ UI.
- `frontend/src/components/EventLog.tsx`: live event list.
- `frontend/src/components/InfoTip.tsx`: explanatory tooltip component.
- `frontend/src/pages/Dashboard.tsx`: overview and live cameras.
- `frontend/src/pages/CamerasAdmin.tsx`: camera CRUD.
- `frontend/src/pages/CameraSettings.tsx`: post and alert settings.
- `frontend/src/pages/Guards.tsx`: guard enrollment.
- `frontend/src/pages/Events.tsx`: event history.
- `frontend/src/pages/Recordings.tsx`: recording browser.
- `frontend/src/pages/Reports.tsx`: reports and exports.
- `frontend/src/pages/Users.tsx`: user administration.
- `frontend/src/pages/Login.tsx`: authentication screen.
- `frontend/src/lib/api.ts`: REST client.
- `frontend/src/lib/ws.ts`: WebSocket client.
- `frontend/src/lib/whep.ts`: MediaMTX WebRTC client.
- `frontend/src/index.css`: global Tailwind and component styles.
- `frontend/tailwind.config.js`: design tokens and content paths.

## URLs, Ports, and Commands

Local URLs:

| Purpose | URL or port |
| --- | --- |
| Dashboard | `http://localhost:5173` |
| Backend API docs | `http://localhost:8100/docs` |
| Backend health | `http://localhost:8100/health` |
| MediaMTX WebRTC | TCP `8889` |
| MediaMTX HLS fallback | TCP `8888` |
| WebRTC media | UDP `8189` |
| RTSP | TCP `8554` |
| MediaMTX API | TCP `9997` |

Common commands from the repository root:

```powershell
docker compose up -d --build
docker compose ps
docker compose logs -f <service>
docker compose restart <service>
docker compose down
docker compose build --no-cache <service>
```

Frontend validation:

```powershell
Push-Location frontend
pnpm install
pnpm run build
Pop-Location
```

Useful checks:

```powershell
Invoke-RestMethod http://localhost:8100/health
Invoke-RestMethod http://localhost:9997/v3/paths/list
docker compose logs backend
docker compose logs detector
docker compose logs mediamtx
```

The Windows VM needs inbound TCP `5173`, `8100`, `8889`, optional `8888`, and UDP `8189` for outside users. Keep `9997` private. Expose `8554` only when external RTSP publishing or reading is required.

## Authentication and Configuration

The default fresh-database login is `admin` / `Admin@12345`; change it after the first login. Existing databases do not receive default credentials again. Authentication routes are in `backend/app/api/auth.py` and protected-route behavior is in `backend/app/api/guards.py`.

Environment settings are defined in `backend/app/config.py` and configured via `.env`. Before changing a setting, check its exact name and default there. Important groups include:

- `DATABASE_URL`, dashboard password, session/auth settings
- MediaMTX public host and ports
- detector model paths, face sample rate, face detection size, match threshold
- snapshot and recording retention
- SMTP/email alert settings
- camera and detection defaults

Do not commit secrets, camera passwords, database files, guard photos, or model artifacts.

## Database and API Overview

Core tables are defined in `backend/app/models.py`:

- `users`: portal accounts, roles, active status
- `guards`: enrolled identities
- `guard_embeddings`: normalized face vectors and source photos
- `cameras`: connection, stream, detection, and recording settings
- `camera_posts`: assigned guards, duty hours, thresholds, alert switches
- `events`: AI, presence, and Hikvision events with snapshots

Route ownership:

| Area | Routes | File |
| --- | --- | --- |
| Auth | `/api/auth/*` | `backend/app/api/auth.py` |
| Cameras | `/api/cameras/*` | `backend/app/api/cameras.py` |
| Guards | `/api/guards/*` | `backend/app/api/guards.py` |
| Detection ingestion | `/api/detections/*` | `backend/app/api/detections.py` |
| Events | `/api/events/*` | `backend/app/api/events.py` |
| Hikvision alarms | `/api/alarm` | `backend/app/api/alarm.py` |
| PTZ | `/api/ptz/*` | `backend/app/api/ptz.py` |
| Reports | `/api/reports/*` | `backend/app/api/reports.py` |
| Recordings | `/api/recordings/*` | `backend/app/api/recordings.py` |
| Users | `/api/users/*` | `backend/app/api/users.py` |
| Live updates | WebSocket routes | `backend/app/api/ws.py` |

## Event and Detection Behavior

- `guard_present`: enrolled guard recognized; normally silent.
- `unknown_person`: person detected without a guard match; usually notifies.
- `wrong_guard`: enrolled but unassigned guard; usually notifies.
- `guard_absent`: no assigned guard seen during configured duty hours.
- `vehicle_detected` and `animal_detected`: YOLO detections when enabled.
- `hikvision`: native smart event received from a camera.

Presence scans run about every 15 seconds during duty hours. Unknown-person tracking is per camera: a new track alerts immediately, stationary tracks do not repeatedly alert, movement beyond the configured threshold can re-alert, and disappeared tracks are forgotten after about 20 seconds.

Guard recognition uses InsightFace ArcFace embeddings, normally 512-dimensional and L2-normalized, with cosine similarity. Clear photos from multiple angles improve enrollment quality.

## Main Workflows

### Add a camera

1. Confirm the server can reach the camera IP and required RTSP/HTTP ports.
2. Create a camera user with RTSP, ISAPI, PTZ, and snapshot permissions.
3. Add the camera through the dashboard or `backend/app/api/cameras.py`.
4. Check MediaMTX paths and backend logs.
5. No full restart is normally needed; runtime configuration propagates live.

For NVR/DVR deployments, prefer H264 substreams for browser live view and AI. H265 or heavy main streams can make browsers, MediaMTX, and the detector look unstable.

### Enroll and assign a guard

1. Create the guard and upload several clear face photos in the Guards page.
2. Configure the camera post with primary/backup guard, duty hours, absence threshold, and alert switches.
3. Watch the Events page and detector logs for `guard_present` or alerts.

### Stream debugging

Check `docker compose logs mediamtx`, then query `http://localhost:9997/v3/paths/list`. Common causes of a stuck stream are bad RTSP credentials, an incorrect channel such as `101` vs `201`, disabled RTSP, unreachable camera IP, or an unregistered MediaMTX path.

### Login debugging

Remember that default credentials apply only to a fresh database. Check the `users` table in `data/app.db` and inspect backend logs before changing auth code.

## Backup, Reset, and Production

Minimum backup: `data/app.db` and `data/guard_photos/`. Full backup also includes `data/snapshots/` and `data/recordings/`.

Destructive reset:

```powershell
docker compose down
Remove-Item data/app.db -ErrorAction SilentlyContinue
Remove-Item data/snapshots,data/guard_photos -Recurse -Force -ErrorAction SilentlyContinue
```

Before production: set a strong dashboard password, terminate TLS at a reverse proxy, keep container control ports private, back up the database, static-lease camera IPs, tune retention, and consider PostgreSQL if event volume grows well past roughly 100,000 records.

## Change-Point Guide

- New backend endpoint: add the route in the owning `backend/app/api/*.py` file, then update frontend `frontend/src/lib/api.ts` and the relevant page.
- New database field: update `backend/app/models.py`, migration/startup setup if present, API schemas, and all affected frontend forms.
- New event type: update detector emission, backend persistence/alert policy, frontend display, and report filters.
- New frontend page: add the page under `frontend/src/pages/`, route it in `frontend/src/App.tsx`, and add navigation if needed.
- Face behavior: inspect `detector/face.py`, `detector/face_bank.py`, and `detector/config.py`.
- Stream behavior: inspect `backend/app/services/mediamtx.py`, `mediamtx/`, and `frontend/src/lib/whep.ts`.

Always validate the touched slice first, then run a broader Docker or frontend build when the change crosses service boundaries.

## Locations and site navigation

Cameras now belong to persisted `sites` (`id`, `name`, `starred`). Administrators
create locations from **Locations**, open **Manage cameras**, then add cameras.
The camera edit form can move a camera to another location. Site deletion rejects
nonempty sites. `POST /api/cameras` requires a valid `site_id`; updates that omit
it preserve the current assignment. Sites use authenticated `GET /api/sites`
and administrator-only `POST`, `PUT /{id}`, and `DELETE /{id}` endpoints.

Startup adds the nullable SQLite camera `site_id` foreign key and assigns legacy
cameras to **Existing cameras** once. Existing streams and credentials are retained.
The virtual demo camera appears under **Other cameras**. The sidebar supports
site search, starred sites, hover/focus expansion, and a locally persisted pin.
The dashboard groups live tiles by site; selecting a site uses `/?site=<id>`.

Validate the site migration/API logic in isolation:
`docker compose run --rm --no-deps -e DATABASE_URL=sqlite:////tmp/site-test.db backend python -m unittest discover -s tests -p test_sites.py -v`.

Detection screenshots now link to `/recordings?camera=<id>&at=<ISO timestamp>`.
The authenticated `/api/recordings/at` endpoint resolves the recording using the
configured recording timezone, checks the previous day for midnight-spanning
clips, and uses ffprobe to verify the actual playable duration. Missing, unfinished,
or expired footage returns a recoverable 404 instead of choosing unrelated video.
The player seeks on metadata load and ignores stale requests when filters change.
Unique detection images use their last-seen event; individual snapshots use their
own event time. The event-detail modal retains its metadata and adds a playback link.

The sidebar uses a consistent SVG icon rail, grouped workspace/management links,
a searchable site list, and a persisted pin. Navigation remains accessible while
collapsed. Recording regression tests are in `tests/test_recording_navigation.py`.
