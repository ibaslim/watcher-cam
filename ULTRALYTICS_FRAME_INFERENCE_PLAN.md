# Ultralytics Frame-Based Inference Plan

## 1. Objective

Scale Watcher Cam to support approximately 100 cameras by processing selected
frames from each camera with Ultralytics YOLO and returning structured object
detections to the existing backend.

The system will not send every video frame for inference. Each camera stream
will be sampled at a configured rate, and only the newest frame will be sent to
the inference pipeline. This keeps detection current and prevents processing
backlogs.

## 2. Target behavior

For every configured camera:

1. Read the camera's RTSP substream through MediaMTX.
2. Keep only the latest decoded frame.
3. Sample a frame at the configured inference rate.
4. Submit the frame to the Ultralytics inference service.
5. Receive labels, confidence scores, and bounding boxes.
6. Associate the result with the camera and frame timestamp.
7. Pass the detections to the existing tracking and alert pipeline.
8. Save snapshots and create backend events when alert rules are satisfied.

The initial target is:

```text
100 cameras
1–2 inference frames per second per camera
100–200 inference frames per second total
```

## 3. Proposed architecture

```text
Hikvision cameras
        |
        | RTSP
        v
MediaMTX
        |
        | camera substreams
        v
Watcher Cam detector gateway
        |
        | latest sampled frames
        v
Inference queue
        |
        | frame requests over HTTPS
        v
Ultralytics YOLO API
        |
        | detection results
        v
Watcher Cam tracking and event pipeline
        |
        v
Backend, database, snapshots, alerts, dashboard
```

The detector gateway remains responsible for camera connections, sampling,
timestamps, tracking, duplicate suppression, snapshots, and backend events.
The Ultralytics service is responsible for model inference and returning
detections.

## 4. Frame handling

The detector gateway will decode the RTSP stream locally. The external API
receives individual frames, because object detection is performed on images
even when the source is a continuous video stream.

Each camera will have a bounded queue with a maximum size of one:

```text
new frame arrives
        |
        +-- replace older queued frame
        |
        +-- inference processes the newest available frame
```

If inference is temporarily slower than the camera sampling rate, old frames
will be dropped. The system will not process stale frames several seconds after
they were captured.

The gateway will encode each selected frame as JPEG and send it to the
Ultralytics API over authenticated HTTPS.

JPEG encoding is an interchange format for the inference request. It does not
mean that the camera stream itself is converted into JPEG video.

## 5. Ultralytics inference service

The Ultralytics API will expose an endpoint such as:

```http
POST /predict
```

The request will contain:

- JPEG frame bytes
- Camera ID
- Frame timestamp
- Confidence threshold
- Optional image size or model version

Example response:

```json
{
  "camera_id": "camera-01",
  "frame_timestamp": "2026-10-20T12:30:15.250Z",
  "model_version": "camera-animals-v1",
  "detections": [
    {
      "label": "person",
      "category": "person",
      "confidence": 0.91,
      "bbox": [120, 80, 400, 620]
    }
  ]
}
```

If the selected Ultralytics API supports batched requests, the client may send
frames from multiple cameras together. Batch size and maximum batch wait time
will be configurable in the client.

The service will also expose:

```http
GET /health
GET /metrics
```

Health checks will report API and model readiness. Metrics will include
inference latency, queue size, request errors, processed frames, and detections
by class.

## 6. Watcher Cam integration

The existing model-specific call is in `detector/object_detection.py`. It will
be separated behind a provider-neutral interface:

```text
detect_objects(frame) -> list[ObjectDetection]
```

The worker in `detector/worker.py` will continue using this interface. The
implementation behind it will submit frames to the inference service and map
the response into the existing `ObjectDetection` structure:

```python
ObjectDetection(
    bbox=(x1, y1, x2, y2),
    confidence=0.91,
    label="person",
    category="person",
)
```

The existing application behavior will remain after inference:

- Object tracking
- Movement-based re-alerting
- Vehicle repeat suppression
- Confidence and area filtering
- Snapshot creation
- Event ingestion
- WebSocket updates
- Email or other alert delivery

The backend will receive the same event shape as it does with the current local
model.

## 7. Configuration

The following settings should be added to the detector configuration:

```env
INFERENCE_MODE=remote
INFERENCE_URL=http://ultralytics-inference:9000/predict
INFERENCE_API_KEY=
INFERENCE_TIMEOUT_SECONDS=2
INFERENCE_SAMPLE_FPS=1.0
INFERENCE_BATCH_SIZE=8
INFERENCE_MAX_BATCH_WAIT_MS=50
INFERENCE_IMAGE_SIZE=640
YOLO_CONFIDENCE=0.30
```

The existing settings remain applicable:

```env
YOLO_MODEL_ID=yolov8m
YOLO_CLASSES=person,vehicle,animal
OBJECT_MIN_AREA=2500
```

Secrets must be provided through deployment environment variables or a secret
manager. They must not be stored in frontend code, camera records, source
files, or logs.

## 8. Camera and network requirements

The AI pipeline should use each camera's substream for inference. The main
stream should be reserved for high-quality event snapshots and recordings.

For planning purposes:

```text
100 cameras × 1 Mbps  ≈ 100 Mbps incoming video
100 cameras × 2 Mbps  ≈ 200 Mbps incoming video
```

The camera network, MediaMTX host, and inference service should use a private
network. Camera RTSP URLs should not be exposed publicly to the inference
service or the internet.

## 9. Reliability behavior

The inference client must:

- Use a short request timeout.
- Limit concurrent requests per camera.
- Drop stale frames when queues are full.
- Retry only transient failures.
- Avoid retry storms during an outage.
- Emit health and error metrics.
- Continue reading camera streams if the API is temporarily unavailable.
- Use a configured retry and recovery policy without blocking camera capture.

An inference failure must not crash all camera workers or stop video recording.

## 10. Acceptance criteria

The implementation is ready for a pilot when it can demonstrate:

- 100 configured cameras connected through MediaMTX.
- One or two inference frames per second per camera.
- No unbounded frame or request queues.
- Correct camera IDs and timestamps on all detections.
- Correct bounding-box coordinates after any image resizing.
- Stable processing during temporary inference delays.
- Correct event and snapshot creation.
- API and model readiness reporting.
- Measured p50 and p95 inference latency.
- Recovery after camera and inference-service restarts.
- Model identifier recorded with detections.

## 11. Implementation sequence

### Step 1: Introduce the inference interface

Place the current detection behavior behind the shared
`detect_objects(frame)` interface so the worker does not depend on the API's
response format.

### Step 2: Add frame sampling and bounded queues

Make the per-camera sampling rate configurable and ensure only the newest frame
is retained for inference.

### Step 3: Implement the inference service

Configure the Ultralytics API model, authentication, `/predict` request, and
health-check behavior. Add client-side batching only if the selected API
supports it.

### Step 4: Implement the remote client

Add the JPEG request client, authentication, response validation, timeout
handling, and conversion to `ObjectDetection`.

### Step 5: Benchmark one camera, then ten cameras

Measure latency, throughput, API errors, false positives, missed detections,
network usage, and queue age before moving to 100 cameras.

### Step 6: Deploy the 100-camera pilot

Start at 1 FPS per camera, monitor the system, and increase the rate only when
latency, API limits, network usage, and queue age remain within the agreed
limits.

## 12. Licensing review

Ultralytics currently provides YOLO software and models under AGPL-3.0 or an
Enterprise license. A commercial, proprietary, SaaS, or customer-facing
deployment may require an Enterprise license unless the AGPL obligations are
accepted and satisfied.

Review the current [Ultralytics licensing terms](https://www.ultralytics.com/license)
before production deployment. This review is required independently of
hosting or API costs.
