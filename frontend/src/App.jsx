import { useEffect, useMemo, useState } from "react";
import {
  explainPatient,
  getAnalyticsSummary,
  getPreferences,
  getTopFeatures,
  predictPatient,
  setPreferences,
  submitFeedback
} from "./api/client";

const INITIAL_PATIENT = {
  male: "",
  age: "",
  education: "",
  currentSmoker: "",
  cigsPerDay: "",
  BPMeds: "",
  prevalentStroke: "",
  prevalentHyp: "",
  diabetes: "",
  totChol: "",
  sysBP: "",
  diaBP: "",
  BMI: "",
  heartRate: "",
  glucose: ""
};

const FIELD_META = {
  male: { label: "Sex (Male=1, Female=0)", unit: "binary", step: "1", min: 0, max: 1 },
  age: { label: "Age", unit: "years", step: "1", min: 18, max: 110 },
  education: { label: "Education Level", unit: "1-4", step: "1", min: 1, max: 4, optional: true },
  currentSmoker: { label: "Current Smoker", unit: "binary", step: "1", min: 0, max: 1 },
  cigsPerDay: { label: "Cigarettes per Day", unit: "count", step: "1", min: 0, optional: true },
  BPMeds: { label: "On BP Medication", unit: "binary", step: "1", min: 0, max: 1, optional: true },
  prevalentStroke: { label: "History of Stroke", unit: "binary", step: "1", min: 0, max: 1 },
  prevalentHyp: { label: "History of Hypertension", unit: "binary", step: "1", min: 0, max: 1 },
  diabetes: { label: "Diabetes Diagnosis", unit: "binary", step: "1", min: 0, max: 1 },
  totChol: { label: "Total Cholesterol", unit: "mg/dL", step: "1", min: 50, optional: true },
  sysBP: { label: "Systolic BP", unit: "mmHg", step: "1", min: 60 },
  diaBP: { label: "Diastolic BP", unit: "mmHg", step: "1", min: 40 },
  BMI: { label: "BMI", unit: "kg/m^2", step: "0.1", min: 10, optional: true },
  heartRate: { label: "Heart Rate", unit: "bpm", step: "1", min: 30, optional: true },
  glucose: { label: "Glucose", unit: "mg/dL", step: "1", min: 30, optional: true }
};

const FIELD_ORDER = Object.keys(FIELD_META);
const FEATURE_FEEDBACK_TYPES = ["irrelevant", "confusing", "relevant"];
const WORKFLOW_ROUTES = ["case", "risk", "explanation", "feedback"];
const ROUTES = ["login", ...WORKFLOW_ROUTES];
const FEEDBACK_LABELS = {
  relevant: "This prediction seems reasonable for the selected factor",
  irrelevant: "This factor is not clinically relevant here",
  confusing: "This explanation is confusing",
  prefer_short: "Use a shorter explanation next time",
  prefer_long: "Show more explanation detail next time"
};

const CLINICAL_PROMPTS = {
  sysBP: "Review blood pressure history and management.",
  diaBP: "Review blood pressure history and management.",
  prevalentHyp: "Review blood pressure history and management.",
  currentSmoker: "Consider smoking status in cardiovascular risk discussion.",
  cigsPerDay: "Consider smoking status in cardiovascular risk discussion.",
  glucose: "Review glycaemic history or diabetes status.",
  diabetes: "Review glycaemic history or diabetes status.",
  totChol: "Review lipid history and cardiovascular risk profile.",
  BMI: "Consider weight-related cardiovascular risk context."
};

function createCaseId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `case_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `case_${Date.now()}`;
}

function formatRisk(v) {
  if (typeof v !== "number") return "-";
  return `${(v * 100).toFixed(2)}%`;
}

function riskTone(risk, threshold) {
  if (typeof risk !== "number") return "neutral";
  if (typeof threshold !== "number" || threshold <= 0) {
    if (risk >= 0.5) return "high";
    if (risk >= 0.2) return "medium";
    return "low";
  }
  if (risk >= threshold * 1.2) return "high";
  if (risk >= threshold) return "medium";
  return "low";
}

function AlertModal({ open, title, message, onClose }) {
  if (!open) return null;
  return (
    <div className="alert-backdrop" role="alertdialog" aria-modal="true">
      <div className="alert-modal">
        <h3>{title}</h3>
        <p>{message}</p>
        <button onClick={onClose}>OK</button>
      </div>
    </div>
  );
}

function rawFeatureName(featureName) {
  if (typeof featureName === "string" && featureName.includes("__")) {
    return featureName.split("__").at(-1);
  }
  return featureName;
}

function FeatureTable({ title, items, resolveFeatureLabel, getClinicalPrompt }) {
  return (
    <div className="result-card">
      <h3>{title}</h3>
      {!items || items.length === 0 ? (
        <p className="muted">No items available.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Value</th>
              <th>SHAP</th>
              <th>Clinical prompt</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={`${item.feature}-${idx}`}>
                <td>
                  {resolveFeatureLabel ? resolveFeatureLabel(item.feature) : item.feature}
                  {item.disputed ? " (disputed)" : ""}
                </td>
                <td>{String(item.value)}</td>
                <td>{Number(item.shap).toFixed(4)}</td>
                <td className="clinical-prompt">
                  {getClinicalPrompt ? getClinicalPrompt(item.feature) : "Review in clinical context."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function viewFromHash() {
  if (typeof window === "undefined") return "login";
  const value = window.location.hash.replace(/^#\/?/, "");
  return ROUTES.includes(value) ? value : "login";
}

export default function App() {
  const [userId, setUserId] = useState("");
  const [loginInput, setLoginInput] = useState("");
  const [patient, setPatient] = useState(INITIAL_PATIENT);
  const [feedbackType, setFeedbackType] = useState("irrelevant");
  const [feedbackFeature, setFeedbackFeature] = useState("sysBP");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [activeCaseId, setActiveCaseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [predictOut, setPredictOut] = useState(null);
  const [explainOut, setExplainOut] = useState(null);
  const [prefsOut, setPrefsOut] = useState(null);
  const [analyticsOut, setAnalyticsOut] = useState(null);
  const [topFeaturesOut, setTopFeaturesOut] = useState([]);
  const [showRawJson, setShowRawJson] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [activeView, setActiveView] = useState(viewFromHash);
  const [alertState, setAlertState] = useState({
    open: false,
    title: "",
    message: ""
  });

  const latestOut = explainOut ?? predictOut;
  const latestRiskValue = latestOut?.risk;
  const latestThresholdValue = latestOut?.threshold;
  const latestFlagged = latestOut?.flagged;
  const latestCaseId = latestOut?.case_id || activeCaseId;
  const latestModelVersion = latestOut?.model_version || explainOut?.meta?.model_version;
  const latestRisk = useMemo(() => formatRisk(latestRiskValue), [latestRiskValue]);
  const explainRisk = useMemo(() => formatRisk(explainOut?.risk), [explainOut]);
  const predictRisk = useMemo(() => formatRisk(predictOut?.risk), [predictOut]);
  const tone = riskTone(latestRiskValue, latestThresholdValue);
  const hasSession = userId.trim().length > 0;
  const hasPrediction = Boolean(predictOut);
  const hasExplanation = Boolean(explainOut);
  const feedbackNeedsFeature = FEATURE_FEEDBACK_TYPES.includes(feedbackType);
  const ringPct = useMemo(() => {
    if (typeof latestRiskValue !== "number") return 0;
    return Math.max(0, Math.min(100, latestRiskValue * 100));
  }, [latestRiskValue]);

  useEffect(() => {
    function syncHash() {
      setActiveView(viewFromHash());
    }
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/login");
    }
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    if (!hasSession && activeView !== "login") {
      goToView("login");
    }
  }, [activeView, hasSession]);

  function goToView(view) {
    if (!ROUTES.includes(view)) return;
    setActiveView(view);
    if (typeof window !== "undefined" && window.location.hash !== `#/${view}`) {
      window.location.hash = `/${view}`;
    }
  }

  function clearCaseState() {
    setPatient(INITIAL_PATIENT);
    setFeedbackType("irrelevant");
    setFeedbackFeature("sysBP");
    setFeedbackMessage("");
    setActiveCaseId("");
    setError("");
    setNotice("");
    setPredictOut(null);
    setExplainOut(null);
    setPrefsOut(null);
    setAnalyticsOut(null);
    setTopFeaturesOut([]);
    setShowRawJson(false);
    setShowExplanation(false);
  }

  function enterSession(e) {
    e.preventDefault();
    const clinicalId = loginInput.trim();
    if (!clinicalId) {
      openAlert("Clinical ID Required", "Enter a Clinical ID to access the screening workflow.");
      return;
    }
    clearCaseState();
    setUserId(clinicalId);
    setLoginInput(clinicalId);
    setNotice(`Welcome, ${clinicalId}.`);
    goToView("case");
  }

  function endSession() {
    clearCaseState();
    setUserId("");
    setLoginInput("");
    goToView("login");
  }

  function resolveFeatureLabel(featureName) {
    if (!featureName) return "-";
    const raw = rawFeatureName(featureName);
    const direct = FIELD_META[raw]?.label;
    if (direct) return direct;
    return featureName;
  }

  function getClinicalPrompt(featureName) {
    const raw = rawFeatureName(featureName);
    return CLINICAL_PROMPTS[raw] || "Review this factor alongside the full clinical picture.";
  }

  function chooseFeedback(type, message = "") {
    setFeedbackType(type);
    setFeedbackMessage(message);
  }

  function updateField(name, value) {
    setPatient((prev) => ({ ...prev, [name]: value }));
  }

  function openAlert(title, message) {
    setAlertState({ open: true, title, message });
  }

  function closeAlert() {
    setAlertState({ open: false, title: "", message: "" });
  }

  function validatePatientInput() {
    const issues = [];
    for (const field of FIELD_ORDER) {
      const meta = FIELD_META[field];
      const raw = patient[field];
      if (raw === "" || raw === null || raw === undefined) {
        if (!meta.optional) {
          issues.push(`${meta.label}: this field is required.`);
        }
        continue;
      }
      const num = Number(raw);
      if (Number.isNaN(num)) {
        issues.push(`${meta.label}: must be a number.`);
        continue;
      }
      if (meta.min !== undefined && num < meta.min) {
        issues.push(`${meta.label}: cannot be less than ${meta.min}.`);
      }
      if (meta.max !== undefined && num > meta.max) {
        issues.push(`${meta.label}: cannot be greater than ${meta.max}.`);
      }
    }
    return issues;
  }

  async function runPredict() {
    if (!hasSession) {
      openAlert("User ID Required", "Enter a User ID before running prediction.");
      return;
    }
    const issues = validatePatientInput();
    if (issues.length > 0) {
      openAlert("Invalid Input", issues[0]);
      return;
    }
    setBusyLabel("Running prediction...");
    setLoading(true);
    setError("");
    setNotice("");
    const nextCaseId = createCaseId();
    try {
      const data = await predictPatient(patient, userId, nextCaseId);
      setPredictOut(data);

      const caseId = data.case_id || nextCaseId;
      setActiveCaseId(caseId);
      setShowExplanation(false);
      goToView("risk");
      setNotice(`Prediction completed for case ${caseId}. Review the risk summary before opening the explanation.`);

      // Prepare the explanation after prediction, but keep it visually secondary.
      try {
        const exp = await explainPatient(patient, userId, caseId);
        setExplainOut(exp);
      } catch (explainErr) {
        setNotice(`Prediction completed for case ${caseId}, but explanation failed.`);
        setError(String(explainErr.message || explainErr));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  }


  async function runExplain() {
    if (!hasSession) {
      openAlert("User ID Required", "Enter a User ID before generating explanation.");
      return;
    }
    const issues = validatePatientInput();
    if (issues.length > 0) {
      openAlert("Invalid Input", issues[0]);
      return;
    }
    setBusyLabel("Generating explanation...");
    setLoading(true);
    setError("");
    setNotice("");
    const caseIdForExplain = activeCaseId || createCaseId();
    try {
      const data = await explainPatient(patient, userId, caseIdForExplain);
      setExplainOut(data);
      setActiveCaseId(data.case_id || caseIdForExplain);
      setShowExplanation(true);
      goToView("explanation");
      setNotice(`Explanation generated for case ${data.case_id || caseIdForExplain}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  }


  async function saveFeedback() {
    if (!hasSession) {
      openAlert("User ID Required", "Enter a User ID before saving feedback.");
      return;
    }
    if (feedbackNeedsFeature && !activeCaseId) {
      openAlert("Case ID Required", "Run Predict or Explain first to create a case context for feature feedback.");
      return;
    }
    if (feedbackNeedsFeature && !feedbackFeature) {
      openAlert("Feature Required", "Select a feature for this feedback type.");
      return;
    }
    setBusyLabel("Saving feedback...");
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await submitFeedback({
        userId,
        feedbackType,
        featureName: feedbackNeedsFeature ? feedbackFeature : null,
        caseId: feedbackNeedsFeature ? activeCaseId : null,
        message: feedbackMessage
      });
      await loadPreferences();
      await loadAnalytics();
      // Refresh explanation after feedback so the UI reflects disputed features/preferences
      if (activeCaseId) {
        try {
          const exp = await explainPatient(patient, userId, activeCaseId);
          setExplainOut(exp);
        } catch (explainErr) {
          setError(String(explainErr.message || explainErr));
        }
      }
      setNotice(`Feedback saved${activeCaseId ? ` for case ${activeCaseId}` : ""} and profile refreshed.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  }

  async function loadPreferences() {
    const data = await getPreferences(userId);
    setPrefsOut(data);
  }

  async function savePreferences() {
    if (!hasSession) {
      openAlert("User ID Required", "Enter a User ID before saving preferences.");
      return;
    }
    setBusyLabel("Saving preferences...");
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await setPreferences({
        userId,
        topK: Number(prefsOut?.top_k || 8),
        style: prefsOut?.style || "simple"
      });
      await loadPreferences();
      setNotice("Preferences updated.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  }

  async function loadAnalytics() {
    if (!hasSession) {
      setAnalyticsOut(null);
      setTopFeaturesOut([]);
      return;
    }
    const [summary, top] = await Promise.all([
      getAnalyticsSummary(userId),
      getTopFeatures({ feedbackType: "irrelevant", limit: 5, userId })
    ]);
    setAnalyticsOut(summary);
    setTopFeaturesOut(top.top_features || []);
  }

  async function refreshAll() {
    if (!hasSession) {
      openAlert("User ID Required", "Enter a User ID before refreshing profile.");
      return;
    }
    setBusyLabel("Refreshing profile...");
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await Promise.all([loadPreferences(), loadAnalytics()]);
      setNotice("Preferences and analytics refreshed.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setBusyLabel("");
    }
  }

  function resetPatient() {
    clearCaseState();
    goToView("case");
    setNotice("Patient form cleared.");
  }

  if (!hasSession) {
    return (
      <div className="login-shell">
        <AlertModal
          open={alertState.open}
          title={alertState.title}
          message={alertState.message}
          onClose={closeAlert}
        />
        <section className="login-panel">
          <div className="login-brand">
            <p className="eyebrow">Interactive Explainable AI</p>
            <h1>Clinical Risk Screening</h1>
            <p>
              Enter your Clinical ID to start a secure local review session for patient risk prediction,
              explanation, and feedback.
            </p>
          </div>
          <form className="login-form" onSubmit={enterSession}>
            <label>
              Clinical ID
              <input
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                placeholder="e.g. CLN-001"
                autoFocus
              />
            </label>
            <button type="submit">Enter</button>
          </form>
        </section>
      </div>
    );
  }

  const navItems = [
    { id: "case", label: "Patient Details", meta: "Enter case data", disabled: false },
    { id: "risk", label: "Risk Summary", meta: hasPrediction ? predictRisk : "Awaiting prediction", disabled: !hasPrediction },
    { id: "explanation", label: "Clinical Explanation", meta: hasExplanation ? "Ready for review" : "After prediction", disabled: !hasPrediction },
    { id: "feedback", label: "Clinician Feedback", meta: activeCaseId || "After prediction", disabled: !hasPrediction }
  ];

  return (
    <div className="app-shell">
      <AlertModal
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        onClose={closeAlert}
      />

      <aside className="app-sidebar">
        <div className="brand-block">
          <h1>Interactive XAI</h1>
          <p>Clinical risk screening support</p>
        </div>
        <nav className="app-nav" aria-label="Clinical workflow">
          {navItems.map((item, idx) => (
            <button
              key={item.id}
              className={activeView === item.id ? "nav-item active" : "nav-item"}
              onClick={() => goToView(item.id)}
              disabled={item.disabled}
            >
              <span className="nav-index">{idx + 1}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.meta}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span>Clinical ID</span>
          <strong>{userId}</strong>
          <span>Active case</span>
          <strong>{activeCaseId || "Not started"}</strong>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div>
            <p className="eyebrow">Interactive Explainable AI</p>
            <h2>
              {navItems.find((item) => item.id === activeView)?.label || "Patient Details"}
            </h2>
          </div>
          <div className="topbar-actions">
            <div className="session-banner" role="status">
              <span>Welcome, {userId}</span>
              <strong>Active session from Clinical ID</strong>
            </div>
            <button className="button-ghost" onClick={refreshAll} disabled={loading}>
              Refresh Profile
            </button>
            <button className="button-ghost" onClick={endSession} disabled={loading}>
              End Session
            </button>
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Clinical workflow shortcuts">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activeView === item.id ? "mobile-nav-item active" : "mobile-nav-item"}
              onClick={() => goToView(item.id)}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {activeView === "case" && (
          <main className="app-page">
            <section className="page-panel">
              <div className="page-header">
                <div>
                  <p className="step-label">Step 1</p>
                  <h2>Case Details / Patient Details</h2>
                  <p className="muted">Enter the available screening fields, then run the risk estimate.</p>
                </div>
                <div className="actions">
                  <button onClick={runPredict} disabled={loading}>
                    Predict Risk
                  </button>
                  <button className="button-ghost" onClick={resetPatient} disabled={loading}>
                    Clear Case
                  </button>
                </div>
              </div>

              <div className="patient-form-grid">
                {FIELD_ORDER.map((field) => {
                  const meta = FIELD_META[field];
                  return (
                    <label key={field}>
                      <span className="label-title">{meta.label}</span>
                      <span className="label-meta">
                        {meta.unit}
                        {meta.optional ? " | optional" : ""}
                      </span>
                      <input
                        type="number"
                        step={meta.step || "any"}
                        min={meta.min}
                        max={meta.max}
                        value={patient[field]}
                        onChange={(e) => updateField(field, e.target.value)}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          </main>
        )}

        {activeView === "risk" && (
          <main className="app-page">
            <section className={`risk-page tone-${tone}`}>
              <div className="risk-ring large" aria-hidden="true" style={{ "--ring-pct": `${ringPct}%` }}>
                <div className="risk-ring-inner">{latestRisk}</div>
              </div>
              <div className="risk-content">
                <p className="step-label">Step 2</p>
                <h2>Risk Summary</h2>
                <p>{loading ? busyLabel || "Processing..." : notice || "Run prediction from Patient Details."}</p>
                <div className="summary-metrics">
                  <span>
                    Prediction <strong>{predictRisk}</strong>
                  </span>
                  <span>
                    Status{" "}
                    <strong>{typeof latestFlagged === "boolean" ? (latestFlagged ? "Flagged" : "Not Flagged") : "-"}</strong>
                  </span>
                  <span>
                    Threshold{" "}
                    <strong>{typeof latestThresholdValue === "number" ? latestThresholdValue.toFixed(4) : "-"}</strong>
                  </span>
                </div>
                <p className="muted">Case ID: {latestCaseId || "-"}</p>
                <p className="muted">Model Version: {latestModelVersion || "-"}</p>
                {error && <p className="error">{error}</p>}
                <div className="actions">
                  <button onClick={() => goToView("explanation")} disabled={!hasPrediction}>
                    Review Clinical Explanation
                  </button>
                  <button className="button-ghost" onClick={() => goToView("feedback")} disabled={!hasPrediction}>
                    Add Clinician Feedback
                  </button>
                </div>
              </div>
            </section>
          </main>
        )}

        {activeView === "explanation" && (
          <main className="app-page">
            <section className="page-panel">
              <div className="page-header">
                <div>
                  <p className="step-label">Step 3</p>
                  <h2>Clinical Explanation</h2>
                  <p className="muted">Inspect model drivers only when the risk estimate needs clinical review.</p>
                </div>
                <div className="actions">
                  <button onClick={runExplain} disabled={loading || !hasPrediction}>
                    Refresh Explanation
                  </button>
                  <button className="button-ghost" onClick={() => goToView("feedback")} disabled={!hasPrediction}>
                    Continue to Feedback
                  </button>
                </div>
              </div>

              {!hasPrediction ? (
                <div className="empty-state">
                  <h3>No prediction yet</h3>
                  <p>Start from Patient Details and run a risk estimate before reviewing explanations.</p>
                  <button onClick={() => goToView("case")}>Go to Patient Details</button>
                </div>
              ) : (
                <>
                  <div className="result-grid">
                    <div className="result-card">
                      <h3>Explanation Snapshot</h3>
                      <p>
                        Risk: <strong>{explainRisk}</strong>
                      </p>
                      <p>
                        Status: <strong>{explainOut ? (explainOut.flagged ? "Flagged" : "Not Flagged") : "-"}</strong>
                      </p>
                      <p>
                        Case: <strong>{explainOut?.case_id || activeCaseId || "-"}</strong>
                      </p>
                      <p>
                        Clinician-disputed factors:{" "}
                        <strong>
                          {explainOut?.disputed_features?.length
                            ? explainOut.disputed_features.map(resolveFeatureLabel).join(", ")
                            : "-"}
                        </strong>
                      </p>
                    </div>
                    <div className="result-card">
                      <h3>Clarifications</h3>
                      {explainOut?.meta?.clarifications?.length ? (
                        <ul className="clarify-list">
                          {explainOut.meta.clarifications.map((c) => (
                            <li key={c.feature}>
                              <strong>{resolveFeatureLabel(c.feature)}</strong>
                              <span>
                                {c.desc} ({c.unit})
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No clarification items.</p>
                      )}
                    </div>
                  </div>

                  <div className="evidence-stack">
                    <FeatureTable
                      title="Factors Increasing Estimated Risk"
                      items={explainOut?.top_positive || []}
                      resolveFeatureLabel={resolveFeatureLabel}
                      getClinicalPrompt={getClinicalPrompt}
                    />
                    <FeatureTable
                      title="Factors Reducing Estimated Risk"
                      items={explainOut?.top_negative || []}
                      resolveFeatureLabel={resolveFeatureLabel}
                      getClinicalPrompt={getClinicalPrompt}
                    />
                    <FeatureTable
                      title="Clinician-Disputed Factors"
                      items={explainOut?.hidden_contributors || []}
                      resolveFeatureLabel={resolveFeatureLabel}
                      getClinicalPrompt={getClinicalPrompt}
                    />
                  </div>

                  <p className="disclaimer">
                    {explainOut?.meta?.disclaimer ||
                      "This tool is for screening support only and does not provide a medical diagnosis. Consult a qualified clinician for decisions."}
                  </p>

                  <button className="button-ghost" onClick={() => setShowRawJson((v) => !v)}>
                    {showRawJson ? "Hide Technical JSON" : "Show Technical JSON"}
                  </button>
                  {showRawJson && (
                    <div className="result-grid">
                      <div className="result-card">
                        <h3>Predict JSON</h3>
                        <pre>{JSON.stringify(predictOut, null, 2)}</pre>
                      </div>
                      <div className="result-card">
                        <h3>Explain JSON</h3>
                        <pre>{JSON.stringify(explainOut, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </main>
        )}

        {activeView === "feedback" && (
          <main className="app-page">
            <section className="page-panel">
              <div className="page-header">
                <div>
                  <p className="step-label">Step 4</p>
                  <h2>Clinician Feedback</h2>
                  <p className="muted">Record whether the risk estimate and explanation made clinical sense.</p>
                </div>
                <p className="case-pill">Active Case: {activeCaseId || "-"}</p>
              </div>

              {!hasPrediction ? (
                <div className="empty-state">
                  <h3>No active case</h3>
                  <p>Run a prediction before saving clinician feedback.</p>
                  <button onClick={() => goToView("case")}>Go to Patient Details</button>
                </div>
              ) : (
                <>
                  <div className="quick-feedback">
                    <button
                      className="button-ghost"
                      onClick={() => chooseFeedback("relevant", "This selected factor supports the prediction.")}
                    >
                      This prediction seems reasonable
                    </button>
                    <button
                      className="button-ghost"
                      onClick={() => chooseFeedback("irrelevant", "I disagree with this factor for this case.")}
                    >
                      I disagree with this prediction
                    </button>
                    <button
                      className="button-ghost"
                      onClick={() => chooseFeedback("irrelevant", "This factor is not clinically relevant here.")}
                    >
                      This factor is not clinically relevant here
                    </button>
                    <button
                      className="button-ghost"
                      onClick={() => chooseFeedback("confusing", "This explanation is confusing.")}
                    >
                      This explanation is confusing
                    </button>
                  </div>

                  <div className="grid-3">
                    <label>
                      Feedback choice
                      <select value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>
                        {Object.entries(FEEDBACK_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Related factor
                      <select
                        value={feedbackNeedsFeature ? feedbackFeature : ""}
                        onChange={(e) => setFeedbackFeature(e.target.value)}
                        disabled={!feedbackNeedsFeature}
                      >
                        <option value="">Select factor</option>
                        {FIELD_ORDER.map((field) => (
                          <option key={field} value={field}>
                            {FIELD_META[field].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Clinical note
                      <input value={feedbackMessage} onChange={(e) => setFeedbackMessage(e.target.value)} />
                    </label>
                  </div>

                  <div className="actions">
                    <button onClick={saveFeedback} disabled={loading}>
                      Save Clinician Feedback
                    </button>
                    <button className="button-ghost" onClick={() => goToView("explanation")}>
                      Review Explanation Again
                    </button>
                  </div>

                  <div className="result-grid">
                    <div className="result-card">
                      <h3>Feedback Summary</h3>
                      {!hasSession ? (
                        <p className="muted">Enter an ID and refresh the explanation profile.</p>
                      ) : analyticsOut?.summary?.length ? (
                        <ul className="summary-list">
                          {analyticsOut.summary.map((s) => (
                            <li key={s.feedback_type}>
                              <span>{FEEDBACK_LABELS[s.feedback_type] || s.feedback_type}</span>
                              <strong>{s.count}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No feedback has been recorded yet.</p>
                      )}
                    </div>
                    <div className="result-card">
                      <h3>Factors Clinicians Marked as Minimal Influence</h3>
                      {topFeaturesOut.length ? (
                        <ul className="summary-list">
                          {topFeaturesOut.map((f) => (
                            <li key={f.feature}>
                              <span>{resolveFeatureLabel(f.feature)}</span>
                              <strong>{f.count}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No factor-level feedback yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="preference-panel">
                    <h3>Explanation Preference</h3>
                    <div className="grid-2">
                      <label>
                        Number of factors to show
                        <input
                          type="number"
                          value={prefsOut?.top_k ?? 8}
                          onChange={(e) =>
                            setPrefsOut((prev) => ({ ...(prev || {}), top_k: Number(e.target.value) }))
                          }
                        />
                      </label>
                      <label>
                        Explanation detail
                        <select
                          value={prefsOut?.style ?? "simple"}
                          onChange={(e) =>
                            setPrefsOut((prev) => ({ ...(prev || {}), style: e.target.value }))
                          }
                        >
                          <option value="simple">Brief</option>
                          <option value="detailed">Detailed</option>
                        </select>
                      </label>
                    </div>
                    <button onClick={savePreferences} disabled={loading || !hasSession}>
                      Save Explanation Preference
                    </button>
                  </div>
                </>
              )}
            </section>
          </main>
        )}
      </div>
    </div>
  );
}
