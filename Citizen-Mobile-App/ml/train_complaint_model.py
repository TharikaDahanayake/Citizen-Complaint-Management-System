from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

from label_config import CATEGORY_ORDER, department_for_category, normalize_label


def normalize_text(value: str) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").replace("\r", " ")
    return " ".join(text.split()).strip()


def load_and_clean_dataset(data_path: Path) -> pd.DataFrame:
    dataframe = pd.read_excel(data_path)

    required_columns = {"complaint", "category"}
    missing = required_columns - set(dataframe.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    cleaned = dataframe[["complaint", "category"]].copy()
    cleaned["complaint"] = cleaned["complaint"].map(normalize_text)
    cleaned["category"] = cleaned["category"].map(normalize_label)
    cleaned = cleaned[cleaned["complaint"].str.len() > 0]
    cleaned = cleaned.reset_index(drop=True)

    return cleaned


def split_data(cleaned: pd.DataFrame, seed: int):
    train_df, temp_df = train_test_split(
        cleaned,
        test_size=0.30,
        random_state=seed,
        stratify=cleaned["category"],
    )
    valid_df, test_df = train_test_split(
        temp_df,
        test_size=0.50,
        random_state=seed,
        stratify=temp_df["category"],
    )
    return train_df.reset_index(drop=True), valid_df.reset_index(drop=True), test_df.reset_index(drop=True)


def tune_threshold(probabilities: np.ndarray, y_true: np.ndarray) -> tuple[float, float, float]:
    best_threshold = 0.65
    best_score = -1.0
    best_coverage = 0.0

    for threshold in np.arange(0.40, 0.91, 0.01):
        accepted_mask = probabilities.max(axis=1) >= threshold
        coverage = float(accepted_mask.mean())
        if coverage < 0.60:
            continue

        accepted_true = y_true[accepted_mask]
        accepted_pred = probabilities[accepted_mask].argmax(axis=1)
        if len(accepted_true) == 0:
            continue

        macro_f1 = f1_score(accepted_true, accepted_pred, average="macro")
        combined_score = (macro_f1 * 0.8) + (coverage * 0.2)
        if combined_score > best_score:
            best_score = combined_score
            best_threshold = float(threshold)
            best_coverage = coverage

    return best_threshold, best_score, best_coverage


def save_artifacts(
    output_dir: Path,
    vectorizer: TfidfVectorizer,
    model: LogisticRegression,
    label_encoder: LabelEncoder,
    metadata: dict,
):
    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(vectorizer, output_dir / "vectorizer.joblib")
    joblib.dump(model, output_dir / "model.joblib")
    joblib.dump(label_encoder, output_dir / "label_encoder.joblib")
    (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Train complaint category classifier from Excel dataset.")
    parser.add_argument("--data", default="data/complaints_dataset.xlsx", help="Path to input Excel dataset")
    parser.add_argument("--output", default="ml/artifacts/current", help="Directory to write model artifacts")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    data_path = Path(args.data)
    output_dir = Path(args.output)

    cleaned = load_and_clean_dataset(data_path)
    train_df, valid_df, test_df = split_data(cleaned, seed=args.seed)

    vectorizer = TfidfVectorizer(
        lowercase=True,
        strip_accents="unicode",
        ngram_range=(1, 2),
        min_df=2,
        sublinear_tf=True,
        max_features=20000,
    )
    x_train = vectorizer.fit_transform(train_df["complaint"])
    x_valid = vectorizer.transform(valid_df["complaint"])
    x_test = vectorizer.transform(test_df["complaint"])

    label_encoder = LabelEncoder()
    label_encoder.fit(CATEGORY_ORDER)
    y_train = label_encoder.transform(train_df["category"])
    y_valid = label_encoder.transform(valid_df["category"])
    y_test = label_encoder.transform(test_df["category"])

    model = LogisticRegression(
        max_iter=3000,
        class_weight="balanced",
        C=2.0,
        solver="lbfgs",
    )
    model.fit(x_train, y_train)

    valid_probs = model.predict_proba(x_valid)
    valid_pred = valid_probs.argmax(axis=1)
    test_probs = model.predict_proba(x_test)
    test_pred = test_probs.argmax(axis=1)

    threshold, threshold_score, threshold_coverage = tune_threshold(valid_probs, y_valid)

    class_names = label_encoder.inverse_transform(np.arange(len(label_encoder.classes_))).tolist()

    valid_report = classification_report(
        y_valid,
        valid_pred,
        target_names=class_names,
        output_dict=True,
        zero_division=0,
    )
    test_report = classification_report(
        y_test,
        test_pred,
        target_names=class_names,
        output_dict=True,
        zero_division=0,
    )

    valid_cm = confusion_matrix(y_valid, valid_pred).tolist()
    test_cm = confusion_matrix(y_test, test_pred).tolist()

    category_to_department = {
        category: asdict(department_for_category(category))
        for category in CATEGORY_ORDER
    }

    metadata = {
        "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "inputColumn": "complaint",
        "targetColumn": "category",
        "modelType": "tfidf_logistic_regression",
        "modelVersion": datetime.now(timezone.utc).strftime("complaint-model-%Y%m%d-%H%M%S"),
        "randomSeed": args.seed,
        "threshold": {
            "selected": threshold,
            "selectionScore": threshold_score,
            "expectedCoverage": threshold_coverage,
        },
        "data": {
            "path": str(data_path),
            "totalRows": int(len(cleaned)),
            "split": {
                "train": int(len(train_df)),
                "validation": int(len(valid_df)),
                "test": int(len(test_df)),
            },
            "labelDistribution": cleaned["category"].value_counts().to_dict(),
        },
        "labels": class_names,
        "categoryToDepartment": category_to_department,
        "metrics": {
            "validation": {
                "macroF1": valid_report["macro avg"]["f1-score"],
                "accuracy": valid_report["accuracy"],
                "report": valid_report,
                "confusionMatrix": valid_cm,
            },
            "test": {
                "macroF1": test_report["macro avg"]["f1-score"],
                "accuracy": test_report["accuracy"],
                "report": test_report,
                "confusionMatrix": test_cm,
            },
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    train_df.to_csv(output_dir / "train_split.csv", index=False)
    valid_df.to_csv(output_dir / "validation_split.csv", index=False)
    test_df.to_csv(output_dir / "test_split.csv", index=False)

    save_artifacts(
        output_dir=output_dir,
        vectorizer=vectorizer,
        model=model,
        label_encoder=label_encoder,
        metadata=metadata,
    )

    print("Training complete.")
    print(f"Rows after cleaning: {len(cleaned)}")
    print(f"Validation macro F1: {valid_report['macro avg']['f1-score']:.4f}")
    print(f"Test macro F1: {test_report['macro avg']['f1-score']:.4f}")
    print(f"Selected confidence threshold: {threshold:.2f}")
    print(f"Artifacts saved to: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
