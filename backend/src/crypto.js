import crypto from "node:crypto";
import { config } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV size for GCM

function getKey() {
  const key = Buffer.from(config.walletEncryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error(
      "WALLET_ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex characters)."
    );
  }
  return key;
}

/**
 * Encrypts a plaintext string (a wallet private key). Returns "iv:authTag:ciphertext",
 * all hex-encoded, so it can be stored as a single TEXT column.
 */
export function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

/** Reverses `encrypt`. Throws if the ciphertext was tampered with or the key is wrong. */
export function decrypt(payload) {
  const [ivHex, authTagHex, ciphertextHex] = payload.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
