import express from "express";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { startIndexer } from "./indexer.js";
import { logger } from "./logger.js";

// Without these, Node terminates the entire process on an unhandled promise
// rejection (default since Node 15) — one unexpected bug anywhere would take
// the whole server down for every user, not just the request that hit it.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", { reason: String(reason) });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaught_exception", { message: err.message, stack: err.stack });
});

/**
 * Creates the platform owner's account on first start.
 *
 * Bootstrapping used to require a curl call with a shared secret before the app
 * could do anything at all — which meant the first five minutes of using this
 * project were spent in a terminal. The owner is configured, not registered.
 */
async function ensureAdminAccount() {
  const { db } = await import("./db.js");
  const { hashPassword, verifyPassword, validatePassword, PASSWORD_RULE_MESSAGE } = await import(
    "./auth.js"
  );

  const existing = db
    .prepare("SELECT id, password_hash FROM admins WHERE username = ?")
    .get(config.adminUsername);

  // .env is the source of truth for the owner's login. Previously the password
  // was read only when the account was first created, so changing
  // ADMIN_PASSWORD afterwards silently did nothing and the owner was locked out
  // with a password that no longer matched the one in their own config file.
  if (existing) {
    if (
      config.adminPassword &&
      validatePassword(config.adminPassword) &&
      !(await verifyPassword(config.adminPassword, existing.password_hash))
    ) {
      db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(
        await hashPassword(config.adminPassword),
        existing.id
      );
      logger.info("admin_password_synced", { username: config.adminUsername });
      console.log(`[setup] Updated the "${config.adminUsername}" password to match backend/.env.`);
    }
    return;
  }

  if (!config.adminPassword) {
    console.log(
      `
[setup] No admin account yet. Set ADMIN_PASSWORD in backend/.env and restart
` +
        `        to create the "${config.adminUsername}" login.
`
    );
    return;
  }
  if (!validatePassword(config.adminPassword)) {
    console.log(`
[setup] ADMIN_PASSWORD is too weak. ${PASSWORD_RULE_MESSAGE}
`);
    return;
  }

  db.prepare("INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)").run(
    config.adminUsername,
    await hashPassword(config.adminPassword),
    Date.now()
  );
  logger.info("admin_account_created", { username: config.adminUsername });
  console.log(`[setup] Created the admin login "${config.adminUsername}".`);
}

/**
 * Takes the port before doing anything else.
 *
 * The order used to be: sync the database with the chain, then listen. So when
 * a second copy was started by accident, it reset the shared database for a
 * new deployment and only then discovered the port was taken — and, because
 * the error was caught by the handler above rather than ending the process, it
 * kept running its indexer in the background while the first copy served
 * requests against a database that had been wiped underneath it. Nothing is
 * touched now until this process knows it is the one serving.
 */
function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, () => resolve(server));
    server.once("error", reject);
  });
}

async function main() {
  // Requests that arrive while the mirror is still catching up get a clear
  // "starting" answer rather than half-synced data. /health stays open so a
  // script waiting for the stack can see the process is alive.
  let ready = false;
  const app = express();
  app.use((req, res, next) => {
    if (ready || req.path === "/health") return next();
    res.status(503).json({ error: "The server is starting up. Try again in a few seconds." });
  });
  app.use(createApp());

  try {
    await listen(app);
  } catch (err) {
    if (err.code === "EADDRINUSE") {
      console.error(
        `
[server] Port ${config.port} is already in use — another copy of the backend is running.
` +
          `         Stop it first (Windows: netstat -ano | findstr :${config.port}, then
` +
          `         taskkill /PID <pid> /F). Nothing was changed.
`
      );
      process.exit(1);
    }
    throw err;
  }

  await ensureAdminAccount();
  await startIndexer();
  ready = true;

  logger.info("server_started", { port: config.port });
  console.log(`[server] ChainProof backend listening on http://localhost:${config.port}`);
}

main().catch((err) => {
  logger.error("fatal_startup_error", { message: err.message, stack: err.stack });
  process.exit(1);
});
