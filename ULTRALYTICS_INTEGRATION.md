# Ultralytics YOLO Integration Guide

This document describes how Ultralytics YOLO is used in Watcher Cam today and
how to evolve it for custom models, GPU inference, hosted inference APIs, and
multiple live cameras.

## 1. Current implementation

The detector service is in `detector/`. It currently uses:

- `ultralytics==8.3.40`
- `yolov8m.pt` by default
- CPU inference inside the detector container
- A confidence threshold of `0.30`
- A minimum detection area of `2,500` pixels
- Supported application categories: `person`, `vehicle`, and `animal`

The active settings are in `detector/config.py`:

```text
YOLO_MODEL=yolov8m.pt
YOLO_CONFIDENCE=0.30
YOLO_CLASSES=person,vehicle,animal
OBJECT_MIN_AREA=2500
```

The model is loaded once by `detector/object_detection.py` and reused for all
cameras. Each camera worker reads the latest frame from its RTSP substream,
calls YOLO, applies application-specific filtering, and sends detections to the
backend. The worker also performs tracking, duplicate suppression, snapshot
creation, and event emission in `detector/worker.py`.

The current `yolov8m.pt` is a standard pretrained checkpoint. The repository
does not currently contain a deployed fine-tuned YOLO checkpoint.

Ultralytics supports RTSP sources, streaming prediction, and multi-stream
batching. For a single local process, its Python API can consume an RTSP URL
with `stream=True`; a `.streams` file can provide multiple sources for batched
inference. See the official [predict documentation](https://docs.ultralytics.com/modes/predict/).

## 2. What the model returns

Ultralytics returns detections containing at least:

- Class ID and class name
- Confidence score
- Bounding box coordinates
- Optional masks, poses, or tracking IDs depending on the model/task

Watcher Cam normalizes the result into this internal object:

```python
ObjectDetection(
    bbox=(x1, y1, x2, y2),
    confidence=0.91,
    label="person",
    category="person",
)
```

The application category is not always the same as the model label. For
example, `car`, `truck`, `bus`, and `motorcycle` are mapped to `vehicle`, while
`cat`, `dog`, and `bird` are mapped to `animal`. This mapping is implemented in
`detector/object_detection.py`.

## 3. Deployment choices

### Local CPU

This is the current deployment.

Use it for development, small installations, or low sampling rates. It is
simple and keeps camera footage inside the deployment, but `yolov8m` can become
slow as the number of cameras increases.

### Local or cloud GPU

Run the detector container on a machine with an NVIDIA GPU. Keep the model in
memory and let all camera workers share the same inference service.

This is the preferred architecture for continuous monitoring because it gives
predictable latency, avoids uploading every frame to a third party, and makes
cost easier to control.

For higher throughput, export the trained checkpoint to ONNX or TensorRT and
benchmark the exported model on the target GPU. Ultralytics documents export
formats and TensorRT deployment in its [export documentation](https://docs.ultralytics.com/modes/export/)
and [TensorRT integration guide](https://docs.ultralytics.com/integrations/tensorrt/).

### Ultralytics hosted dedicated endpoint

Ultralytics Platform provides dedicated inference endpoints. A client can send
images to the endpoint, and the platform also documents RTSP input for
inference testing and streaming responses. See the official
[inference API documentation](https://docs.ultralytics.com/platform/deploy/inference)
and [dedicated endpoint documentation](https://docs.ultralytics.com/platform/deploy/endpoints/).

This is useful when:

- A GPU should not be managed by the project team
- A custom model should be deployed quickly
- Monitoring and endpoint operations are worth the service cost

The endpoint must be warm enough for the required latency. Scale-to-zero or
cold-start behavior is inappropriate for strict real-time alerting unless the
latency has been measured and accepted.

### Other hosted inference services

Services such as Roboflow can provide hosted or self-hosted inference and
RTSP-oriented video pipelines. This is useful when annotation, custom training,
model versioning, and stream management are part of the desired workflow. A
hosted service should still be treated as an external dependency with explicit
timeouts, retries, privacy controls, and an outage fallback.

## 4. Recommended architecture for multiple cameras

The recommended design is:

```text
Hikvision cameras
        |
        | RTSP
        v
MediaMTX
        |
        | latest frames from each camera
        v
Watcher Cam detector gateway
        |
        | local inference or HTTPS inference request
        v
Ultralytics YOLO runtime
        |
        v
Tracking, alert suppression, snapshots, backend events
```

The detector gateway should remain responsible for camera and application
behavior. The YOLO runtime should only answer: “What objects are in this
frame?”

This separation allows the model to move between CPU, GPU, and a hosted API
without changing the backend event model or dashboard.

Do not expose private camera RTSP URLs directly to an external provider unless
the provider's network, authentication, and retention behavior are explicitly
acceptable. Prefer pulling the stream locally and sending sampled JPEG frames
over an authenticated HTTPS connection.

## 5. Remote inference adapter

The project should eventually support an inference mode abstraction:

```text
LOCAL  -> current Ultralytics model in detector/object_detection.py
REMOTE -> HTTP client calling a hosted or private YOLO endpoint
```

The worker should continue to call one stable interface:

```text
detect_objects(frame) -> list[ObjectDetection]
```

The remote implementation should:

1. Encode the OpenCV BGR frame as JPEG.
2. Send the JPEG, confidence threshold, and optional camera metadata.
3. Parse the provider response into `ObjectDetection` objects.
4. Apply the existing category mapping and minimum-area filter.
5. Return an empty result after a short timeout rather than blocking the
   camera worker indefinitely.
6. Record latency, status code, provider request ID, and model version in logs.

Suggested future settings are:

```env
INFERENCE_MODE=local
INFERENCE_URL=
INFERENCE_API_KEY=
INFERENCE_TIMEOUT_SECONDS=2
INFERENCE_MAX_IN_FLIGHT=2
INFERENCE_SAMPLE_FPS=1.0
```

API keys must be supplied through environment or secret management. They must
not be stored in camera records, source files, frontend code, snapshots, or
logs.

## 6. Frame sampling and backpressure

Do not send every decoded video frame to a remote API by default. Start with
one or two inference frames per second per camera and increase only after
measuring accuracy and cost.

For `N` cameras sampled at `F` frames per second:

```text
inference requests per second = N × F
```

The gateway should use a queue of size one per camera. When inference is busy,
replace the queued frame with the newest frame instead of building a backlog.
This keeps detection current and avoids reporting events several seconds late.

For a private GPU service, batching one frame from several cameras can improve
GPU utilization. The batch size should be limited by measured latency and GPU
memory, not chosen only from the number of cameras.

Tracking and alert suppression should remain in Watcher Cam. The model does
not need to run at display FPS when the application can track an object between
inference frames.

## 7. Custom training

The repository already contains an animal fine-tuning workflow:

- Script: `training/train_animal_model.py`
- Dataset definition: `training/animal_dataset.yaml`
- Classes: `bird`, `cat`, `dog`
- Output: `training/runs/camera_animals/weights/best.pt`

The dataset should contain clean camera frames with reviewed YOLO annotations.
Include negative frames with no animals so the model learns not to treat
people, timestamps, road markings, and camera equipment as animals. Do not
train directly on already annotated alert snapshots because labels and boxes
may be burned into the image.

The normal workflow is:

```text
Collect representative frames
        ↓
Review and label them
        ↓
Split train and validation data by scene/time
        ↓
Fine-tune from a pretrained checkpoint
        ↓
Validate on unseen camera footage
        ↓
Deploy the selected checkpoint
        ↓
Measure false positives and missed detections
```

After validation, a custom model can be selected locally with:

```env
YOLO_MODEL=/app/models/camera_animals/best.pt
```

The model path must exist inside the detector container. Model artifacts should
be mounted or copied during deployment and should not be committed to Git.

## 8. Model selection guidance

Use a smaller model when the priority is throughput and a larger model when
small or distant objects are more important.

```text
smaller model  -> lower latency, lower memory, lower cost
larger model   -> potentially better accuracy, higher latency and cost
```

The correct choice depends on camera resolution, object size, lighting, camera
angle, and target FPS. Benchmark on real footage from the intended cameras.
Generic benchmark numbers are not a substitute for measuring the project
scenes.

Important tuning parameters include:

- Confidence threshold: false-positive versus missed-detection tradeoff
- Input image size: small-object accuracy versus speed
- Minimum detection area: ignore distant or noisy boxes
- Sampling FPS: alert responsiveness versus compute cost
- IoU and tracking thresholds: object identity and duplicate-alert behavior

## 9. Testing and production acceptance

Before switching a camera fleet to a new model or endpoint, test:

- Person, vehicle, and animal detection on day and night footage
- Empty scenes and difficult backgrounds
- Small and partially occluded objects
- Multiple objects in one frame
- Camera disconnect and reconnect
- API timeout and API outage behavior
- Duplicate alert suppression
- Snapshot bounding-box alignment
- Event timestamp accuracy
- Inference latency at the target number of cameras
- CPU/GPU utilization and memory usage

Track at least these metrics:

```text
frames sampled
frames successfully inferred
inference latency p50/p95
API errors and timeouts
detections by class
alerts by class
false positives
missed detections
oldest queued-frame age
```

The deployment should have a model version recorded with each detection or
event so that results remain explainable after a model update.

## 10. Security and privacy

- Keep camera credentials out of API URLs whenever possible.
- Use private networking or an authenticated HTTPS endpoint for remote
  inference.
- Do not send full-resolution frames when a smaller image is sufficient.
- Define image retention and provider data-use policies before using hosted
  inference.
- Restrict inference API keys to the detector service.
- Avoid logging raw frame data or signed image URLs.
- Keep local snapshots and hosted-provider copies under separate retention
  policies.

## 11. Licensing

Ultralytics currently offers the YOLO software and trained models under
AGPL-3.0 or a separate Enterprise license. Ultralytics states that commercial,
proprietary, SaaS, and customer-facing deployments may require an Enterprise
license unless the AGPL obligations are satisfied. Review the current
[Ultralytics licensing page](https://www.ultralytics.com/license) with the
project's legal counsel before launching a closed-source commercial product.

This is separate from infrastructure cost. Paying for a GPU or hosted endpoint
does not automatically resolve model or framework licensing obligations.

## 12. Recommended rollout

### Phase 1: stabilize the local interface

- Keep the current local `yolov8m.pt` path working.
- Add a provider-neutral inference interface.
- Add latency and model-version logging.
- Add explicit timeouts and newest-frame-only queues.

### Phase 2: benchmark a GPU

- Run the same model on a persistent GPU.
- Compare CPU, GPU, and exported TensorRT performance.
- Test the actual target camera count and sample rate.

### Phase 3: test a hosted endpoint

- Send one JPEG per second from one camera.
- Compare detection quality with local inference.
- Measure network latency, API failures, cost, and privacy implications.
- Keep local inference as a fallback.

### Phase 4: deploy custom models

- Collect representative reviewed footage.
- Fine-tune only for classes where the pretrained model is insufficient.
- Validate against held-out camera scenes.
- Deploy the model with an explicit version and rollback path.

## Decision summary

For a small development installation, keep the current local model.

For several always-on cameras, use a persistent GPU inference service and keep
the existing detector as the stream/event gateway.

For a fast hosted proof of concept, test an Ultralytics dedicated endpoint or
Roboflow pipeline with one camera and low FPS first.

For a commercial closed-source deployment, resolve Ultralytics licensing before
shipping.
