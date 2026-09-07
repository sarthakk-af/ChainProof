/**
 * Registration.jsx — Role selection and registration portal
 * Shown to a signed-in account that hasn't registered on-chain yet.
 */

import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";

const ROLES = [
  {
    value: "Student",
    label: "Student",
    icon: "🎓",
    desc: "Register as a student to receive verifiable placement credentials on-chain.",
    color: "var(--accent-primary)",
    badgeClass: "badge-student",
  },
  {
    value: "College",
    label: "College / Placement Cell",
    icon: "🏛️",
    desc: "Register as a college to issue credentials, manage placement records, and view tamper-proof metrics.",
    color: "var(--accent-secondary)",
    badgeClass: "badge-college",
  },
  {
    value: "Company",
    label: "Company / Recruiter",
    icon: "🏢",
    desc: "Register as a company to browse students and progress candidates through the hiring pipeline.",
    color: "var(--accent-company)",
    badgeClass: "badge-company",
  },
];

export default function Registration() {
  const { user, registerActor } = useAuth();

  const [selectedRole, setSelectedRole] = useState(null);
  const [name, setName]                 = useState("");
  const [collegeAddress, setCollegeAddress] = useState("");
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

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!selectedRole || !name.trim()) return;
    if (selectedRole === "Student" && !collegeAddress) return;

    setLoading(true);
    setError("");

    try {
      await registerActor({
        role: selectedRole,
        name: name.trim(),
        collegeAddress: selectedRole === "Student" ? collegeAddress : undefined,
      });
    } catch (err) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 680, marginTop: 60 }}>
      <div className="section-eyebrow">Step 1 of 1</div>
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
              <span style={{ fontSize: "2rem" }}>{r.icon}</span>
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
                  <span>⚠</span>
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

          {error && (
            <div className="alert alert-danger">
              <span>❌</span><span>{error}</span>
            </div>
          )}

          <button
            id="register-submit-btn"
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading || !name.trim() || (selectedRole === "Student" && !collegeAddress)}
          >
            {loading ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Registering…</>
            ) : (
              "✅ Register on Blockchain"
            )}
          </button>
        </form>
      )}
    </div>
  );
}
