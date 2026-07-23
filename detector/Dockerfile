FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    INSIGHTFACE_HOME=/root/.insightface

# Runtime deps (libgl/ffmpeg) + build toolchain (InsightFace 0.7.x ships no
# pre-built wheel for slim base images and must compile its Cython extensions).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 ffmpeg \
    build-essential python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY requirements.txt .
# numpy and Cython must be available at insightface wheel-build time.
RUN pip install --upgrade pip && \
    pip install numpy==1.26.4 cython==3.0.11 && \
    pip install -r requirements.txt

# Pre-download the InsightFace buffalo_l model pack at build time so the
# container starts instantly (otherwise every first run fetches ~300MB).
RUN python -c "from insightface.app import FaceAnalysis; \
  app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']); \
  app.prepare(ctx_id=0, det_size=(640, 640))"

# Pre-download the default YOLO model too. Otherwise the first live detection
# after each fresh container recreate can block while ultralytics downloads it.
RUN python -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"

# Strip build tools now that InsightFace is compiled — keeps the runtime image
# ~200MB smaller.
RUN apt-get purge -y build-essential python3-dev && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/* /root/.cache

# Put source inside a `detector/` package dir so `python -m detector.main` works.
COPY . /workspace/detector/

EXPOSE 8001

CMD ["python", "-m", "detector.main"]
