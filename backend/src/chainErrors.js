/**
 * chainErrors.js — what a failed on-chain write is allowed to tell the client.
 *
 * Routes used to answer with `err.reason || err.shortMessage || err.message`,
 * whatever that happened to be. Two of those leak: a dry treasury reported its
 * own address and balance to any signed-in user ("Treasury has 0.04 ETH left —
 * top up 0x…"), and a wallet that could not be decrypted reported OpenSSL's
 * internals. A revert reason from the contract is genuinely useful and stays.
 */

import { TreasuryExhaustedError } from "./treasury.js";

/** True when the operator, not the user, has to do something about it. */
export function isOperatorProblem(err) {
  return (
    err instanceof TreasuryExhaustedError ||
    /No such user|bad decrypt|unsupported state|Unsupported state/i.test(err?.message ?? "")
  );
}

/**
 * The message to send back. Contract reverts pass through — they say which rule
 * was broken, which is exactly what the user needs — and anything internal is
 * replaced with something true but uninformative.
 */
export function publicChainError(err) {
  if (err instanceof TreasuryExhaustedError) {
    return "The service wallet that pays for on-chain writes needs topping up. Please try again later.";
  }
  if (isOperatorProblem(err)) {
    return "Something went wrong signing that transaction. Please try again.";
  }
  return err?.reason || err?.shortMessage || err?.message || "The transaction failed.";
}
