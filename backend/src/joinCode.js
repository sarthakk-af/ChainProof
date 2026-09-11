import crypto from "node:crypto";

// Excludes visually ambiguous characters (0/O, 1/I/L) — this gets read off a
// screen and retyped by a student, so every character needs to be
// unambiguous out loud and on screen.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

export function generateJoinCode() {
  let code = "";
  for (let i = 0; i < LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

/** Matching ignores case and stray whitespace — the code itself is what has to be exact. */
export function normalizeJoinCode(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}
