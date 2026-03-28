# Complaint Category Model Training

This folder contains a true supervised ML pipeline trained from your labeled dataset.

## Dataset location

- Expected path: `data/complaints_dataset.xlsx`
- Required columns:
  - `complaint` (input text)
  - `category` (target label)

## Supported output categories

- `traffic issues`
- `Public Nuisance / Cleanliness`
- `Neighbor / Community Issues`

## 1) Install Python dependencies

```bash
pip install pandas scikit-learn openpyxl joblib numpy
```

## 2) Train model

Run from the `Citizen-Mobile-App` folder:

```bash
python ml/train_complaint_model.py --data data/complaints_dataset.xlsx --output ml/artifacts/current
```

What training does:

- Cleans text and normalizes labels.
- Uses stratified split (70% train, 15% validation, 15% test).
- Trains TF-IDF + Logistic Regression.
- Computes validation/test metrics and confusion matrix.
- Tunes confidence threshold on validation split.
- Saves artifacts and split CSVs under `ml/artifacts/current`.

## 3) Predict from complaint description

```bash
python ml/predict_complaint_category.py --description "vehicle blocking main road and causing heavy traffic" --artifacts ml/artifacts/current
```

Response includes:

- `complaintCategory`
- `departmentID`
- `department`
- `confidence`
- `reviewRequired`
- `threshold`
- `modelVersion`

## 4) Run local prediction API server (for mobile app)

```bash
python ml/predict_api_server.py --host 0.0.0.0 --port 8000 --artifacts ml/artifacts/current
```

API endpoints:

- `GET /health`
- `POST /predict`

Example request body:

```json
{
  "description": "Vehicle blocking pedestrian crossing near the signal"
}
```

In Expo app config (`.env`), set:

```bash
EXPO_PUBLIC_COMPLAINT_AI_API_URL=http://10.0.2.2:8000/predict
```

Use your machine LAN IP instead of `10.0.2.2` when testing on a physical phone.

## Artifacts generated

- `ml/artifacts/current/vectorizer.joblib`
- `ml/artifacts/current/model.joblib`
- `ml/artifacts/current/label_encoder.joblib`
- `ml/artifacts/current/metadata.json`
- `ml/artifacts/current/train_split.csv`
- `ml/artifacts/current/validation_split.csv`
- `ml/artifacts/current/test_split.csv`
