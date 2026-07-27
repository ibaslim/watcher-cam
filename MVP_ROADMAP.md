# Verkada-Style Motion Detection MVP Roadmap

## Purpose

This document tracks the transition from the current guard-specific monitoring system to a minimal Verkada-style motion detection MVP focused on live camera classification, alerts, and event review.

## Guiding Principle

The first demo should show:
- a live camera view,
- detected classifications from that camera,
- simple event history,
- and basic alerts,

without requiring guard enrollment, guard assignment, or guard-presence logic.

---

## MVP 1.0 — Core live detection demo

### Goal
Show that a camera can detect and classify activity in real time.

### Features to implement
- Remove guard-specific detection from the main pipeline
- Camera-level toggle for AI detection
- Live camera view with detection overlay
- Basic classifications:
  - Person
  - Vehicle
  - Animal
- Show detection label on the video tile
- Create a new event when a new object is detected
- Capture a snapshot for each event
- Show timestamp, camera name, and classification
- Basic event feed under the camera view
- No guard enrollment or guard assignment required

### Demo outcome
A client can open a camera and see detected classifications with a timestamp and snapshot.

---

## MVP 1.1 — Event review and basic alerts

### Goal
Make detections usable as an alerting experience.

### Features to implement
- Event history page for each camera
- Filter events by:
  - camera
  - event type
  - date/time
- Browser notification when a new event occurs
- Alert cooldown to reduce duplicate alerts
- Snapshot preview in the event list
- Basic severity levels

### Demo outcome
The client can review recent detections and receive a visible alert when something is detected.

---

## MVP 1.2 — Noise reduction and simple rules

### Goal
Make the detection experience practical instead of noisy.

### Features to implement
- Simple per-camera rules:
  - ignore zone
  - intrusion zone
  - line crossing
- Object tracking to avoid repeated duplicates
- Minimum confirmation window before alerting
- Basic cooldown handling

### Demo outcome
The system can be tuned to alert only for relevant activity, not every small movement.

---

## MVP 2.0 — Event playback and evidence

### Goal
Provide a more professional review workflow for the client.

### Features to implement
- Event-linked video clips
- Short playback around the event time
- Snapshot + clip shown together
- Retention policy for event clips
- Better event detail view

### Demo outcome
The client can click an event and review what happened visually.

---

## MVP 2.1 — Multi-camera operations

### Goal
Make the system feel like a real monitoring platform.

### Features to implement
- Multi-camera dashboard
- Recent events across all cameras
- Camera health status
  - online/offline
  - last event
  - last frame
- Grouping by site or area

### Demo outcome
The client can monitor multiple cameras from one screen and quickly see which ones have recent activity.

---

## MVP n — Advanced features (later)

### Goal
Add higher-value capabilities after the core experience is stable.

### Possible features
- People counting
- Occupancy detection
- Loitering detection
- Advanced analytics
- Face recognition as an optional feature
- Mobile push notifications
- Advanced reporting and search

---

## Suggested implementation order

1. MVP 1.0
2. MVP 1.1
3. MVP 1.2
4. MVP 2.0
5. MVP 2.1
6. MVP n

---

## Progress tracker

### Latest update (2026-07-27)
- Completed unique detection grouping using persisted `entity_id`.
- Added entity-based snapshot drill-down from Unique detections to Recent snapshots.
- Added date/time range filtering for Unique detections.
- Removed crop-dependent classification flow and shifted to original snapshot-based classification artifacts.
- Set new camera defaults to detection enabled to avoid post-reset silent detector workers.
- Removed startup-time entity backfill from app boot path to restore fast backend readiness.

### MVP 1.0
- [ ] Remove guard-specific detection from core pipeline
- [x] Make detection independent of guard configuration
- [ ] Enable live camera classification overlay
- [x] Support person/vehicle/animal event generation
- [x] Show event snapshot and metadata
- [x] Add basic event feed in UI

### MVP 1.1
- [x] Add event history screen
- [x] Add basic filtering
- [ ] Add browser notifications
- [x] Add alert cooldown
- [x] Add snapshot previews

### MVP 1.2
- [ ] Add basic zone-based rules
- [x] Add object tracking and duplicate filtering
- [x] Add confirmation window

### MVP 2.0
- [ ] Add event-linked video clips
- [ ] Add playback around events
- [ ] Add retention for clips

### MVP 2.1
- [x] Add multi-camera dashboard
- [ ] Add camera health indicators
- [ ] Add site grouping

### MVP n
- [ ] Add advanced analytics and optional features
