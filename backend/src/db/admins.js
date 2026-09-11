import { db } from "./connection.js";

export function createAdmin({ username, passwordHash }) {
  const result = db
    .prepare("INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, passwordHash, Date.now());
  return getAdminById(result.lastInsertRowid);
}

export function getAdminByUsername(username) {
  return db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
}

export function getAdminById(id) {
  return db.prepare("SELECT * FROM admins WHERE id = ?").get(id);
}

/** Never returns password_hash — this is for display (e.g. "who has admin access"), not auth. */
export function listAdmins() {
  return db.prepare("SELECT id, username, created_at FROM admins ORDER BY created_at ASC").all();
}
