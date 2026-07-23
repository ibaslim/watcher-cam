# Camera-specific animal fine-tuning

The training workflow supports the three production animal classes: bird, cat,
and dog. Images must be reviewed and annotated in YOLO format before training.
Do not train directly on alert snapshots: their boxes and labels are burned
into the pixels, and several existing labels are known to be wrong.

Place clean, representative camera frames and labels in:

```text
training/dataset/
  images/train/
  images/val/
  labels/train/
  labels/val/
```

Each image needs a matching `.txt` label file. Use class `0` for bird, `1` for
cat, and `2` for dog. Include reviewed frames with no animals as empty label
files; these hard negatives teach the model not to classify people, timestamp
text, road markings, or equipment as animals.

Train on a CUDA GPU:

```powershell
python training/train_animal_model.py
```

After validation, copy `training/runs/camera_animals/weights/best.pt` to the
detector image and set `YOLO_MODEL` to that path.
