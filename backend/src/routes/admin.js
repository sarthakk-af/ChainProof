import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  db,
  createUser,
  getUserByEmail,
  setEmailVerified,
  setPasswordHash,
  getActor,
  listActors,
  setRegistrationNumber,
  logAdminAction,
  listAdminActions,
} from "../db.js";
import { hashPassword, verifyPassword, validatePassword, PASSWORD_RULE_MESSAGE, signAdminToken } from "../auth.js";
import { generateWallet, getUserSigner } from "../wallets.js";
import { fundWallet, getTreasuryBalance, treasuryAddress } from "../treasury.js";
import {
  actorRegistryAsSigner,
  actorRegistryAsVerifier,
  actorRegistryRead,
  provider,
  verifierSigner,
  ROLE,
  STATUS,
} from "../chain.js";
import { syncActor } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { serializeActor, STATUS_NAMES } from "../serializers.js";
import { validateRegistrationNumber } from "../registrationNumber.js";
import { adminSessionAuth } from "../middleware/adminSessionAuth.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * admin.js — the platform owner.
 *
 * Deliberately small. It exists to do the one thing no screen could do before:
 * bring the college into existence. Previously that took a console command
 * pasted mid-signup, which made the product unusable by anyone who hadn't built
 * it.
 *
 * What it can do: create the college and its login, reset that login, suspend
 * and reinstate accounts, and see whether the chain and treasury are healthy.
 * Housekeeping and security — the caretaker of accounts.
 *
 * What it deliberately cannot do: post a drive, record an outcome, or edit any
 * record at all. Not because the owner shouldn't be trusted, but because the
 * moment *any* account can record or alter a placement, "only the company can
 * say who got hired" stops being true — and that sentence is the entire answer
 * to why this is on a chain. One convenient button is not worth trading it for.
 *
 * Which is why the answer to a fake company is suspension rather than deletion.
 * Suspending stops an account acting and touches nothing it already signed; the
 * drives, stages and offers stay exactly as they were, and the suspension
 * itself is a chain event with the reason attached. An admin whose corrections
 * were invisible would just be asking everyone to trust the admin, which is the
 * thing this platform is built to avoid needing.
 */
export const adminRouter = Router();

/**
 * Serialises everything signed by the platform verifier.
 *
 * The verifier is one shared wallet, unlike a user's, so two admin actions
 * close together race for the same nonce — and the second fails with "nonce has
 * already been used", which reads like a chain problem rather than a queueing
 * one. Every other signer on this platform already goes through this queue;
 * this one was the exception because it used to send a transaction only during
 * setup, when nothing else was happening. Suspending an account made it an
 * everyday path, and the gap showed up immediately.
 */
function withVerifierLock(fn) {
  return withWalletLock(verifierSigner.address, fn);
}

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

adminRouter.post("/auth/login", adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  const admin = db
    .prepare("SELECT * FROM admins WHERE username = ?")
    .get(String(username).trim().toLowerCase());

  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    logger.warn("admin_login_failed", { username });
    // Same answer either way — otherwise this tells an attacker which half of
    // the credential they already have right.
    return res.status(401).json({ error: "Invalid username or password" });
  }

  logger.info("admin_logged_in", { username: admin.username });
  res.json({ token: signAdminToken({ adminId: admin.id, username: admin.username }), username: admin.username });
});

adminRouter.use(adminSessionAuth);

/** Chain health, treasury balance, and whether the college exists yet. */
adminRouter.get("/overview", async (_req, res) => {
  const colleges = listActors({ role: ROLE.College });
  let chain = null;
  try {
    const [blockNumber, balanceEth] = await Promise.all([
      provider.getBlockNumber(),
      getTreasuryBalance(),
    ]);
    const drip = Number(config.walletGasDripEth);
    const remaining = drip > 0 ? Math.floor(Number(balanceEth) / drip) : null;
    chain = {
      blockNumber,
      treasuryAddress,
      treasuryBalanceEth: balanceEth,
      approxSignupsRemaining: remaining,
      low: remaining !== null && remaining < 10,
    };
  } catch (err) {
    chain = { error: err.message };
  }

  res.json({
    chain,
    college: colleges.length > 0 ? serializeActor(colleges[0]) : null,
    counts: {
      colleges: colleges.length,
      companies: listActors({ role: ROLE.Company }).length,
      students: listActors({ role: ROLE.Student }).length,
    },
  });
});

/**
 * Creates the college, its login, and its on-chain identity — in one call.
 *
 * All three happen together because any two without the third is a broken
 * state: a login with no on-chain college can't act, and an on-chain college
 * with no login can't be reached. Doing it piecemeal is how the old
 * console-command bootstrap came about.
 */
adminRouter.post("/college", async (req, res) => {
  const { name, registrationNumber, website, email, password } = req.body || {};

  if (listActors({ role: ROLE.College }).length > 0) {
    return res.status(409).json({
      error: "A college already exists on this platform. This build hosts one college.",
    });
  }

  const collegeName = String(name ?? "").trim();
  if (!collegeName) return res.status(400).json({ error: "Institution name is required." });

  const regCheck = validateRegistrationNumber("College", registrationNumber);
  if (regCheck.error) return res.status(400).json({ error: regCheck.error });

  const loginEmail = String(email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) {
    return res.status(400).json({ error: "Enter a valid email for the placement cell login." });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  // An existing login is refused unless it is the college's own, left without
  // an on-chain identity by a chain reset. That case used to be a dead end: the
  // login survived in the database, the college did not survive on the chain,
  // and every attempt to recreate it was told the email was already taken.
  // Checked against the chain itself rather than the mirror, which a redeploy
  // has just emptied.
  const existingUser = getUserByEmail(loginEmail);
  if (existingUser) {
    const onChain = await actorRegistryRead.getActor(existingUser.wallet_address);
    if (!existingUser.is_college_login || Number(onChain.role) !== ROLE.None) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
  }

  try {
    let user;
    let address;
    if (existingUser) {
      user = existingUser;
      address = existingUser.wallet_address;
      setPasswordHash(user.id, await hashPassword(password));
      await fundWallet(address);
      logger.info("college_login_reused", { email: loginEmail, address });
    } else {
      const wallet = generateWallet();
      address = wallet.address;
      await fundWallet(address);
      user = createUser({
        email: loginEmail,
        passwordHash: await hashPassword(password),
        walletAddress: address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
      });
      db.prepare("UPDATE users SET is_college_login = 1 WHERE id = ?").run(user.id);
    }
    // The admin vouched for this account by creating it; there is nobody else
    // to confirm it with.
    setEmailVerified(user.id);

    await withWalletLock(address, async (nonce) => {
      const registry = actorRegistryAsSigner(getUserSigner(user.id));
      const tx = await registry.register(
        ROLE.College,
        collegeName,
        String(website ?? "").trim(),
        "0x0000000000000000000000000000000000000000",
        { nonce }
      );
      await tx.wait();
    });

    // The platform verifier admits it immediately. This is the console command
    // that used to sit in the middle of the user's first five minutes.
    const receipt = await withVerifierLock(async (nonce) => {
      const approveTx = await actorRegistryAsVerifier.approveActor(address, { nonce });
      return approveTx.wait();
    });
    await syncActor(address, receipt.blockNumber);
    setRegistrationNumber(address, regCheck.value);

    logger.info("college_created", { name: collegeName, address, email: loginEmail });
    res.status(201).json({
      college: serializeActor(getActor(address)),
      login: { email: loginEmail },
    });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("college_creation_failed", { reason });
    res.status(502).json({ error: `Could not create the college: ${reason}` });
  }
});

// ===========================================================================
// Accounts — the whole of the admin's authority
// ===========================================================================

/**
 * Every account on the platform, with enough context to act on one.
 *
 * @query role   "College" | "Company" | "Student"
 * @query status "Pending" | "Active" | "Rejected" | "Suspended"
 */
adminRouter.get("/accounts", (req, res) => {
  const { role, status, q } = req.query;

  const filters = {};
  if (role !== undefined) {
    if (ROLE[role] === undefined) {
      return res.status(400).json({ error: `Unknown role: "${role}".` });
    }
    filters.role = ROLE[role];
  }
  if (status !== undefined) {
    if (STATUS[status] === undefined) {
      return res.status(400).json({ error: `Unknown status: "${status}".` });
    }
    filters.status = STATUS[status];
  }

  let rows = listActors(filters);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name?.toLowerCase().includes(needle) ||
        r.address.toLowerCase().includes(needle) ||
        r.registration_number?.toLowerCase().includes(needle)
    );
  }

  // The login behind each on-chain identity, so a suspension is about a person
  // the owner can actually contact rather than a hex string.
  const emailFor = db.prepare("SELECT email FROM users WHERE LOWER(wallet_address) = LOWER(?)");
  // A student is registered on-chain under a placeholder rather than their name
  // (see studentVerification.js), so the name the owner needs comes from the
  // off-chain profile instead.
  const profileNameFor = db.prepare(
    "SELECT full_name, roll_number FROM student_profiles WHERE address = LOWER(?)"
  );
  res.json({
    accounts: rows.map((row) => {
      const account = { ...serializeActor(row), email: emailFor.get(row.address)?.email ?? null };
      if (row.role === ROLE.Student) {
        const profile = profileNameFor.get(row.address);
        if (profile?.full_name) account.name = profile.full_name;
        account.rollNumber = profile?.roll_number ?? null;
      }
      return account;
    }),
  });
});

/**
 * Withdraws an account's access.
 *
 * On-chain, with the reason attached, and reversible. Note what it does not do:
 * it changes nothing the account already signed. A suspended company's drives,
 * stages and offers all stand, and the students it placed stay placed. That is
 * the point — an admin who could erase a record by suspending its author would
 * make every record on the platform worth exactly as much as the admin's word.
 */
adminRouter.post("/accounts/:address/suspend", async (req, res) => {
  const { address } = req.params;
  const actor = getActor(address);
  if (!actor) return res.status(404).json({ error: "No such account." });
  if (actor.status !== STATUS.Active) {
    return res.status(409).json({
      error: `That account is ${STATUS_NAMES[actor.status]}, so there is no access to withdraw.`,
    });
  }

  const reason = String(req.body?.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);

  try {
    const receipt = await withVerifierLock(async (nonce) => {
      const tx = await actorRegistryAsVerifier.suspendActor(actor.address, reason, { nonce });
      return tx.wait();
    });
    await syncActor(actor.address, receipt.blockNumber);

    logAdminAction({
      actorAddress: actor.address,
      actorName: actor.name,
      action: "suspend",
      reason: reason || null,
      txHash: receipt.hash,
      adminUsername: req.admin?.username ?? null,
    });
    logger.info("account_suspended", { address: actor.address, by: req.admin?.username, reason });
    res.json({ account: serializeActor(getActor(actor.address)), txHash: receipt.hash });
  } catch (err) {
    const detail = err.reason || err.shortMessage || err.message;
    logger.error("account_suspend_failed", { address, detail });
    res.status(502).json({ error: `Could not suspend that account: ${detail}` });
  }
});

/** Restores a suspended account. A suspension nobody could lift would be a ban. */
adminRouter.post("/accounts/:address/reinstate", async (req, res) => {
  const { address } = req.params;
  const actor = getActor(address);
  if (!actor) return res.status(404).json({ error: "No such account." });
  if (actor.status !== STATUS.Suspended) {
    return res.status(409).json({ error: "That account is not suspended." });
  }

  try {
    const receipt = await withVerifierLock(async (nonce) => {
      const tx = await actorRegistryAsVerifier.reinstateActor(actor.address, { nonce });
      return tx.wait();
    });
    await syncActor(actor.address, receipt.blockNumber);

    logAdminAction({
      actorAddress: actor.address,
      actorName: actor.name,
      action: "reinstate",
      reason: null,
      txHash: receipt.hash,
      adminUsername: req.admin?.username ?? null,
    });
    logger.info("account_reinstated", { address: actor.address, by: req.admin?.username });
    res.json({ account: serializeActor(getActor(actor.address)), txHash: receipt.hash });
  } catch (err) {
    const detail = err.reason || err.shortMessage || err.message;
    logger.error("account_reinstate_failed", { address, detail });
    res.status(502).json({ error: `Could not reinstate that account: ${detail}` });
  }
});

/**
 * Everything the admin has done.
 *
 * Published rather than kept in a log file nobody reads. The claim this
 * platform makes is that its records do not depend on trusting whoever runs it;
 * an admin acting invisibly would quietly turn that back into "trust Sarthak".
 */
adminRouter.get("/actions", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json({ actions: listAdminActions(limit) });
});

/** Resets the placement cell's password — the break-glass for a lost login. */
adminRouter.post("/college/reset-password", async (req, res) => {
  const { password } = req.body || {};
  if (!validatePassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  const colleges = listActors({ role: ROLE.College });
  if (colleges.length === 0) {
    return res.status(404).json({ error: "No college has been created yet." });
  }
  const user = db
    .prepare("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)")
    .get(colleges[0].address);
  if (!user) {
    return res.status(404).json({ error: "That college has no login account." });
  }

  setPasswordHash(user.id, await hashPassword(password));
  logger.info("college_password_reset", { email: user.email });
  res.json({ ok: true, email: user.email });
});
