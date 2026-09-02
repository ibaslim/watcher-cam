# Persistent Person Identity and Gallery

## Purpose

This feature detects every visible person, saves an event snapshot, assigns a
persistent identity when a usable face is available, and adds later appearances
of that face to the same album. Identities are global: the same face may match
across different cameras.

This is face **recognition/re-identification**, not merely object tracking.
YOLO answers “is this a person?”, the in-memory tracker follows the person
during one visit, and InsightFace plus the identity database decides whether a
later visit belongs to an existing person.

## End-to-end flow

```text
Camera/NVR RTSP
  -> MediaMTX
  -> detector latest-frame reader
  -> YOLO person boxes
  -> per-camera temporary track IDs
  -> InsightFace run once for the frame
  -> face-to-person-box association
  -> face/person quality checks
  -> annotated event snapshot + person crop + face crop
  -> backend detection event
  -> normalized ArcFace embedding comparison
       -> confident match: reuse global person ID
       -> no/ambiguous match: create provisional person ID
  -> person appearance album row
  -> Camera Detail / Unique detections / View snapshots
```

## Changes made

### Detector

`detector/worker.py` now:

- keeps one-to-one track assignment within a frame, preventing two simultaneous
  people from taking the same temporary track;
- runs InsightFace only once for a frame that has person events, even if several
  people are visible;
- associates a face with a person only when the face center is inside that
  person's box and the face passes size/sharpness checks;
- preserves the normalized 512-dimensional embedding instead of converting it
  to a cryptographic hash;
- saves an annotated scene image, padded person crop, and face crop;
- sends the embedding, crop paths, face quality, temporary track ID, and model
  name to the backend;
- fixes a nested-function scope issue that previously left the classification
  artifact empty and could suppress classification ingestion.

The temporary track ID is deliberately not treated as permanent. It resets on
worker restart and after a track disappears. The global `person-*` ID is the
persistent identifier.

### Backend storage

`backend/app/models.py` adds:

- `person_identities`: one durable global identity, its representative image,
  status, first/last seen times, and appearance count;
- `person_embeddings`: several normalized float32 ArcFace templates per person,
  including model, camera, quality, and source face image metadata;
- `person_appearances`: the album entries linking a person to an event, camera,
  track, scene image, person crop, face crop, match score, and timestamp.

SQLite creates these tables automatically through SQLAlchemy `create_all`.
Indexes used by identity and album lookups are created during startup. Existing
events, cameras, recordings, and classification rows are preserved.

### Identity matching

`backend/app/services/person_identity.py`:

1. validates that the received vector is finite and has a sensible dimension;
2. L2-normalizes it;
3. computes cosine similarity against every stored template;
4. ranks the best identity and second-best identity;
5. accepts the best result only when it exceeds both the match threshold and
   the ambiguity margin;
6. otherwise creates a new `provisional` identity;
7. assigns the global public ID to the event;
8. adds an appearance to the album;
9. adds a new template only when it is useful and the template limit has not
   been reached.

The public identifier uses the form `person-<random hex>`. It is global and is
not derived from a camera, database row number, name, or biometric content.

### Dedicated Persons and Ambiguous gallery

The main navigation includes **Persons**, served at `/persons`.

- **Persons** shows one card for every clear persistent face, its unique
  `person-*` code, representative image, status, appearance count, and last
  seen time. **Open person album** shows only screenshots linked to that ID.
- **Ambiguous** shows person detections for which no reliable face embedding
  could be created, such as a blurred, dark, tiny, covered, or turned-away
  face. These entries receive `ambiguous-*` evidence codes but are not added to
  the known-person matching bank.
- A clear face that matches no stored identity creates a new `person-*` code
  and a new album immediately.

### API and gallery

Existing endpoints continue to work:

- `GET /api/events?entity_id=person-...` lists that person's scene snapshots.
- `GET /api/events/classifications` groups events into unique-detection cards.

New endpoints:

- `GET /api/events/persons` lists persistent identities. Optional parameters:
  `camera_id`, `date_from`, `date_to`, and `limit`.
- `GET /api/events/persons/{public_id}/appearances` returns the full album,
  including scene/person/face URLs, camera, time, scores, and match method.
- `GET /api/events/ambiguous` returns detections without a usable face.

The existing Camera Detail page already displays entity cards and its “View N
snapshots” control filters events by `entity_id`; persistent face matches now
feed that mechanism directly.

## Configuration

Add any overrides to `.env`. Defaults are defined in `backend/app/config.py`.

```dotenv
# Minimum cosine similarity for an existing identity.
PERSON_MATCH_THRESHOLD=0.48

# The best candidate must beat the second-best candidate by this amount.
PERSON_MATCH_MARGIN=0.06

# Maximum diverse face templates retained for each identity.
PERSON_MAX_EMBEDDINGS=8

# Do not add a template when it is more similar than this to an existing one.
PERSON_TEMPLATE_NOVELTY=0.94

# Detector-side sampling and quality settings already used by the project.
FACE_SAMPLE_FPS=1.0
FACE_MIN_SIZE=40
FACE_DET_SIZE=320
FACE_MODEL=buffalo_l
```

The matching defaults are starting points, not universal biometric guarantees.
Calibrate them using the real camera angle, distance, compression, lighting,
and population. Raising `PERSON_MATCH_THRESHOLD` reduces false merges but may
create more duplicate identities. Raising `PERSON_MATCH_MARGIN` is more
conservative when two candidates look similarly plausible.

## Behavior and intentional safeguards

- Several people can be processed from the same frame independently.
- Only one face is associated with a particular person box.
- A poor/tiny/blurry face does not become a biometric template.
- A person event can still be saved when no usable face exists. Such an event
  may use the legacy camera-local visual grouping, because persistent human
  identity cannot safely be inferred without a usable face.
- Ambiguous matches create a new provisional identity instead of risking a
  silent false merge.
- Stationary people do not generate a snapshot every sampled frame. A new
  visit, forgotten track, or meaningful movement produces another event. This
  controls storage growth and prevents near-duplicate albums.
- Templates are capped and deduplicated by cosine similarity.

## Running the system

From the repository root:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f detector backend
```

Open `http://localhost:5173`, select a camera, and open **Unique detections**.
Select a person card and choose **View snapshots** to see that person's album
for the camera.

Database inspection examples:

```bash
sqlite3 data/app.db 'select public_id,status,appearance_count,first_seen,last_seen from person_identities;'
sqlite3 data/app.db 'select person_id,camera_id,event_id,match_score,match_method,created_at from person_appearances order by created_at desc;'
sqlite3 data/app.db 'select person_id,count(*) from person_embeddings group by person_id;'
```

## Validation

Recommended automated checks:

```bash
PYTHONPATH=backend:. pytest -q backend/tests detector/tests
cd frontend && npm run build
```

`backend/tests/test_person_identity.py` verifies that the same normalized face
across two cameras reuses one global identity and creates two album entries,
while orthogonal/different embeddings create separate identities.

For camera validation, test at least:

1. one person leaving and returning;
2. two or more people entering together;
3. people crossing/occluding one another;
4. the same person on two cameras;
5. two similar-looking people;
6. distant, blurry, side-profile, day, and night faces;
7. detector/backend restarts between visits.

Record false merges and false splits. False merges are normally more harmful,
so tune conservatively.

## Capacity and performance

The first version performs a linear scan of stored templates. This is simple
and appropriate for a small SQLite deployment. At thousands to tens of
thousands of identities, move embeddings to PostgreSQL with pgvector or a
dedicated approximate-nearest-neighbor index.

InsightFace currently uses CPU execution. Keep AI on camera substreams and use
the main stream only for selected snapshots. For many cameras, enable a suitable
ONNX GPU provider and benchmark total sampled frames per second.

## Retention, deletion, and privacy

Face embeddings are biometric data. Restrict access, encrypt backups, define a
retention policy, and comply with applicable consent/privacy law.

The existing snapshot retention job removes old files. Album database rows may
then retain metadata whose image URL no longer resolves; this is preferable to
unbounded disk use but should be considered when choosing retention days.
A future administration milestone should add audited rename/confirm/merge/split
and identity deletion operations, including deletion of templates and files.

The `/snapshots` static mount should be placed behind authenticated reverse
proxy controls before production exposure. API authentication alone does not
make biometric image storage private if the static path is publicly reachable.

## Known limitations

- This is face identity, not a guarantee of legal identity.
- Masks, backs of heads, tiny faces, and poor lighting cannot be reliably
  matched.
- Clothing/body similarity is not used for long-term recognition.
- There is not yet an operator UI for merging false splits or splitting false
  merges; new identities are therefore marked `provisional`.
- Matching thresholds require deployment-specific calibration.
- SQLite template search is linear and intended for modest installations.
