# MVP 1.0 plan: core live detection demo

## Goal
Deliver a minimal live detection experience that shows a camera, classifies objects in real time, creates events, stores snapshots, and surfaces a simple event feed without requiring guard enrollment or guard assignment.

## Plan summary
1. Make detection independent from guard-specific configuration.
2. Emit generic object-classification events for person/vehicle/animal.
3. Surface live detection labels and recent event metadata on the camera tile.
4. Ensure the event feed displays camera, timestamp, classification, and snapshot.
5. Validate with targeted backend and frontend checks.

## Implementation slices

### 1) Backend and detector integration
- Keep existing guard-related events intact, but stop making them the only path for detection.
- Adjust the detector supervisor to start workers for any camera with AI detection enabled, regardless of guard/post configuration.
- Extend the detector worker to emit generic object events for supported classes: person, vehicle, animal.
- Preserve snapshot creation and backend ingestion for those events.
- Keep event payloads compatible with the existing ingestion endpoint.

### 2) Backend event model and API compatibility
- Reuse the existing events table and ingestion endpoint for generic detections.
- Ensure the event feed can display object detections with camera, time, label, and snapshot URL.
- Keep alerts optional and non-blocking for this MVP slice.

### 3) Frontend live camera experience
- Update the live camera tile to show the latest detected label as an overlay or badge.
- Surface the most recent detection metadata near the video tile (for example: label, confidence, timestamp).
- Add or refine a compact event feed under the tile that renders recent detections.

### 4) Validation
- Backend: verify the detection ingestion path and event creation flow.
- Frontend: verify the camera tile renders detection labels and the event feed updates correctly.
- Run the narrowest relevant checks after each change slice.

## Files likely to change
- backend/app/api/detections.py
- detector/supervisor.py
- detector/worker.py
- frontend/src/components/CameraTile.tsx
- frontend/src/pages/Dashboard.tsx
- frontend/src/lib/api.ts (only if new UI data shape is needed)

## Definition of done for MVP 1.0
- A camera with AI detection enabled produces object-classification events without guard setup.
- The UI shows live detection labels and a basic event feed with snapshot and timestamp.
- The experience is usable for a simple demo without guard enrollment.
