# Interactive XAI Healthcare Risk Screening

An interactive explainable AI prototype for healthcare risk screening. The system allows a clinician or reviewer to enter patient screening details, view a risk prediction, inspect clinical explanation factors, and submit case-scoped feedback on the model explanation.

This project is a BSc final year prototype. It is for screening support and demonstration purposes only, not for real clinical diagnosis or production medical use.

## Features

- FastAPI backend for prediction, explanation, feedback, preferences, analytics, and model metadata.
- React + Vite frontend with a clinician-style workflow.
- Clinical ID session entry screen.
- Case-scoped prediction and explanation flow.
- SHAP-based explanation panels for factors increasing and reducing estimated risk.
- Clinician feedback capture for relevant, irrelevant, confusing, short, and detailed explanation preferences.
- Disputed factors remain visible in explanations and are marked for transparency.
- Model metadata endpoint for version and artifact information.

## UI Workflow

The frontend uses a multi-page app workflow:

- `#/login` - Clinical ID session entry
- `#/case` - Patient Details
- `#/risk` - Risk Summary
- `#/explanation` - Clinical Explanation
- `#/feedback` - Clinician Feedback

The Clinical ID is used as the `user_id` for API calls, preferences, analytics, and feedback tracking. It is a prototype session identifier, not production authentication.

## Backend (FastAPI)

Run from the project root:

```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs:

- `http://127.0.0.1:8000/docs`

Health check:

- `http://127.0.0.1:8000/`

## Frontend (React + Vite)

Run from `frontend/`:

```bash
npm.cmd install
npm.cmd run dev
```

Frontend URL:

- `http://127.0.0.1:5173`

Set API URL with `frontend/.env`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Optional, if backend auth is enabled:

```bash
VITE_API_TOKEN=<your-api-token>
```

Do not commit `frontend/.env`. Use `frontend/.env.example` as the template.

## Local Verification

Backend tests:

```bash
python -m pytest -q tests
```

Frontend build:

```bash
cd frontend
npm.cmd run build
```

Manual app check:

1. Open the frontend URL.
2. Enter a `Clinical ID` on the login screen.
3. Complete patient details on the Patient Details page.
4. Run **Predict Risk**.
5. Review the **Risk Summary** page.
6. Open **Clinical Explanation** to inspect model contributors.
7. Use **Clinician Feedback** to submit case-scoped feedback.
8. Confirm disputed factors remain visible and marked in explanations.

## API Summary

Main endpoints:

- `POST /predict`
- `POST /explain`
- `POST /feedback`
- `GET /preferences`
- `POST /preferences`
- `GET /analytics/summary`
- `GET /analytics/top_features`
- `GET /model/info`

Prediction responses include:

- `risk`
- `threshold`
- `flagged`
- `case_id`
- `model_version`

Feature-level feedback types such as `relevant`, `irrelevant`, and `confusing` require:

- `feature_name`
- `case_id`

## Security Configuration

By default, auth is disabled for local development:

```bash
AUTH_REQUIRED=false
```

Enable token auth with:

```bash
AUTH_REQUIRED=true
USER_TOKENS=user_a:token_a,user_b:token_b
```

Alternative JSON format:

```bash
USER_TOKENS_JSON={"user_a":"token_a","user_b":"token_b"}
```

Rate limiting defaults:

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_PER_MIN=60
```

## Model Artifacts

The backend loads trained model artifacts from `artifacts/` by default. Keep this folder if you want the app to run immediately after cloning.

Training, calibration, and SHAP scripts use a shared artifact directory:

- `ARTIFACT_DIR` default: `artifacts`
- optional `MODEL_VERSION`

Example:

```bash
ARTIFACT_DIR=artifacts
MODEL_VERSION=20260301T120000Z
python framingham_xgb_train.py
python next_step_screening_calibrate.py
python framingham_step2_shap.py
```

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs:

- backend compile checks and pytest
- frontend build check

## Quick Deploy (Testing)

### 1. Deploy Backend to Render

1. In Render, choose **New +** -> **Blueprint**.
2. Connect this GitHub repo and select branch `main`.
3. Render will read `render.yaml` and create `interactive-xai-api`.
4. In Render service environment variables, set:
   - `CORS_ORIGINS=https://<your-frontend-domain>`
   - optional for Vercel preview URLs: `CORS_ORIGIN_REGEX=^https://.*\\.vercel\\.app$`
5. Deploy and copy the backend URL, for example:
   - `https://interactive-xai-api.onrender.com`

### 2. Deploy Frontend to Vercel

1. Import the same repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Add environment variable:
   - `VITE_API_BASE_URL=https://<your-render-backend-url>`
4. Deploy.

### 3. Verify Deployment

1. Open the frontend URL.
2. Enter a `Clinical ID`.
3. Complete patient details and run **Predict Risk**.
4. Review **Risk Summary** and **Clinical Explanation**.
5. Submit feedback from **Clinician Feedback**.

## Notes

- This application does not provide medical diagnosis.
- Clinical prompts are explanation aids and should be interpreted by qualified clinicians.
- The Clinical ID screen is a prototype session entry flow, not a production login system.
- Do not commit generated files such as `node_modules/`, `dist/`, `feedback.db`, logs, or Python cache folders.
