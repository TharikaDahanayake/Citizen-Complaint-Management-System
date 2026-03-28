from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib

from label_config import department_for_category


def load_artifacts(artifacts_dir: Path):
    vectorizer = joblib.load(artifacts_dir / "vectorizer.joblib")
    model = joblib.load(artifacts_dir / "model.joblib")
    label_encoder = joblib.load(artifacts_dir / "label_encoder.joblib")
    metadata = json.loads((artifacts_dir / "metadata.json").read_text(encoding="utf-8"))
    return vectorizer, model, label_encoder, metadata


def predict_from_description(description: str, artifacts_dir: Path) -> dict:
    if not description or not description.strip():
        raise ValueError("Complaint description is required.")

    vectorizer, model, label_encoder, metadata = load_artifacts(artifacts_dir)
    threshold = float(metadata.get("threshold", {}).get("selected", 0.65))

    features = vectorizer.transform([description.strip()])
    probabilities = model.predict_proba(features)[0]
    best_index = int(probabilities.argmax())
    confidence = float(probabilities[best_index])
    category = str(label_encoder.inverse_transform([best_index])[0])

    department = department_for_category(category)

    return {
        "input": description.strip(),
        "complaintCategory": category,
        "departmentID": department.department_id,
        "department": department.department_name,
        "confidence": confidence,
        "reviewRequired": confidence < threshold,
        "threshold": threshold,
        "modelVersion": metadata.get("modelVersion", "unknown"),
    }


def main():
    parser = argparse.ArgumentParser(description="Predict complaint category from complaint description")
    parser.add_argument("--description", required=True, help="Complaint description text")
    parser.add_argument("--artifacts", default="ml/artifacts/current", help="Artifacts directory")
    args = parser.parse_args()

    result = predict_from_description(args.description, Path(args.artifacts))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
