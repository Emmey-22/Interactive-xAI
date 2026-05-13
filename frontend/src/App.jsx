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

const FIELD_GROUPS = [
  {
    title: "Demographics",
    description: "Basic profile values used by the screening model.",
    fields: ["male", "age", "education"]
  },
  {
    title: "Lifestyle",
    description: "Smoking status and daily exposure indicators.",
    fields: ["currentSmoker", "cigsPerDay"]
  },
  {
    title: "Clinical History",
    description: "Known cardiovascular and metabolic history.",
    fields: ["BPMeds", "prevalentStroke", "prevalentHyp", "diabetes"]
  },
  {
    title: "Vitals and Labs",
    description: "Current readings and lab values for risk estimation.",
    fields: ["totChol", "sysBP", "diaBP", "BMI", "heartRate", "glucose"]
  }
];

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

function StatusBadge({ tone = "neutral", children }) {
  return <span className={`status-badge tone-${tone}`}>{children}</span>;
}

function StatTile({ label, value, tone = "neutral" }) {
  return (
    <div className={`stat-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PatientField({ field, value, onChange }) {
  const meta = FIELD_META[field];
  return (
    <label className="field-control">
      <span className="field-label-row">
        <span className="label-title">{meta.label}</span>
        {meta.optional && <span className="optional-pill">Optional</span>}
      </span>
      <span className="label-meta">{meta.unit}</span>
      <input
        type="number"
        step={meta.step || "any"}
        min={meta.min}
        max={meta.max}
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
      />
    </label>
  );
}

function FeatureTable({ title, subtitle, items, tone = "neutral", resolveFeatureLabel, getClinicalPrompt }) {
  return (
    <section className={`data-panel evidence-panel tone-${tone}`}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <StatusBadge tone={tone}>{items?.length || 0} factors</StatusBadge>
      </div>
      {!items || items.length === 0 ? (
        <p className="muted empty-copy">No items available.</p>
      ) : (
        <div className="table-scroll">
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
                    <strong>{resolveFeatureLabel ? resolveFeatureLabel(item.feature) : item.feature}</strong>
                    {item.disputed && <span className="inline-flag">Disputed</span>}
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
        </div>
      )}
    </section>
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
  const [activeView, setActiveView] = useState(viewFromHash);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
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
    setHeaderMenuOpen(false);
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
      goToView("risk");
      setNotice(`Prediction completed for case ${caseId}. Review the risk summary before opening the explanation.`);

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
    setHeaderMenuOpen(false);
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
            <h1>Interactive xAI System for Healthcare Risk Prediction</h1>
            <p>
              Review patient risk predictions, inspect model explanations, and integrate clinician
              feedback into the explanation workflow.
            </p>
          </div>
          <form className="login-form" onSubmit={enterSession}>
            <label className="field-control">
              <span className="label-title">Enter clinical ID</span>
              <input
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                placeholder="e.g. CLN-001"
                autoFocus
              />
            </label>
            <button type="submit">Login</button>
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
  const statusLabel = typeof latestFlagged === "boolean" ? (latestFlagged ? "Flagged" : "Not Flagged") : "-";

  return (
    <div className="app-shell">
      <AlertModal
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        onClose={closeAlert}
      />

      <header className="app-topbar">
        <div className="topbar-title">
          <h1>Interactive xAI System for Healthcare Risk Prediction</h1>
          <p>Welcome, {userId}.</p>
        </div>
        <div className="topbar-actions">
          <button className="button-ghost topbar-direct-action" onClick={refreshAll} disabled={loading}>
            Refresh Profile
          </button>
          <button className="button-ghost danger-subtle topbar-direct-action" onClick={endSession} disabled={loading}>
            End Session
          </button>
          <div className="topbar-menu-wrap">
            <button
              className="topbar-menu-button"
              type="button"
              aria-label="Open session actions"
              aria-haspopup="menu"
              aria-expanded={headerMenuOpen}
              onClick={() => setHeaderMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">...</span>
            </button>
            {headerMenuOpen && (
              <div className="topbar-menu" role="menu">
                <button type="button" role="menuitem" onClick={refreshAll} disabled={loading}>
                  <span className="menu-icon" aria-hidden="true">↻</span>
                  Refresh Profile
                </button>
                <button type="button" role="menuitem" onClick={endSession} disabled={loading}>
                  <span className="menu-icon" aria-hidden="true">↪</span>
                  End Session
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <aside className="app-sidebar">
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
            <section className="page-intro">
              <div>
                <p className="step-label">Step 1</p>
                <h2>Patient screening details</h2>
                <p className="muted">Enter the available fields, grouped by clinical context, then run the risk estimate.</p>
              </div>
              <div className="actions">
                <button onClick={runPredict} disabled={loading}>
                  {loading ? busyLabel || "Processing..." : "Predict Risk"}
                </button>
                <button className="button-ghost" onClick={resetPatient} disabled={loading}>
                  Clear Case
                </button>
              </div>
            </section>

            {notice && !notice.startsWith("Welcome,") && <p className="notice">{notice}</p>}
            {error && <p className="error">{error}</p>}

            <section className="form-section-grid">
              {FIELD_GROUPS.map((group) => (
                <div className="data-panel field-group-panel" key={group.title}>
                  <div className="panel-heading">
                    <div>
                      <h3>{group.title}</h3>
                      <p>{group.description}</p>
                    </div>
                  </div>
                  <div className="patient-form-grid">
                    {group.fields.map((field) => (
                      <PatientField key={field} field={field} value={patient[field]} onChange={updateField} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </main>
        )}

        {activeView === "risk" && (
          <main className="app-page">
            <section className={`risk-page tone-${tone}`}>
              <div className="risk-score-panel">
                <div className="risk-ring large" aria-hidden="true" style={{ "--ring-pct": `${ringPct}%` }}>
                  <div className="risk-ring-inner">{latestRisk}</div>
                </div>
                <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
              </div>
              <div className="risk-content">
                <p className="step-label">Step 2</p>
                <h2>Risk Summary</h2>
                <p>{loading ? busyLabel || "Processing..." : notice || "Run prediction from Patient Details."}</p>
                <div className="metric-grid">
                  <StatTile label="Prediction" value={predictRisk} tone={tone} />
                  <StatTile label="Threshold" value={typeof latestThresholdValue === "number" ? latestThresholdValue.toFixed(4) : "-"} />
                  <StatTile label="Case ID" value={latestCaseId || "-"} />
                  <StatTile label="Model Version" value={latestModelVersion || "-"} />
                </div>
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
            <section className="page-intro">
              <div>
                <p className="step-label">Step 3</p>
                <h2>Clinical explanation</h2>
                <p className="muted">Review the model drivers, disputed factors, and clinical prompts behind the estimate.</p>
              </div>
              <div className="actions">
                <button onClick={runExplain} disabled={loading || !hasPrediction}>
                  {loading ? busyLabel || "Processing..." : "Refresh Explanation"}
                </button>
                <button className="button-ghost" onClick={() => goToView("feedback")} disabled={!hasPrediction}>
                  Continue to Feedback
                </button>
              </div>
            </section>

            {!hasPrediction ? (
              <div className="empty-state">
                <h3>No prediction yet</h3>
                <p>Start from Patient Details and run a risk estimate before reviewing explanations.</p>
                <button onClick={() => goToView("case")}>Go to Patient Details</button>
              </div>
            ) : (
              <>
                <section className="summary-strip">
                  <StatTile label="Explained Risk" value={explainRisk} tone={tone} />
                  <StatTile label="Status" value={explainOut ? (explainOut.flagged ? "Flagged" : "Not Flagged") : "-"} tone={tone} />
                  <StatTile label="Case" value={explainOut?.case_id || activeCaseId || "-"} />
                  <StatTile
                    label="Disputed Factors"
                    value={explainOut?.disputed_features?.length ? explainOut.disputed_features.length : "0"}
                  />
                </section>

                <section className="data-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Clarifications</h3>
                      <p>Field definitions returned with the explanation response.</p>
                    </div>
                  </div>
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
                    <p className="muted empty-copy">No clarification items.</p>
                  )}
                </section>

                <div className="evidence-stack">
                  <FeatureTable
                    title="Factors Increasing Estimated Risk"
                    subtitle="Positive SHAP contributors for this case."
                    tone="high"
                    items={explainOut?.top_positive || []}
                    resolveFeatureLabel={resolveFeatureLabel}
                    getClinicalPrompt={getClinicalPrompt}
                  />
                  <FeatureTable
                    title="Factors Reducing Estimated Risk"
                    subtitle="Negative SHAP contributors for this case."
                    tone="low"
                    items={explainOut?.top_negative || []}
                    resolveFeatureLabel={resolveFeatureLabel}
                    getClinicalPrompt={getClinicalPrompt}
                  />
                  <FeatureTable
                    title="Clinician-Disputed Factors"
                    subtitle="Factors retained for transparency after feedback."
                    tone="medium"
                    items={explainOut?.hidden_contributors || []}
                    resolveFeatureLabel={resolveFeatureLabel}
                    getClinicalPrompt={getClinicalPrompt}
                  />
                </div>

                <p className="disclaimer">
                  {explainOut?.meta?.disclaimer ||
                    "This tool is for screening support only and does not provide a medical diagnosis. Consult a qualified clinician for decisions."}
                </p>

                <button className="button-ghost technical-toggle" onClick={() => setShowRawJson((v) => !v)}>
                  {showRawJson ? "Hide Technical JSON" : "Show Technical JSON"}
                </button>
                {showRawJson && (
                  <div className="technical-grid">
                    <div className="data-panel">
                      <h3>Predict JSON</h3>
                      <pre>{JSON.stringify(predictOut, null, 2)}</pre>
                    </div>
                    <div className="data-panel">
                      <h3>Explain JSON</h3>
                      <pre>{JSON.stringify(explainOut, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
        )}

        {activeView === "feedback" && (
          <main className="app-page">
            <section className="page-intro">
              <div>
                <p className="step-label">Step 4</p>
                <h2>Clinician feedback</h2>
                <p className="muted">Record whether the risk estimate and explanation made clinical sense.</p>
              </div>
              <p className="case-pill">Active Case: {activeCaseId || "-"}</p>
            </section>

            {!hasPrediction ? (
              <div className="empty-state">
                <h3>No active case</h3>
                <p>Run a prediction before saving clinician feedback.</p>
                <button onClick={() => goToView("case")}>Go to Patient Details</button>
              </div>
            ) : (
              <>
                <section className="data-panel feedback-composer">
                  <div className="panel-heading">
                    <div>
                      <h3>Case review input</h3>
                      <p>Choose a quick response, then refine the related factor and note.</p>
                    </div>
                  </div>
                  <div className="quick-feedback">
                    <button
                      className={feedbackType === "relevant" ? "quick-choice active" : "quick-choice"}
                      onClick={() => chooseFeedback("relevant", "This selected factor supports the prediction.")}
                    >
                      <strong>Reasonable</strong>
                      <span>This selected factor supports the prediction.</span>
                    </button>
                    <button
                      className={feedbackType === "irrelevant" ? "quick-choice active" : "quick-choice"}
                      onClick={() => chooseFeedback("irrelevant", "I disagree with this factor for this case.")}
                    >
                      <strong>Disagree</strong>
                      <span>I disagree with this factor for this case.</span>
                    </button>
                    <button
                      className={feedbackType === "confusing" ? "quick-choice active" : "quick-choice"}
                      onClick={() => chooseFeedback("confusing", "This explanation is confusing.")}
                    >
                      <strong>Confusing</strong>
                      <span>This explanation is confusing.</span>
                    </button>
                  </div>

                  <div className="grid-3">
                    <label className="field-control">
                      <span className="label-title">Feedback choice</span>
                      <select value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>
                        {Object.entries(FEEDBACK_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-control">
                      <span className="label-title">Related factor</span>
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
                    <label className="field-control">
                      <span className="label-title">Clinical note</span>
                      <input value={feedbackMessage} onChange={(e) => setFeedbackMessage(e.target.value)} />
                    </label>
                  </div>

                  <div className="actions">
                    <button onClick={saveFeedback} disabled={loading}>
                      {loading ? busyLabel || "Saving..." : "Save Clinician Feedback"}
                    </button>
                    <button className="button-ghost" onClick={() => goToView("explanation")}>
                      Review Explanation Again
                    </button>
                  </div>
                  {notice && <p className="notice">{notice}</p>}
                  {error && <p className="error">{error}</p>}
                </section>

                <section className="insight-grid">
                  <div className="data-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Feedback Summary</h3>
                        <p>Saved responses for this clinical profile.</p>
                      </div>
                    </div>
                    {analyticsOut?.summary?.length ? (
                      <ul className="summary-list">
                        {analyticsOut.summary.map((s) => (
                          <li key={s.feedback_type}>
                            <span>{FEEDBACK_LABELS[s.feedback_type] || s.feedback_type}</span>
                            <strong>{s.count}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted empty-copy">No feedback has been recorded yet.</p>
                    )}
                  </div>
                  <div className="data-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Minimal Influence Factors</h3>
                        <p>Factors clinicians marked as less relevant.</p>
                      </div>
                    </div>
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
                      <p className="muted empty-copy">No factor-level feedback yet.</p>
                    )}
                  </div>
                </section>

                <section className="data-panel preference-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Explanation Preference</h3>
                      <p>Adjust the future explanation length for this Clinical ID.</p>
                    </div>
                  </div>
                  <div className="grid-2">
                    <label className="field-control">
                      <span className="label-title">Number of factors to show</span>
                      <input
                        type="number"
                        value={prefsOut?.top_k ?? 8}
                        onChange={(e) =>
                          setPrefsOut((prev) => ({ ...(prev || {}), top_k: Number(e.target.value) }))
                        }
                      />
                    </label>
                    <label className="field-control">
                      <span className="label-title">Explanation detail</span>
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
                </section>
              </>
            )}
          </main>
        )}
      </div>
    </div>
  );
}
