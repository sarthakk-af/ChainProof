import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  listActors,
  getActor,
  updateActorStatus,
  logAdminAction,
  listAdminActions,
  setJoinCode,
  createAdmin,
  getAdminByUsername,
  listAdmins,
  findDuplicateNames,
} from "../db.js";
import { actorRegistryAsVerifier, verifierSigner, provider, ROLE, STATUS } from "../chain.js";
import { serializeActor, parseEnumQueryParam, STATUS_NAMES } from "../serializers.js";
import { withWalletLock } from "../txQueue.js";
import { generateJoinCode } from "../joinCode.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { adminSessionAuth } from "../middleware/adminSessionAuth.js";
import { hashPassword, verifyPassword, validatePassword, PASSWORD_RULE_MESSAGE, signAdminToken } from "../auth.js";
import { logger } from "../logger.js";

export const adminRouter = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

// Bootstrap only — creates a named admin account. Guarded by the shared
// secret rather than an existing admin session, since the very first admin
// account has no session to guard it with yet.
adminRouter.post("/admins", adminAuth, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "username is required" });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }
  const normalizedUsername = username.trim().toLowerCase();
  if (getAdminByUsername(normalizedUsername)) {
    return res.status(409).json({ error: "An admin with this username already exists" });
  }
  const passwordHash = await hashPassword(password);
  const admin = createAdmin({ username: normalizedUsername, passwordHash });
  logger.info("admin_account_created", { username: admin.username });
  res.status(201).json({ admin: { id: admin.id, username: admin.username } });
});

adminRouter.get("/admins", adminAuth, (_req, res) => {
  res.json({ admins: listAdmins() });
});

adminRouter.post("/auth/login", adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }
  const admin = getAdminByUsername(String(username).trim().toLowerCase());
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    logger.warn("admin_login_failed", { username });
    return res.status(401).json({ error: "Invalid username or password" });
  }
  logger.info("admin_logged_in", { username: admin.username });
  const token = signAdminToken({ adminId: admin.id, username: admin.username });
  res.json({ token, username: admin.username });
});

adminRouter.get("/actors", adminSessionAuth, (req, res) => {
  try {
    const role = parseEnumQueryParam(req.query.role, ROLE, "role");
    const status = parseEnumQueryParam(req.query.status, STATUS, "status");
    const rows = listActors({ role, status });
    // A shared display name isn't blocked at registration (plenty of real
    // institutions share one), but an admin should see it before approving —
    // computed once for the whole list rather than per row.
    const duplicateNames = findDuplicateNames();
    res.json({
      actors: rows.map((row) => ({
        ...serializeActor(row),
        sharesNameWithAnother: duplicateNames.has(String(row.name || "").trim().toLowerCase()),
      })),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get("/actors/:address", adminSessionAuth, (req, res) => {
  const row = getActor(req.params.address);
  if (!row) {
    return res.status(404).json({ error: "Actor not found" });
  }
  res.json({ actor: serializeActor(row) });
});

async function handleVerifierAction(req, res, { contractMethod, expectedResultingStatus, event, rejectionReason }) {
  const { address } = req.params;
  const cached = getActor(address);
  if (!cached) {
    return res.status(404).json({ error: "Actor not found in index. Has it been registered on-chain?" });
  }
  if (cached.status !== STATUS.Pending) {
    return res.status(409).json({
      error: `Actor is not Pending (current status: ${STATUS_NAMES[cached.status]})`,
    });
  }

  try {
    // The verifier is one shared signer across every admin action, same as
    // the treasury signer — needs the same explicit nonce handling (see
    // txQueue.js) to avoid two approvals close together colliding.
    const receipt = await withWalletLock(verifierSigner.address, async (nonce) => {
      const tx = await actorRegistryAsVerifier[contractMethod](address, { nonce });
      return tx.wait();
    });
    updateActorStatus(address, expectedResultingStatus, receipt.blockNumber, rejectionReason || null);
    // A College needs a code to hand its own students the moment it's
    // active — generated here rather than lazily on first dashboard visit,
    // so there's never a window where an Active college has no code yet and
    // every student registration against it would be rejected.
    if (expectedResultingStatus === STATUS.Active && cached.role === ROLE.College) {
      setJoinCode(address, generateJoinCode());
    }
    logger.info(event, { address, name: cached.name, rejectionReason, admin: req.admin.username });
    logAdminAction({
      actorAddress: address,
      actorName: cached.name,
      action: event,
      reason: rejectionReason,
      txHash: receipt.hash,
      adminUsername: req.admin.username,
    });
    res.json({ actor: serializeActor(getActor(address)), txHash: receipt.hash });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("verifier_action_failed", { address, event, reason });
    res.status(502).json({ error: `On-chain transaction failed: ${reason}` });
  }
}

adminRouter.post("/actors/:address/approve", adminSessionAuth, (req, res) =>
  handleVerifierAction(req, res, {
    contractMethod: "approveActor",
    expectedResultingStatus: STATUS.Active,
    event: "actor_approved",
  })
);

adminRouter.post("/actors/:address/reject", adminSessionAuth, (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  return handleVerifierAction(req, res, {
    contractMethod: "rejectActor",
    expectedResultingStatus: STATUS.Rejected,
    event: "actor_rejected",
    rejectionReason: reason || null,
  });
});

// The verification audit trail — every approve/reject decision, permanently
// recorded (see db/adminActions.js). Powers AdminPanel's "Recent Decisions" log.
adminRouter.get("/actions", adminSessionAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ actions: listAdminActions(limit) });
});

// Exposed for tests / health checks that want to confirm chain connectivity —
// deliberately unauthenticated, it reveals nothing beyond "the chain is up."
adminRouter.get("/health", async (_req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ status: "ok", blockNumber });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});
