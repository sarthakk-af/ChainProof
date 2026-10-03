/**
 * PM2 process file for the backend.
 *
 *   pm2 start deploy/ecosystem.config.cjs
 *
 * One instance, never more. The backend keeps each wallet's transaction queue
 * in memory and writes to a single SQLite file; two copies would hand out the
 * same nonce twice and race each other's writes. PM2's "cluster" mode, or
 * `instances` above 1, breaks it.
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "chainproof-backend",
      cwd: path.resolve(__dirname, "../backend"),
      // Through npm, so PM2 runs `node src/server.js` exactly as `npm start`
      // does. The backend is an ES module with top-level await, which PM2's
      // own loader does not always start cleanly.
      script: "npm",
      args: "start",
      exec_mode: "fork",
      instances: 1,
      env: { NODE_ENV: "production" },
      // Restarts after a crash, but not in a tight loop: a missing setting or
      // an undeployed contract makes it exit at once, and its log says why.
      restart_delay: 5000,
      max_restarts: 10,
      // A t2/t3.micro has 1 GB; this is far above what the backend uses.
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
