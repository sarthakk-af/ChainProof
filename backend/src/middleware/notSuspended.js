/**
 * notSuspended.js — the one check for "this account's access was withdrawn".
 *
 * Suspension is the whole of the platform owner's authority over other
 * people's accounts, and several routes enforced ownership without it: a
 * suspended company could still rewrite its published notices, and a suspended
 * student could still edit the profile and resume that recruiters read.
 *
 * Deliberately permissive about accounts with no on-chain identity yet. A
 * student filling in their profile before being registered has no actor row,
 * and refusing them here would put back the wall the verification work removed.
 */

import { getActor } from "../db.js";
import { STATUS } from "../chain.js";

/** @returns {boolean} true to carry on; false once a 403 has been sent. */
export function requireNotSuspended(req, res) {
  const actor = getActor(req.user.address);
  if (actor && actor.status === STATUS.Suspended) {
    res.status(403).json({
      error: "This account is suspended, so it can't change anything. Nothing it already recorded has changed.",
    });
    return false;
  }
  return true;
}
