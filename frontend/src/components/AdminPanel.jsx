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
  LogIn,
  Landmark,
  AlertCircle,
  CheckCircle2,
  Activity,
  KeyRound,
  Ban,
} from "lucide-react";
import PasswordInput from "./shared/PasswordInput.jsx";
import { shortAddr } from "../utils/format.js";

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
    <div className="page-container auth-page animate-fade-in-up">
      <div className="glass-card p-32 flex flex-col gap-16">
        <div>
          <div className="section-eyebrow flex items-center gap-6">
            <ShieldCheck size={13} /> Platform administration
          </div>
          <h2 style={{ margin: "0 0 4px", fontSize: "var(--text-xl)" }}>Admin sign in</h2>
          <p style={{ fontSize: "var(--text-sm)", margin: 0 }}>
            Use <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> from backend/.env.
            College and company accounts sign in on the <a href="/login">normal sign-in page</a>.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-16">
          <div className="form-group">
            <label htmlFor="a-user">Username</label>
            <input
              id="a-user"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              autoComplete="username"
              placeholder="admin"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="a-pass">Password</label>
            <PasswordInput
              id="a-pass"
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

          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
            {busy ? <span className="spinner" /> : <><LogIn size={16} /> Sign in</>}
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

  // Bumped after a suspension or reinstatement so the action log shows it.
  const [changes, setChanges] = useState(0);

  return (
    <div className="page-container animate-fade-in-up">
      <div className="flex items-center justify-between page-head" style={{ flexWrap: "wrap", gap: "var(--space-2)" }}>
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
        <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-4)" }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-info" role="status" style={{ marginBottom: "var(--space-4)" }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{notice}</span>
        </div>
      )}

      <Health chain={overview?.chain} counts={overview?.counts} syncGaps={overview?.syncGaps} />

      {/* Until the college exists nothing else works, so its form gets the
          full width and comes first. */}
      {overview && !overview.college && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <CreateCollege
            token={token}
            onCreated={() => { setNotice("College created. The placement cell can sign in now."); load(); }}
            onError={setError}
          />
        </div>
      )}

      <div className="split">
        <div className="stack">
          {overview?.college && (
            <CollegeCard
              college={overview.college}
              token={token}
              onNotice={setNotice}
              onError={setError}
            />
          )}
          <ActionLog token={token} onError={setError} refreshKey={changes} />
        </div>

        <Accounts
          token={token}
          onChanged={() => { load(); setChanges((n) => n + 1); }}
          onNotice={setNotice}
          onError={setError}
        />
      </div>
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
    <section>
      <div className="section-head">
        <div className="section-eyebrow">Accounts ({accounts.length})</div>
        <div className="flex gap-8" style={{ flex: "1 1 360px", justifyContent: "flex-end" }}>
          <select
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ width: 130 }}
          >
            <option value="">All roles</option>
            <option value="College">College</option>
            <option value="Company">Company</option>
            <option value="Student">Student</option>
          </select>
          <input
            aria-label="Search accounts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            style={{ maxWidth: 320 }}
          />
        </div>
      </div>
      <p className="form-hint" style={{ margin: "0 0 10px" }}>
        Suspending stops an account from acting. Nothing it already recorded changes.
      </p>

      <div className="row-list">
        {accounts.length === 0 && <div className="row-empty">No accounts match.</div>}
        {accounts.map((a) => (
          <div key={a.address} className="row">
            <div style={{ minWidth: 0 }}>
              <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                <strong className="item-title">{a.name}</strong>
                <span className="pill pill-muted">{a.role}</span>
                <span
                  className="pill"
                  style={a.status === "Suspended" ? { color: "var(--accent-warning)" } : undefined}
                >
                  {a.status}
                </span>
              </div>
              <div className="row-meta" style={{ marginTop: 2 }}>
                {a.email && <>{a.email} · </>}
                <span className="mono-addr" title={a.address}>{shortAddr(a.address)}</span>
              </div>
            </div>

            <div style={{ flexShrink: 0 }}>
              {a.status === "Active" && confirming !== a.address && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy === a.address}
                  onClick={() => { setConfirming(a.address); setReason(""); }}
                >
                  <Ban size={14} /> Suspend
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

            {confirming === a.address && (
              <div className="flex gap-8 items-center" style={{ flexBasis: "100%", flexWrap: "wrap" }}>
                <input
                  aria-label={`Why are you suspending ${a.name}?`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (goes on the blockchain with the suspension)"
                  style={{ flex: "1 1 260px" }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy === a.address}
                  onClick={() => act(a, "suspend")}
                >
                  {busy === a.address ? <span className="spinner" /> : "Confirm suspension"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
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
function ActionLog({ token, onError, refreshKey }) {
  const [actions, setActions] = useState([]);

  useEffect(() => {
    adminApi("/admin/actions?limit=25", { token })
      .then((d) => setActions(d.actions))
      .catch((err) => onError(err.message));
  }, [token, onError, refreshKey]);

  return (
    <section>
      <div className="section-head">
        <div className="section-eyebrow">Recent actions</div>
      </div>
      <div className="row-list">
        {actions.length === 0 && <div className="row-empty">Nothing yet.</div>}
        {actions.map((a) => (
          <div key={a.id} className="row" style={{ display: "block", fontSize: "var(--text-sm)" }}>
            <div>
              {humanAction(a.action)} · <strong>{a.actor_name || a.actor_address}</strong>
            </div>
            <div className="row-meta">
              {a.reason && <>{a.reason} · </>}
              {a.admin_username && <>by {a.admin_username} · </>}
              {new Date(a.created_at).toLocaleString()}
            </div>
          </div>
        ))}
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

function Health({ chain, counts, syncGaps }) {
  if (!chain) return null;
  return (
    <section style={{ marginBottom: "var(--space-4)" }}>
      <div className="section-head">
        <div className="section-eyebrow">
          <Activity size={13} style={{ verticalAlign: "-2px" }} /> Health
        </div>
      </div>

      {chain.error ? (
        <div className="alert alert-danger" role="alert">
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

          {/* A gap means the local copy is behind the chain. Reconciliation
              repairs it on its own; if it persists, the figures on every
              dashboard are stale and this is the only place that says so. */}
          {syncGaps?.length > 0 && (
            <div className="alert alert-warning" role="status" style={{ marginTop: "var(--space-3)" }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {syncGaps.length === 1
                  ? `Block ${syncGaps[0]} hasn't been copied locally yet.`
                  : `${syncGaps.length} blocks haven't been copied locally yet (from ${syncGaps[0]}).`}{" "}
                The figures on the dashboards may be behind until that clears — it retries
                every minute.
              </span>
            </div>
          )}

          {chain.low && (
            <div className="alert alert-warning" role="status" style={{ marginTop: "var(--space-3)" }}>
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
          <p className="card-lead">
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
        <p className="form-hint">
          Published publicly so anyone can look it up independently.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="c-web">Website <span className="label-optional">(optional)</span></label>
        <input id="c-web" value={form.website} onChange={set("website")} placeholder="https://example.com" />
      </div>

      <h3 className="card-title" style={{ marginTop: 4, marginBottom: 0 }}>Placement cell login</h3>

      <div className="form-group">
        <label htmlFor="c-email">Email</label>
        <input id="c-email" type="email" value={form.email} onChange={set("email")} required />
      </div>

      <div className="form-group">
        <label htmlFor="c-pass">Password</label>
        <PasswordInput id="c-pass" value={form.password} onChange={set("password")} autoComplete="new-password" required />
        <p className="form-hint">
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
  const [resetting, setResetting] = useState(false);
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
      setResetting(false);
      onNotice(`Password reset for ${result.email}.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="section-head">
        <div className="section-eyebrow">The college</div>
      </div>
      <div className="glass-card p-24">
        <h3 className="card-title">{college.name}</h3>
        <div className="row-meta">
          {college.registrationNumber || "No registration ID"} · {college.status}
        </div>
        <div className="mono-addr" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }} title={college.address}>
          {shortAddr(college.address)}
        </div>

        {/* A lost-login fix, needed rarely — kept out of the way until asked for. */}
        {!resetting ? (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "var(--space-3)" }} onClick={() => setResetting(true)}>
            <KeyRound size={14} /> Reset placement cell password
          </button>
        ) : (
          <form onSubmit={reset} className="flex flex-col gap-10" style={{ marginTop: "var(--space-3)" }}>
            <div className="form-group">
              <label htmlFor="c-newpass">New password for the placement cell</label>
              <PasswordInput
                id="c-newpass"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters, including a number"
              />
            </div>
            <div className="flex gap-8">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !password}>
                {busy ? <span className="spinner" /> : "Reset password"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setResetting(false); setPassword(""); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
