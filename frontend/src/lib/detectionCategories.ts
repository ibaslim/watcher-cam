export type DetectionCategory = "person" | "vehicle" | "animal" | "other";

const VEHICLE_LABELS = new Set([
  "bicycle",
  "bike",
  "bus",
  "car",
  "motorbike",
  "motorcycle",
  "truck",
  "van",
  "vehicle",
]);

const ANIMAL_LABELS = new Set([
  "animal",
  "bird",
  "cat",
  "cow",
  "dog",
  "horse",
  "sheep",
]);

export function getDetectionCategory(value: string | null | undefined): DetectionCategory {
  const normalized = (value || "").trim().toLowerCase().replace(/_/g, " ");
  if (!normalized) return "other";

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const tokenSet = new Set(tokens);

  if (tokenSet.has("person") || normalized === "person detected") return "person";
  if (tokens.some((token) => VEHICLE_LABELS.has(token)) || normalized === "vehicle detected") return "vehicle";
  if (tokens.some((token) => ANIMAL_LABELS.has(token)) || normalized === "animal detected") return "animal";

  return "other";
}

export function detectionCategoryLabel(category: DetectionCategory): string {
  if (category === "person") return "Person";
  if (category === "vehicle") return "Vehicle";
  if (category === "animal") return "Animal";
  return "Other";
}
