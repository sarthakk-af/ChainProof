/**
 * db.js — Re-export barrel.
 *
 * The actual implementation lives in ./db/, split by domain (actors, users,
 * roster, profiles, drives, outcomes, resumes, notices, preparation, and so
 * on) instead of one file mixing unrelated concerns. Kept as a thin barrel here — rather than moving
 * every call site to "./db/index.js" — so nothing importing "./db.js" (or
 * "../db.js") anywhere in routes, the indexer, or the tests needs to change.
 */
export * from "./db/index.js";
