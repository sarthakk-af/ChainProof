/**
 * Registration.jsx — Role selection and registration portal
 * Shown to a signed-in account that hasn't registered on-chain yet.
 */

import React, { useState, useEffect } from "react";
import { GraduationCap, Landmark, Briefcase, AlertTriangle, AlertCircle, Link2, Check } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";

// Mirrors backend/src/websiteCheck.js's validateWebsiteFormat — client-side
// is just UX, the server re-checks the exact same shape regardless.
function websiteFormatError(website) {
  if (!website.trim()) return "";
  let url;
  try {
    url = new URL(website.trim());
  } catch {
    return "Enter a full URL, e.g. https://example.edu";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Website must start with http:// or https://";
  }
  if (!url.hostname.includes(".")) {
    return "Enter a full URL, e.g. https://example.edu";
  }
  return "";
}

// Mirrors backend/src/registrationNumber.js — client-side is UX only, the
// server re-checks the exact same rule regardless of what this says.
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
function registrationNumberError(role, value) {
  const v = value.trim().toUpperCase();
  if (role === "Company") {
    if (!v) return "CIN is required for companies.";
    if (!CIN_RE.test(v)) return "Expected a CIN like L12345MH2020PLC123456 (21 characters).";
    return "";
  }
  if (role === "College") {
    if (!v) return "An institution registration/accreditation ID is required.";
    if (v.length < 4 || v.length > 50) return "Must be between 4 and 50 characters.";
    if (!/^[A-Z0-9/\-. ]+$/.test(v)) return "Only letters, numbers, spaces, and /.- are allowed.";
    return "";
  }
  return "";
}

const ROLES = [
  {
    value: "Student",
    label: "Student",
    Icon: GraduationCap,
    desc: "Register as a student to receive verifiable placement credentials on-chain.",
    color: "var(--accent-primary)",
    badgeClass: "badge-student",
  },
  {
    value: "College",
    label: "College / Placement Cell",
    Icon: Landmark,
    desc: "Register as a college to issue credentials, manage placement records, and view tamper-proof metrics. An administrator reviews and approves new colleges before they can act — usually a short wait.",
    color: "var(--accent-secondary)",
    badgeClass: "badge-college",
  },
  {
    value: "Company",
    label: "Company / Recruiter",
    Icon: Briefcase,
    desc: "Register as a company to browse students and progress candidates through the hiring pipeline. An administrator reviews and approves new companies before they can act — usually a short wait.",
    color: "var(--accent-company)",
    badgeClass: "badge-company",
  },
];

export default function Registration() {
  const { user, registerActor } = useAuth();

  const [selectedRole, setSelectedRole] = useState(null);
  const [name, setName]                 = useState("");
  const [website, setWebsite]           = useState("");
  const [websiteTouched, setWebsiteTouched] = useState(false);
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [regNumTouched, setRegNumTouched] = useState(false);
  const [collegeAddress, setCollegeAddress] = useState("");
  const [joinCode, setJoinCode]         = useState("");
  const [colleges, setColleges]         = useState([]);
  const [collegesLoading, setCollegesLoading] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");

  // Load the Active-college list once the Student card is selected.
  useEffect(() => {
    if (selectedRole !== "Student") return;
    setCollegesLoading(true);
    api
      .get("/colleges")
      .then((data) => setColleges(data.colleges))
      .catch(() => setColleges([]))
      .finally(() => setCollegesLoading(false));
  }, [selectedRole]);

  const websiteError = websiteFormatError(website);
  const regNumError = selectedRole ? registrationNumberError(selectedRole, registrationNumber) : "";

  const handleRegister = async (e) => {
    e.preventDefault();
    // See IssueCredentialForm.jsx's handleIssue for why this checks the
    // in-flight state directly rather than trusting the button's disabled attribute.
    if (loading) return;
    if (!selectedRole || !name.trim()) return;
    if (selectedRole === "Student" && (!collegeAddress || !joinCode.trim())) return;
    if (websiteError) {
      setWebsiteTouched(true);
      return;
    }
    if ((selectedRole === "College" || selectedRole === "Company") && regNumError) {
      setRegNumTouched(true);
      return;
    }

    setLoading(true);
    setError("");

    try {
      await registerActor({
        role: selectedRole,
        name: name.trim(),
        collegeAddress: selectedRole === "Student" ? collegeAddress : undefined,
        joinCode: selectedRole === "Student" ? joinCode.trim() : undefined,
        website: selectedRole !== "Student" ? website.trim() : undefined,
        registrationNumber: selectedRole !== "Student" ? registrationNumber.trim() : undefined,
      });
    } catch (err) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 680, marginTop: 60 }}>
      <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
        <span className="badge badge-student">Step 2 of 2</span>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Almost done — just your role and name</span>
      </div>
      <h2 style={{ marginBottom: 8 }}>Choose Your Role</h2>
      <p style={{ marginBottom: 36 }}>
        Your role is recorded permanently on-chain.
        Signed in as <strong>{user?.email}</strong>.
      </p>

      {/* Role cards */}
      <div className="flex flex-col gap-12" style={{ marginBottom: 32 }} role="radiogroup" aria-label="Choose your role">
        {ROLES.map((r) => (
          <div
            key={r.value}
            id={`role-card-${r.label.split(" ")[0].toLowerCase()}`}
            className="glass-card"
            role="radio"
            aria-checked={selectedRole === r.value}
            tabIndex={0}
            onClick={() => setSelectedRole(r.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelectedRole(r.value);
              }
            }}
            style={{
              padding: "20px 24px",
              cursor: "pointer",
              border: selectedRole === r.value
                ? `1px solid ${r.color}`
                : "1px solid var(--border-card)",
              boxShadow: selectedRole === r.value
                ? `0 0 20px ${r.color}33`
                : undefined,
              transition: "var(--transition)",
            }}
          >
            <div className="flex items-center gap-16">
              <r.Icon size={32} style={{ color: r.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="flex items-center gap-8" style={{ marginBottom: 4 }}>
                  <strong style={{ fontFamily: "var(--font-head)" }}>{r.label}</strong>
                  {selectedRole === r.value && (
                    <span className={`badge ${r.badgeClass}`}>Selected</span>
                  )}
                </div>
                <p style={{ fontSize: "0.85rem", margin: 0 }}>{r.desc}</p>
              </div>
              <div
                style={{
                  width: 22, height: 22,
                  borderRadius: "50%",
                  border: `2px solid ${selectedRole === r.value ? r.color : "var(--border-card)"}`,
                  background: selectedRole === r.value ? r.color : "transparent",
                  transition: "var(--transition)",
                  flexShrink: 0,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Registration form */}
      {selectedRole !== null && (
        <form onSubmit={handleRegister} className="glass-card p-32 animate-fade-in-up flex flex-col gap-16">
          <h3 style={{ marginBottom: 4 }}>Complete Your Profile</h3>

          <div className="form-group">
            <label htmlFor="reg-name">
              {selectedRole === "Student" ? "Full Name" : selectedRole === "College" ? "Institution Name" : "Company Name"}
            </label>
            <input
              id="reg-name"
              type="text"
              placeholder={
                selectedRole === "Student"
                  ? "e.g. Priya Sharma"
                  : selectedRole === "College"
                  ? "e.g. IIT Bombay Placement Cell"
                  : "e.g. Infosys Limited"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {(selectedRole === "College" || selectedRole === "Company") && (
            <div className="form-group">
              <label htmlFor="reg-reg-number">
                {selectedRole === "Company" ? "CIN (Corporate Identification Number)" : "Institution Registration / Accreditation ID"}
              </label>
              <input
                id="reg-reg-number"
                type="text"
                placeholder={selectedRole === "Company" ? "e.g. L12345MH2020PLC123456" : "e.g. AICTE/UGC/university code"}
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                onBlur={() => setRegNumTouched(true)}
                style={{
                  fontFamily: "var(--font-mono)",
                  borderColor:
                    regNumTouched && regNumError
                      ? "var(--accent-danger)"
                      : registrationNumber.trim() && !regNumError
                      ? "var(--accent-success)"
                      : undefined,
                }}
                aria-invalid={regNumTouched && Boolean(regNumError) ? "true" : undefined}
                aria-describedby="reg-reg-number-msg"
                required
              />
              <span id="reg-reg-number-msg" aria-live="polite" style={{ fontSize: "0.75rem", display: "block", marginTop: 4 }}>
                {regNumTouched && regNumError ? (
                  <span style={{ color: "var(--accent-danger)" }}>{regNumError}</span>
                ) : registrationNumber.trim() && !regNumError ? (
                  <span style={{ color: "var(--accent-success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Check size={12} /> Looks valid
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>
                    Shown publicly so anyone can independently check it — this is what gives the
                    admin something concrete to verify, not just a name.
                  </span>
                )}
              </span>
            </div>
          )}

          {(selectedRole === "College" || selectedRole === "Company") && (
            <div className="form-group">
              <label htmlFor="reg-website">Official Website (optional)</label>
              <input
                id="reg-website"
                type="text"
                placeholder="e.g. https://www.iitb.ac.in"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                onBlur={() => setWebsiteTouched(true)}
                aria-invalid={websiteTouched && Boolean(websiteError) ? "true" : undefined}
                aria-describedby="reg-website-msg"
                style={{
                  borderColor:
                    websiteTouched && websiteError
                      ? "var(--accent-danger)"
                      : website.trim() && !websiteError
                      ? "var(--accent-success)"
                      : undefined,
                }}
              />
              <span id="reg-website-msg" aria-live="polite" style={{ fontSize: "0.75rem", display: "block", marginTop: 4 }}>
                {websiteTouched && websiteError ? (
                  <span style={{ color: "var(--accent-danger)" }}>{websiteError}</span>
                ) : website.trim() && !websiteError ? (
                  <span style={{ color: "var(--accent-success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Check size={12} /> We'll check this address responds once you submit.
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>
                    Helps the admin confirm this is a real institution — shown on the verification queue.
                  </span>
                )}
              </span>
            </div>
          )}

          {selectedRole === "Student" && (
            <div className="form-group">
              <label htmlFor="reg-college">Your College</label>
              {collegesLoading ? (
                <div className="flex items-center gap-8" style={{ padding: "8px 0" }}>
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  <span style={{ fontSize: "0.85rem" }}>Loading verified colleges…</span>
                </div>
              ) : colleges.length === 0 ? (
                <div className="alert alert-warning" style={{ fontSize: "0.82rem" }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>No verified colleges yet. Ask your college to register and get
                  approved first, then come back.</span>
                </div>
              ) : (
                <select
                  id="reg-college"
                  value={collegeAddress}
                  onChange={(e) => setCollegeAddress(e.target.value)}
                  required
                >
                  <option value="" disabled>Select your college…</option>
                  {colleges.map((c) => (
                    <option key={c.address} value={c.address}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {selectedRole === "Student" && collegeAddress && (
            <div className="form-group">
              <label htmlFor="reg-join-code">College Invite Code</label>
              <input
                id="reg-join-code"
                type="text"
                placeholder="e.g. 5WJAEMEM"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.15em", textTransform: "uppercase" }}
                required
              />
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                Ask your college's placement cell for this — it's how we confirm you actually
                have a connection to them, not just a name picked off a list.
              </p>
            </div>
          )}

          {error && (
            <div className="alert alert-danger" role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            id="register-submit-btn"
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={
              loading ||
              !name.trim() ||
              (selectedRole === "Student" && (!collegeAddress || !joinCode.trim())) ||
              ((selectedRole === "College" || selectedRole === "Company") && Boolean(regNumError)) ||
              Boolean(websiteError)
            }
          >
            {loading ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Writing to the blockchain…</>
            ) : (
              <><Link2 size={16} /> Register on Blockchain</>
            )}
          </button>
          {loading && (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
              This is a permanent blockchain transaction — it usually takes a few seconds to confirm.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
