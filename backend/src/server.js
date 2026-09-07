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

async function main() {
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
