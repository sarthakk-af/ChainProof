import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { collegeRouter } from "./routes/college.js";
import { publicRouter } from "./routes/public.js";
import { drivesRouter } from "./routes/drives.js";
import { outcomesRouter } from "./routes/outcomes.js";
import { announcementsRouter } from "./routes/announcements.js";
import { directoryRouter } from "./routes/directory.js";
import { talentRouter } from "./routes/talent.js";
import { userAuth } from "./middleware/userAuth.js";

/**
 * Express app definition only — no indexer startup, no `listen()` call, so it
 * can be imported directly by tests without spinning up the live event
 * subscription. `server.js` is the actual process entrypoint.
 */
export function createApp() {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  // General-purpose request visibility — every request, not just the ones we
  // thought in advance to instrument.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("request", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  app.get("/", (_req, res) => {
    res.json({ status: "chainproof-backend" });
  });

  /**
   * Chain connectivity and treasury state. Deliberately unauthenticated — it
   * reveals nothing beyond "the chain is up and the service wallet can still
   * fund signups", and both are things you want to see before they stop
   * working rather than after.
   */
  app.get("/health", async (_req, res) => {
    try {
      const { provider } = await import("./chain.js");
      const { getTreasuryBalance, treasuryAddress } = await import("./treasury.js");
      const [blockNumber, treasuryBalanceEth] = await Promise.all([
        provider.getBlockNumber(),
        getTreasuryBalance(),
      ]);
      const drip = Number(config.walletGasDripEth);
      const balance = Number(treasuryBalanceEth);
      const remainingSignups = drip > 0 ? Math.floor(balance / drip) : null;
      res.json({
        status: "ok",
        blockNumber,
        treasury: {
          address: treasuryAddress,
          balanceEth: treasuryBalanceEth,
          approxSignupsRemaining: remainingSignups,
          low: remainingSignups !== null && remainingSignups < 10,
        },
      });
    } catch (err) {
      res.status(503).json({ status: "error", error: err.message });
    }
  });

  // Public — no auth (signup/login themselves, and public read endpoints).
  app.use("/auth", authRouter);
  // The platform owner. Small on purpose — it creates the college and reports
  // system health, and deliberately cannot post drives or record outcomes.
  app.use("/admin", adminRouter);
  app.use("/public", publicRouter);

  // Custodial-account actions — require a user's own JWT.
  app.use("/me", userAuth, meRouter);
  // The college account is the administrator in v2 — there is no separate admin
  // panel and no shared secret. college.js gates every route on an Active
  // College itself.
  app.use("/college", userAuth, collegeRouter);
  app.use("/drives", userAuth, drivesRouter);
  app.use("/outcomes", userAuth, outcomesRouter);
  // Placement notices — the college and its approved companies post, everyone
  // signed in reads. The only editable surface here; see routes/announcements.js.
  app.use("/announcements", userAuth, announcementsRouter);
  // Students looking each other up, by roll number AND email.
  app.use("/students", userAuth, directoryRouter);
  // A company browsing the college's students, anonymised until they apply.
  app.use("/talent", userAuth, talentRouter);

  // Safety net: catches anything a route's own try/catch missed, so one bad
  // request returns a clean error instead of taking the whole process down.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (res.headersSent) return;

    // express.json() throws for a body it can't parse or one that's too big.
    // Those are the *client's* mistake, and reporting them as 500s did real
    // damage: monitoring couldn't tell a genuine outage from someone posting
    // junk, and every malformed request wrote a full stack trace to the log —
    // so anyone could flood it at will, just by sending "{".
    const clientBodyErrors = {
      "entity.parse.failed": [400, "Malformed JSON in request body."],
      "entity.too.large": [413, "Request body is too large."],
      "encoding.unsupported": [415, "Unsupported content encoding."],
      "request.aborted": [400, "Request aborted."],
    };
    const known = clientBodyErrors[err.type];
    if (known || err instanceof SyntaxError) {
      const [status, message] = known || [400, "Malformed JSON in request body."];
      logger.warn("bad_request_body", {
        method: req.method,
        path: req.originalUrl,
        type: err.type || "syntax_error",
      });
      return res.status(status).json({ error: message });
    }

    // Anything else really is ours — keep the stack.
    logger.error("unhandled_route_error", {
      method: req.method,
      path: req.originalUrl,
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
