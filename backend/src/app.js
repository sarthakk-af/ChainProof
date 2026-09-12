import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { collegesRouter } from "./routes/colleges.js";
import { studentsRouter } from "./routes/students.js";
import { publicRouter } from "./routes/public.js";
import { credentialsRouter } from "./routes/credentials.js";
import { visitsRouter } from "./routes/visits.js";
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

  // Public — no auth (signup/login themselves, and public read endpoints).
  app.use("/auth", authRouter);
  app.use("/colleges", collegesRouter);
  // Personal data about identifiable students — never anonymous. See
  // routes/students.js for who may see what.
  app.use("/students", userAuth, studentsRouter);
  app.use("/public", publicRouter);

  // Custodial-account actions — require a user's own JWT.
  app.use("/me", userAuth, meRouter);
  app.use("/credentials", userAuth, credentialsRouter);
  app.use("/visits", userAuth, visitsRouter);

  // Platform-admin verification queue — auth is applied per-route inside
  // adminRouter itself: the shared secret only bootstraps new admin
  // accounts, while the actual queue actions require a per-admin session
  // (see middleware/adminSessionAuth.js and routes/admin.js).
  app.use("/admin", adminRouter);

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
