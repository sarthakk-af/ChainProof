/**
 * Keeps one idempotency key alive across retries of the *same* blockchain
 * write, so a lost-response retry (see backend/src/idempotency.js) reuses
 * the original attempt's key instead of looking like a brand-new request.
 *
 * `ref` is a useRef holding { signature, key } | null. Passing the same
 * `signature` (e.g. a JSON string of the form's current field values) as
 * last time returns the same key; a changed signature — the user actually
 * edited something — mints a fresh one, since that's a genuinely different action.
 */
export function getIdempotencyKey(ref, signature) {
  if (ref.current?.signature === signature) return ref.current.key;
  const key = crypto.randomUUID();
  ref.current = { signature, key };
  return key;
}
