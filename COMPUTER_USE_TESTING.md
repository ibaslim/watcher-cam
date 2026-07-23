# Testing this app with Claude (computer use)

This guide is written for **Claude operating a computer** (browser + terminal) to
verify the camera-streaming monitoring system end-to-end. It assumes no prior
context about the project. Follow the steps in order; each step states what to
do and the **expected result** so you can decide pass/fail.

If a step fails, capture the relevant log (`docker compose logs <service>`) and
note it — don't silently continue.

---

## 0. What this system is

A web dashboard that watches Hikvision IP PTZ cameras, recognizes enrolled
guards by face, and raises alerts for unknown people and absent guards. Four
Docker services: `mediamtx` (streaming), `backend` (FastAPI + SQLite),
`detector` (InsightFace face recognition), `frontend` (React dashboard).

You do **not** need a real camera — there is a laptop-webcam demo mode.

---

## 1. Prerequisites (terminal)

```bash
cd camera-streaming
docker --version          # Docker Desktop 24+ expected
cp -n .env.example .env    # if .env doesn't exist
```

For the webcam demo you also need `ffmpeg` on the host and a webcam:

```bash
ffmpeg -version           # expected: prints a version
```

**Expected:** all commands succeed.

---

## 2. Start the stack

```bash
docker compose up -d --build
```

First build takes 10–15 min (the detector compiles InsightFace and downloads
~300 MB of models). Watch progress:

```bash
docker compose logs -f backend detector
```

**Expected to see:**
- backend: `Application startup complete` and `background tasks started: presence + retention`
- detector: `FaceAnalysis ready (...)` and `detector running: http + bank refresh + camera supervisor`

Health checks:

```bash
curl -s http://localhost:8100/health        # -> {"status":"ok"}
curl -s http://localhost:8100/api/cameras    # -> [] or the demo camera
```

**Pass criteria:** both services report ready; `/health` returns ok.

---

## 3. Publish the demo webcam

In a separate terminal, leave this running:

```bash
./scripts/webcam.sh 0     # macOS may prompt for camera permission once
```

Confirm MediaMTX sees it:

```bash
curl -s http://localhost:9997/v3/paths/list | python3 -m json.tool
```

**Expected:** a `demo-webcam` path with `"ready": true`.

> The demo camera only appears in the dashboard when `DEMO_MODE=true` in `.env`
> (it is in `.env.example`). If you don't see it, check that and restart the
> backend.

---

## 4. Open the dashboard (browser)

Navigate to **http://localhost:5173**.

**Expected:**
- Top bar shows the title and tabs: **Dashboard**, **Guards**, **Cameras**, **Posts**, plus a connection dot that turns "connected".
- The Dashboard shows a live "Demo (laptop webcam)" tile with a green **● LIVE**
  badge and visible video within a few seconds.

**Test 4a — live view latency:** reload the page and time how long until the
tile shows video. **Expected:** a few seconds, not tens of seconds.

**Test 4b — tab persistence (regression test for the live-view-delay fix):**
1. Click **Guards**, then **Cameras**, then back to **Dashboard**.
2. **Expected:** the tile is *immediately* live again — no "connecting…"
   flicker, no black frame. The WebRTC connection should have stayed alive
   while you were on other tabs.

---

## 5. Add a camera (UI) — regression test for camera-add

Go to **Cameras → "+ Add camera"**.

**Test 5a — a deliberately bad camera (error surfacing):**
- ID: `test-bad`, Name: `Test Bad`, Host: `10.255.255.1` (unroutable),
  Username/Password: anything, leave detect off. Click **Add**.
- **Expected:** the camera is saved and appears in the table, AND an amber
  banner appears: *"Camera saved, but its live stream could not be
  registered: …"* (because the host is unreachable). This proves stream
  errors are surfaced, not swallowed.
- Delete `test-bad` afterward.

**Test 5b — Dashboard auto-refresh:** add a camera with an RTSP URL override
pointing at the demo (ID `demo2`, leave host blank, set **RTSP URL override**
to `rtsp://mediamtx:8554/demo-webcam`). Click **Add**.
- **Expected:** without reloading the page, switch to the **Dashboard** tab —
  a new tile for `demo2` should appear. (Previously a full reload was needed.)
- Delete `demo2` afterward.

---

## 6. Enroll a guard and test face recognition

Go to **Guards → Add guard**, name it `Test Guard`.

1. Upload 1–3 clear, single-face portrait photos (a phone selfie works; not a
   screenshot with multiple faces). **Expected:** `photo_count` increments;
   the uploader rejects zero-face or multi-face images with a clear message.
2. Wait up to ~60 s for the detector to refresh its face bank.
3. Put that same face in front of the webcam.

**Expected (Dashboard event log, right panel):**
- A green **guard_present** event with the guard's name appears (heartbeat at
  most every 30 s).
- An unfamiliar face produces a red **unknown_person** event with a saved
  snapshot.

**Test 6a — real-time-ness (regression test for detection lag):** move in and
out of frame. Events should track within a couple of seconds of you appearing
— not lag many seconds behind. (The detector keeps only the latest frame.)

---

## 7. Configure a guard post (absence alert)

Go to **Posts**, pick the demo camera:
- Set **Is guarded post** on, **Duty hours** spanning now, **Absence
  threshold** = 1 minute (for a fast test). Save.

Leave the frame empty (no enrolled guard visible) for >1 minute during duty
hours.

**Expected:** a red **guard_absent** event fires after the threshold, with a
snapshot.

---

## 8. PTZ controls (only meaningful with a real PTZ camera)

On a real Hikvision PTZ tile, press-and-hold the arrow / zoom buttons.

**Expected:** the camera pans/tilts/zooms while held and stops on release. With
the webcam demo there is no PTZ hardware, so this is a no-op — skip.

---

## 9. Remote access (regression test for port-forwarding fix)

From a **second device on the same LAN**, open `http://<server-lan-ip>:5173`.

**Expected:** the dashboard loads and the live tile plays — the frontend now
targets whatever host you opened it from (no hardcoded localhost). If video
signalling connects but the picture never appears from outside the LAN, set
`MEDIAMTX_PUBLIC_HOST` in `.env`, forward TCP 8889 + UDP 8189 on the router,
and rebuild/restart (see `.env.example` → Remote access).

---

## 10. Tear down

```bash
docker compose down               # stop
# destructive (wipes DB + enrolled photos + snapshots):
# docker compose down && rm -rf data/app.db data/snapshots data/guard_photos
```

---

## Quick pass/fail checklist

- [ ] Stack starts; `/health` ok; detector reports ready
- [ ] Demo webcam path is `ready` in MediaMTX
- [ ] Dashboard shows a live tile quickly
- [ ] Returning to the Dashboard tab is instant (no reconnect flicker)
- [ ] Bad camera shows the amber stream-warning banner
- [ ] New camera appears on the Dashboard without a page reload
- [ ] Photo upload validates single-face; face bank refreshes
- [ ] guard_present / unknown_person events fire and track in near real-time
- [ ] guard_absent fires after the configured threshold
- [ ] Dashboard reachable from another device on the LAN

---

## Troubleshooting pointers

| Symptom | Check |
|---|---|
| No cameras in dashboard | `DEMO_MODE=true` in `.env`? `docker compose logs backend` |
| Tile stuck "connecting…" | `docker compose logs mediamtx` for "error opening source" (creds/RTSP) |
| No face events | `docker compose logs detector`; ensure the camera has **Face detect** on and the face bank refreshed |
| Slow face rec | lower `FACE_SAMPLE_FPS` / keep `FACE_DET_SIZE=320` / use `FACE_MODEL=buffalo_s` |
| Remote video won't play | `MEDIAMTX_PUBLIC_HOST` + forward TCP 8889 / UDP 8189; strict NAT needs TURN |
