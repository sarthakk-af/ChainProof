import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Throttles the handful of endpoints that broadcast a transaction.
 *
 * Everything else a logged-in user can do is a read. These are the only calls
 * that spend real money — each one pays gas out of the treasury wallet, and
 * the custodial-wallet design means the user never feels that cost, so nothing
 * naturally discourages hammering them. On a local Hardhat node the accounts
 * hold thousands of test ETH and the problem is invisible; on a real network
 * the treasury is a fixed balance that a loop could drain in minutes.
 *
 * Keyed by the authenticated user rather than by IP: an entire college behind
 * one NAT would otherwise throttle its own students. Falls back to the IP for
 * anything unauthenticated that slips through, using the library's own helper
 * so an IPv6 client can't trivially rotate addresses within its own /64.
 *
 * The limits are deliberately generous — well past what genuine use needs, low
 * enough to make automated abuse pointless.
 */
function byUser(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.address || ipKeyGenerator(req.ip),
    message: { error: message },
  });
}

// Registering is once-per-lifetime for most accounts; the allowance exists
// only so a rejected applicant can resubmit a few times.
export const registerLimiter = byUser(
  60 * 60 * 1000,
  10,
  "Too many registration attempts. Please try again later."
);

// A college issuing results at the end of a term is the heaviest genuine use
// of this endpoint, so the ceiling has to clear a realistic batch.
export const issueLimiter = byUser(
  60 * 60 * 1000,
  200,
  "Too many credentials issued in a short period. Please wait a few minutes and try again."
);

// A college entering a term's preparation record in one sitting — twenty
// training sessions, mock interviews and workshops — is the heaviest genuine
// use here, and it happens in one burst rather than spread through the year.
// These were briefly throttled by registerLimiter, which allowed ten an hour
// and refused the eleventh with "too many registration attempts" — the wrong
// ceiling and a message describing something the college was not doing.
export const recordLimiter = byUser(
  60 * 60 * 1000,
  100,
  "Too many records in a short period. Please wait a few minutes and try again."
);

// Announcements are occasional by nature — a placement cell posts a handful a
// week, not hundreds.
export const announceLimiter = byUser(
  60 * 60 * 1000,
  50,
  "Too many visit announcements in a short period. Please wait a few minutes and try again."
);
