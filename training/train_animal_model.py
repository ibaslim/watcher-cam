from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fine-tune the animal detector on reviewed camera images."
    )
    parser.add_argument("--data", default="training/animal_dataset.yaml")
    parser.add_argument("--model", default="yolov8m.pt")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--image-size", type=int, default=960)
    parser.add_argument("--device", default="0")
    args = parser.parse_args()

    data = Path(args.data)
    if not data.is_file():
        raise SystemExit(f"dataset configuration not found: {data}")

    model = YOLO(args.model)
    model.train(
        data=str(data),
        epochs=args.epochs,
        imgsz=args.image_size,
        device=args.device,
        project="training/runs",
        name="camera_animals",
    )


if __name__ == "__main__":
    main()
