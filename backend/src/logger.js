/**
 * logger.js — Minimal structured logging.
 *
 * Deliberately not a logging framework — this project doesn't need one yet,
 * and a plain implementation is easier to read and change than learning a
 * library's config surface. Every line is one JSON object, timestamped and
 * leveled, so it's still easy to grep/pipe into something fancier later if
 * this ever needs it.
 */

function write(level, event, data) {
  const line = {
    time: new Date().toISOString(),
    level,
    event,
    ...(data ? { data } : {}),
  };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info: (event, data) => write("info", event, data),
  warn: (event, data) => write("warn", event, data),
  error: (event, data) => write("error", event, data),
};
