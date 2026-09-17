/**
 * AdminPanel.jsx — the platform owner's screen.
 *
 * Deliberately one page. It exists to do the thing no screen could do before:
 * bring the college into existence. That used to take a console command pasted
 * into the middle of someone's first five minutes, which made the product
 * unusable by anyone who hadn't built it.
 *
 * It cannot post a drive or record an outcome, and that is not an oversight.
 * The moment any account can record a placement, "only the company can say who
 * got hired" stops being true — and that sentence is the whole reason this is
 * on a blockchain.
 *
 * Lives outside AuthProvider: admin sessions are a different token type, and
 * mixing the two is how one ends up accepted as the other.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  Landmark,
  AlertCircle,
  CheckCircle2,
  Activity,
  KeyRound,
  Ban,
} from "lucide-react";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const TOKEN_KEY = "chainproof_admin_session";

async function adminApi(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export default function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState("");

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
  };

  if (!token) {
    return (
      <LoginScreen
        onSignedIn={(t, name) => {
          sessionStorage.setItem(TOKEN_KEY, t);
          setToken(t);
          setUsername(name);
        }}
      />
    );
  }

  return <Console token={token} username={username} onSignOut={signOut} onExpired={signOut} />;
}

// ---------------------------------------------------------------------------

function LoginScreen({ onSignedIn }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await adminApi("/admin/auth/login", { method: "POST", body: form });
      onSignedIn(result.token, result.username);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 420, marginTop: 100 }}>
      <div className="glass-card p-24 flex flex-col gap-16">
        <div className="flex items-center gap-12">
          <ShieldCheck size={22} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          <div>
            <strong style={{ fontFamily: "var(--font-head)" }}>Platform administration</strong>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Set up from your backend .env file.
            </div>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-16">
          <div className="form-group">
            <label htmlFor="a-user">Username</label>
            <input
              id="a-user"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="a-pass">Password</label>
            <input
              id="a-pass"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="alert alert-danger" role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Console({ token, username, onSignOut, onExpired }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    adminApi("/admin/overview", { token })
      .then(setOverview)
      .catch((err) => {
        // A dead session shouldn't look like a broken page.
        if (/session|token/i.test(err.message)) return onExpired();
        setError(err.message);
      });
  }, [token, onExpired]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 780 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 20, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="section-eyebrow">
            <a href="/" style={{ color: "inherit" }}>ChainProof</a> · Platform administration
          </div>
          <h2 style={{ marginBottom: 0 }}>System</h2>
        </div>
        <div className="flex items-center gap-8">
          {username && <span className="badge badge-student">{username}</span>}
          <button className="btn btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-info" role="status" style={{ marginBottom: 16 }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{notice}</span>
        </div>
      )}

      <Health chain={overview?.chain} counts={overview?.counts} />

      {overview && !overview.college && (
        <CreateCollege
          token={token}
          onCreated={() => { setNotice("College created. The placement cell can sign in now."); load(); }}
          onError={setError}
        />
      )}

      {overview?.college && (
        <CollegeCard
          college={overview.college}
          token={token}
          onNotice={setNotice}
          onError={setError}
        />
      )}

      <Accounts
        token={token}
        onChanged={load}
        onNotice={setNotice}
        onError={setError}
      />

      <ActionLog token={token} onError={setError} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Every account on the platform, and the one thing that can be done to them.
 *
 * Suspension is the whole of the owner's authority over other people's data,
 * and the panel says so plainly. It stops an account acting; it changes nothing
 * that account already signed. There is no edit button here and there is not
 * going to be one — an owner who could alter a placement record would make
 * every record on this platform worth exactly as much as their word, which is
 * the thing it was built to avoid needing.
 */
function Accounts({ token, onChanged, onNotice, onError }) {
  const [accounts, setAccounts] = useState([]);
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    if (query.trim()) params.set("q", query.trim());
    adminApi(`/admin/accounts?${params.toString()}`, { token })
      .then((d) => setAccounts(d.accounts))
      .catch((err) => onError(err.message));
  }, [token, role, query, onError]);

  useEffect(() => { load(); }, [load]);

  const act = async (account, action) => {
    setBusy(account.address);
    onError("");
    try {
      await adminApi(`/admin/accounts/${account.address}/${action}`, {
        token,
        method: "POST",
        body: action === "suspend" ? { reason } : {},
      });
      onNotice(
        action === "suspend"
          ? `${account.name} can no longer act. Everything they already signed stands.`
          : `${account.name} is active again.`
      );
      setConfirming(null);
      setReason("");
      load();
      onChanged();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>Accounts</div>

      <div className="glass-card p-24" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 14 }}>
          You can stop an account from acting, and let it act again. You cannot edit what
          it has already recorded — a drive, a result or a placement stays exactly as its
          author signed it, which is what makes any of it worth reading.
        </p>

        <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
          <div className="form-group" style={{ flex: "1 1 140px", marginBottom: 0 }}>
            <label htmlFor="ac-role">Role</label>
            <select id="ac-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All</option>
              <option value="College">College</option>
              <option value="Company">Company</option>
              <option value="Student">Student</option>
            </select>
          </div>
          <div className="form-group" style={{ flex: "2 1 200px", marginBottom: 0 }}>
            <label htmlFor="ac-q">Search</label>
            <input
              id="ac-q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, address or registration number"
            />
          </div>
        </div>
      </div>

      {accounts.length === 0 && (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No accounts match.</p>
      )}

      <div className="flex flex-col gap-10">
        {accounts.map((a) => (
          <div key={a.address} className="glass-card p-24">
            <div className="flex items-start justify-between gap-12" style={{ flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                  <strong style={{ fontFamily: "var(--font-head)" }}>{a.name}</strong>
                  <span className="pill pill-muted" style={{ fontSize: "0.68rem" }}>{a.role}</span>
                  <span
                    className="pill"
                    style={{
                      fontSize: "0.68rem",
                      color: a.status === "Suspended" ? "var(--accent-warning)" : undefined,
                    }}
                  >
                    {a.status}
                  </span>
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: 6 }}>
                  <span className="mono-addr">{a.address}</span>
                  {a.email && <> · {a.email}</>}
                </div>
              </div>

              <div style={{ flexShrink: 0 }}>
                {a.status === "Active" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy === a.address}
                    onClick={() => { setConfirming(a.address); setReason(""); }}
                  >
                    <Ban size={13} /> Suspend
                  </button>
                )}
                {a.status === "Suspended" && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === a.address}
                    onClick={() => act(a, "reinstate")}
                  >
                    {busy === a.address ? <span className="spinner" /> : "Reinstate"}
                  </button>
                )}
              </div>
            </div>

            {confirming === a.address && (
              <div className="flex flex-col gap-12" style={{ marginTop: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ac-reason-${a.address}`}>Why are you suspending this account?</label>
                  <input
                    id={`ac-reason-${a.address}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Reported by the placement cell as not a real recruiter"
                  />
                  <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 4 }}>
                    The reason goes on the blockchain with the suspension. Nothing this
                    account already recorded changes.
                  </p>
                </div>
                <div className="flex gap-8">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === a.address}
                    onClick={() => act(a, "suspend")}
                  >
                    {busy === a.address ? <span className="spinner" /> : "Confirm suspension"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                    Never mind
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * What the owner has done, shown to the owner.
 *
 * On screen rather than in a log file, because the claim this project makes is
 * that its records do not rest on trusting whoever runs it. An administrator
 * acting invisibly would quietly turn that back into "trust me".
 */
function ActionLog({ token, onError }) {
  const [actions, setActions] = useState([]);

  useEffect(() => {
    adminApi("/admin/actions?limit=25", { token })
      .then((d) => setActions(d.actions))
      .catch((err) => onError(err.message));
  }, [token, onError]);

  if (actions.length === 0) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>Recent actions</div>
      <div className="glass-card p-24">
        <div className="flex flex-col gap-10">
          {actions.map((a) => (
            <div key={a.id} style={{ fontSize: "0.82rem" }}>
              <span>{humanAction(a.action)}</span>
              {" · "}
              <strong>{a.actor_name || a.actor_address}</strong>
              {a.reason && <> · {a.reason}</>}
              <span style={{ color: "var(--text-muted)" }}>
                {a.admin_username && <> · by {a.admin_username}</>}
                {" · "}
                {new Date(a.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "company_approved" → "Company approved". */
function humanAction(code = "") {
  const text = code.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------

function Health({ chain, counts }) {
  if (!chain) return null;
  return (
    <section style={{ marginBottom: 24 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>
        <Activity size={13} style={{ verticalAlign: "-2px" }} /> Health
      </div>

      {chain.error ? (
        <div className="alert alert-danger">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>The blockchain isn't reachable: {chain.error}</span>
        </div>
      ) : (
        <>
          <div className="kpi-strip">
            <div className="kpi">
              <span className="kpi-n">{chain.blockNumber}</span>
              <span className="kpi-l">Current block</span>
            </div>
            <div className="kpi">
              <span className="kpi-n">{counts?.companies ?? 0}</span>
              <span className="kpi-l">Companies</span>
            </div>
            <div className="kpi">
              <span className="kpi-n">{counts?.students ?? 0}</span>
              <span className="kpi-l">Verified students</span>
            </div>
            <div className="kpi">
              <span className={chain.low ? "kpi-n accent" : "kpi-n"}>
                {chain.approxSignupsRemaining ?? "—"}
              </span>
              <span className="kpi-l">Sign-ups the treasury can fund</span>
            </div>
          </div>

          {chain.low && (
            <div className="alert alert-warning" style={{ marginTop: 12, fontSize: "0.82rem" }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              {/* Worth seeing before it stops anything rather than after: when
                  this empties, every signup fails and nothing else says why. */}
              <span>
                The service wallet is running low. Top up{" "}
                <span className="mono-addr">{chain.treasuryAddress}</span> — it funds
                every new account, and sign-ups stop when it empties.
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function CreateCollege({ token, onCreated, onError }) {
  const [form, setForm] = useState({
    name: "",
    registrationNumber: "",
    website: "",
    email: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      await adminApi("/admin/college", { method: "POST", body: form, token });
      onCreated();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16">
      <div className="flex items-center gap-12">
        <Landmark size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
        <div>
          <h3 className="card-title">Set up the college</h3>
          <p className="card-lead" style={{ marginBottom: 0 }}>
            Nothing else works until this exists — students are verified against its
            roster and companies are admitted by it. This creates its on-chain identity
            and the placement cell's login together.
          </p>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="c-name">Institution name</label>
        <input id="c-name" value={form.name} onChange={set("name")} required />
      </div>

      <div className="form-group">
        <label htmlFor="c-reg">Registration / accreditation ID</label>
        <input id="c-reg" value={form.registrationNumber} onChange={set("registrationNumber")} placeholder="EDU/MH/2024/0142" required />
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
          Published publicly so anyone can look it up independently.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="c-web">Website <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span></label>
        <input id="c-web" value={form.website} onChange={set("website")} placeholder="https://example.com" />
      </div>

      <h3 className="card-title" style={{ marginTop: 4, marginBottom: 0 }}>Placement cell login</h3>

      <div className="form-group">
        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" value={form.email} onChange={set("email")} required />
      </div>

      <div className="form-group">
        <label htmlFor="c-pass">Password</label>
        <input id="c-pass" type="password" value={form.password} onChange={set("password")} required />
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
          At least 8 characters, including a number. Hand these to your placement cell.
        </p>
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : "Create the college"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function CollegeCard({ college, token, onNotice, onError }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async (e) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    onError("");
    try {
      const result = await adminApi("/admin/college/reset-password", {
        method: "POST",
        body: { password },
        token,
      });
      setPassword("");
      onNotice(`Password reset for ${result.email}.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="glass-card p-24" style={{ marginBottom: 20 }}>
        <h3 className="card-title" style={{ marginBottom: 12 }}>The college</h3>
        <div style={{ fontSize: "0.9rem", lineHeight: 1.9 }}>
          <div><strong style={{ fontFamily: "var(--font-head)" }}>{college.name}</strong></div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {college.registrationNumber || "no registration ID"} · {college.status}
          </div>
          <div className="mono-addr" style={{ fontSize: "0.72rem" }}>{college.address}</div>
        </div>
      </section>

      <form onSubmit={reset} className="glass-card p-24 flex flex-col gap-16" style={{ marginBottom: 24 }}>
        <div className="flex items-center gap-12">
          <KeyRound size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
          <div>
            <h3 className="card-title">Reset the placement cell's password</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
              The break-glass for a lost login. Nothing else about the college changes.
            </p>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="c-newpass">New password</label>
          <input
            id="c-newpass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters, including a number"
          />
        </div>
        <button type="submit" className="btn btn-ghost" disabled={busy || !password}>
          {busy ? <span className="spinner" /> : "Reset password"}
        </button>
      </form>
    </>
  );
}
