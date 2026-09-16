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
  const { hashPassword, validatePassword, PASSWORD_RULE_MESSAGE } = await import("./auth.js");

  const existing = db.prepare("SELECT id FROM admins WHERE username = ?").get(config.adminUsername);
  if (existing) return;

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

async function main() {
  await ensureAdminAccount();
  await startIndexer();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info("server_started", { port: config.port });
    console.log(`[server] ChainProof backend listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  logger.error("fatal_startup_error", { message: err.message, stack: err.stack });
  process.exit(1);
});
