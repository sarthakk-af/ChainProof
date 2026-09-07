import { ethers } from "ethers";
import { provider } from "./chain.js";
import { encrypt, decrypt } from "./crypto.js";
import { getUserById } from "./db.js";

/** Generates a brand-new wallet for a user. Does not persist it — callers store the result. */
export function generateWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    encryptedPrivateKey: encrypt(wallet.privateKey),
  };
}

/**
 * Decrypts a user's private key just long enough to build a connected signer.
 * Callers should let it go out of scope immediately after use — nothing here
 * keeps a decrypted key around longer than a single request.
 */
export function getUserSigner(userId) {
  const user = getUserById(userId);
  if (!user) {
    throw new Error(`No such user: ${userId}`);
  }
  const privateKey = decrypt(user.encrypted_private_key);
  return new ethers.Wallet(privateKey, provider);
}
