/**
 * Registration.jsx — telling the platform who you are.
 *
 * Two roles, not three. The college never registers here: the platform belongs
 * to the college, and an internal tool doesn't ask its owner to sign up for
 * it. The placement cell's login is created by the platform administrator.
 *
 * Neither path can dead-end. A student whose roll number isn't on the roster
 * yet is queued rather than refused, and can go and browse in the meantime.
 */

import React, { useState, useEffect } from "react";
import { GraduationCap, Building2, AlertCircle, ArrowRight, Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";

const ROLES = [
  {
    value: "Student",
    label: "Student",
    icon: GraduationCap,
    blurb: "You study here and want to apply to companies visiting campus.",
  },
  {
    value: "Company",
    label: "Company",
    icon: Building2,
    blurb: "You recruit from this campus.",
  },
];

const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

function cinError(value) {
  const v = value.trim().toUpperCase();
  if (!v) return "";
  return CIN_RE.test(v) ? "" : "Expected a CIN like L12345MH2020PLC123456 (21 characters).";
}

function websiteError(value) {
  const v = value.trim();
  if (!v) return "";
  try {
    const url = new URL(v);
    if (!["http:", "https:"].includes(url.protocol)) return "Must start with http:// or https://";
    if (!url.hostname.includes(".")) return "That doesn't look like a real domain.";
    return "";
  } catch {
    return "Enter a full URL, e.g. https://example.com";
  }
}

export default function Registration() {
  const { registerActor, claimRollNumber } = useAuth();
  const [role, setRole] = useState(null);

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 680, marginTop: 60 }}>
      <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
        <span className="badge badge-student">Step 2 of 2</span>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          Tell us who you are on this campus
        </span>
      </div>
      <h2 style={{ marginBottom: 4 }}>Choose your role</h2>
      <p style={{ marginBottom: 28, fontSize: "0.85rem", color: "var(--text-muted)" }}>
        You can look around before this is finished — nothing here locks you out.
      </p>

      <div className="flex flex-col gap-12" style={{ marginBottom: 32 }} role="radiogroup" aria-label="Choose your role">
        {ROLES.map(({ value, label, icon: Icon, blurb }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={role === value}
            className="glass-card"
            onClick={() => setRole(value)}
            style={{
              padding: "16px 20px",
              textAlign: "left",
              cursor: "pointer",
              border: role === value ? "1px solid var(--accent-primary)" : undefined,
            }}
          >
            <div className="flex items-center gap-12">
              <Icon size={22} style={{ flexShrink: 0, color: "var(--accent-primary)" }} />
              <div>
                <strong className="item-title">{label}</strong>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{blurb}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {role === "Student" && <StudentForm onClaim={claimRollNumber} />}
      {role === "Company" && <CompanyForm onRegister={registerActor} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StudentForm({ onClaim }) {
  const [colleges, setColleges] = useState([]);
  const [collegeAddress, setCollegeAddress] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    api.get("/public/colleges").then((d) => {
      setColleges(d.colleges);
      if (d.colleges.length === 1) setCollegeAddress(d.colleges[0].address);
    }).catch(() => {});
    api.get("/me/profile-fields").then((d) => setFields(d.fields)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    // Checks the in-flight flag directly — a fast double-submit can beat a
    // re-render of the disabled attribute.
    if (loading || !collegeAddress || !rollNumber.trim()) return;

    setLoading(true);
    setError("");
    try {
      const result = await onClaim({ collegeAddress, rollNumber: rollNumber.trim(), ...values });
      if (result.queued) setQueued(true);
    } catch (err) {
      setError(err.message || "Could not submit your roll number.");
    } finally {
      setLoading(false);
    }
  };

  if (queued) {
    return (
      <div className="glass-card p-24 animate-fade-in-up">
        <div className="flex items-center gap-12" style={{ marginBottom: 12 }}>
          <Clock size={22} style={{ color: "var(--accent-warning)", flexShrink: 0 }} />
          <h3 className="card-title">Sent to your placement cell</h3>
        </div>
        <p style={{ fontSize: "0.88rem", marginBottom: 12 }}>
          Your roll number wasn't on the roster yet, so we've passed it to the placement
          cell to confirm. You'll be able to apply to drives as soon as they do.
        </p>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
          In the meantime you can browse every opening, package and cutoff — you just
          can't apply until you're confirmed.
        </p>
      </div>
    );
  }

  if (colleges.length === 0) {
    return (
      <div className="glass-card p-24">
        <div className="alert alert-warning" role="status">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            No college has been set up on this platform yet. The administrator creates it
            before students can be verified.
          </span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16 animate-fade-in-up">
      <div className="form-group">
        <label htmlFor="reg-college">Your college</label>
        <select id="reg-college" value={collegeAddress} onChange={(e) => setCollegeAddress(e.target.value)} required>
          <option value="">Select…</option>
          {colleges.map((c) => <option key={c.address} value={c.address}>{c.name}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="reg-roll">Roll number</label>
        <input
          id="reg-roll"
          value={rollNumber}
          onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
          placeholder="e.g. 21CE1042"
          required
        />
        <p className="form-hint">
          If your placement cell has already uploaded the roster, you're confirmed
          straight away. If not, we'll pass this to them — either way you can carry on
          looking around.
        </p>
      </div>

      {fields.map((f) => (
        <div className="form-group" key={f.key}>
          <label htmlFor={`reg-${f.key}`}>
            {f.label}{" "}
            {!f.required && <span className="label-optional">(optional)</span>}
          </label>
          <input
            id={`reg-${f.key}`}
            type={f.type === "text" ? "text" : "number"}
            step={f.type === "decimal2" ? "0.01" : undefined}
            min={f.min ?? undefined}
            max={f.max ?? undefined}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
          {f.help && <p className="form-hint">{f.help}</p>}
        </div>
      ))}

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading ? <span className="spinner" /> : <>Continue <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function CompanyForm({ onRegister }) {
  const [name, setName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [website, setWebsite] = useState("");
  const [touched, setTouched] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cinMsg = cinError(registrationNumber);
  const webMsg = websiteError(website);

  const submit = async (e) => {
    e.preventDefault();
    if (loading || !name.trim()) return;
    if (cinMsg) return setTouched((t) => ({ ...t, cin: true }));
    if (webMsg) return setTouched((t) => ({ ...t, web: true }));

    setLoading(true);
    setError("");
    try {
      await onRegister({
        role: "Company",
        name: name.trim(),
        registrationNumber: registrationNumber.trim(),
        website: website.trim(),
      });
    } catch (err) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16 animate-fade-in-up">
      <div className="form-group">
        <label htmlFor="reg-name">Company name</label>
        <input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div className="form-group">
        <label htmlFor="reg-cin">CIN</label>
        <input
          id="reg-cin"
          value={registrationNumber}
          onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
          onBlur={() => setTouched((t) => ({ ...t, cin: true }))}
          placeholder="L12345MH2020PLC123456"
          required
        />
        <p style={{ fontSize: "0.75rem", marginTop: 4, color: touched.cin && cinMsg ? "var(--accent-danger)" : "var(--text-muted)" }}>
          {touched.cin && cinMsg ? cinMsg : "Published publicly so anyone can look it up independently."}
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="reg-web">
          Website <span className="label-optional">(optional)</span>
        </label>
        <input
          id="reg-web"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, web: true }))}
          placeholder="https://example.com"
        />
        {touched.web && webMsg && (
          <p style={{ fontSize: "0.75rem", color: "var(--accent-danger)", marginTop: 4 }}>{webMsg}</p>
        )}
      </div>

      <div className="alert alert-info" role="status">
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          The college confirms you were invited before students can see your openings.
          It never edits what you post — your terms and your hiring decisions stay yours.
        </span>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
        {loading ? <span className="spinner" /> : <>Register <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}
