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
import { adminAuth } from "./middleware/adminAuth.js";
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
  app.use("/students", studentsRouter);
  app.use("/public", publicRouter);

  // Custodial-account actions — require a user's own JWT.
  app.use("/me", userAuth, meRouter);
  app.use("/credentials", userAuth, credentialsRouter);
  app.use("/visits", userAuth, visitsRouter);

  // Platform-admin verification queue — separate shared-secret auth (Phase 2).
  app.use("/admin", adminAuth, adminRouter);

  // Safety net: catches anything a route's own try/catch missed, so one bad
  // request returns a clean 500 instead of taking the whole process down.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logger.error("unhandled_route_error", {
      method: req.method,
      path: req.originalUrl,
      message: err.message,
      stack: err.stack,
    });
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
