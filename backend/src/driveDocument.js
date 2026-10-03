/**
 * driveDocument.js — the full job description behind a drive, and its hash.
 *
 * A drive's terms that matter for eligibility (package, cutoff, dates) are
 * on-chain. The rest of what a company says about the role lives in a document
 * whose content hash is written on-chain beside them, so the document can be
 * shown from this database and still be checked against the chain: hash the
 * text you were shown, and it either matches the drive's record or it doesn't.
 *
 * This used to be done in the browser, which pinned the document to IPFS
 * through Pinata. That shipped the Pinata key to every visitor, and without
 * the key — the default — the description was thrown away entirely and a
 * random string shaped like a hash was written on-chain in its place: a
 * permanent pointer to nothing. Nothing ever displayed the description either.
 *
 * The hash is a CIDv1 (raw codec, sha2-256), the same identifier
 * `ipfs add --cid-version=1 --raw-leaves` gives a file this small, so the
 * document can be pinned to IPFS later without the on-chain record changing.
 */

import crypto from "node:crypto";

export const MAX_DESCRIPTION_BYTES = 4000;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, lower case, no padding — the multibase "b" encoding. */
function base32(bytes) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/** The CIDv1 (raw, sha2-256) of some bytes, as a "b…" string. */
export function cidFor(content) {
  const digest = crypto.createHash("sha256").update(content).digest();
  // version 1, codec raw (0x55), multihash sha2-256 (0x12) of 32 bytes (0x20)
  const cid = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
  return "b" + base32(cid);
}

/**
 * Tidies a description without flattening it: paragraphs survive, control
 * characters and runs of blank lines do not.
 * @returns {{value: string|null}|{error: string}}
 */
export function parseDescription(raw) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { error: "The description must be text." };
  const value = raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (value === "") return { value: null };
  if (Buffer.byteLength(value, "utf8") > MAX_DESCRIPTION_BYTES) {
    return { error: `The description must be ${MAX_DESCRIPTION_BYTES} bytes or fewer.` };
  }
  return { value };
}

/**
 * The document for one drive, and its hash.
 *
 * Holds the drive's terms as well as the description, so the document stands
 * on its own. The key order is fixed, which makes the bytes — and so the hash —
 * the same every time for the same drive.
 */
export function buildDriveDocument({
  roleTitle,
  annualPackage,
  minCgpaScaled,
  batchYear,
  applicationDeadline,
  driveDate,
  description,
}) {
  const content = JSON.stringify({
    schema: "chainproof-drive-v1",
    roleTitle,
    annualPackage,
    minCgpa: minCgpaScaled / 100,
    batchYear,
    applicationDeadline,
    driveDate,
    description: description ?? null,
  });
  return { content, cid: cidFor(content) };
}
