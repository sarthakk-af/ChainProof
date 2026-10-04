/**
 * toast.js — short pop-up messages that confirm an action or say what is
 * happening, from anywhere in the app.
 *
 * A plain store rather than React context, so code outside components — the
 * API helper, which knows when a request is slow — can raise one too. The
 * <Toaster /> component subscribes and draws them.
 *
 *   toast.success("Drive posted.")
 *   toast.error("Couldn't reach the server.")
 *   const id = toast.loading("Recording on the blockchain…"); … toast.dismiss(id)
 *
 * Errors that need reading and acting on stay as banners on the page; a toast
 * is for "that worked" and "still working", which only need a glance.
 */

const MAX_VISIBLE = 4;
const DURATION_MS = { success: 4500, info: 6000, error: 8000 };

let items = [];
let nextId = 1;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener(items);
}

/** Calls `listener(items)` now and on every change. Returns the unsubscribe. */
export function subscribeToToasts(listener) {
  listeners.add(listener);
  listener(items);
  return () => listeners.delete(listener);
}

function dismiss(id) {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

/**
 * @param {Object} [options]
 * @param {number} [options.duration] ms before it goes; 0 keeps it until dismissed.
 * @param {{href: string, label: string}} [options.link] an external link shown
 *        after the message — e.g. a transaction on the block explorer.
 */
function push(kind, message, { duration, link } = {}) {
  if (!message) return null;
  const id = nextId++;
  // The same message twice in a row is one message: a double click shouldn't
  // stack two identical pop-ups.
  items = [...items.filter((t) => t.message !== message), { id, kind, message, link }].slice(-MAX_VISIBLE);
  emit();
  const ms = duration ?? DURATION_MS[kind];
  if (ms) setTimeout(() => dismiss(id), ms);
  return id;
}

export const toast = {
  success: (message, options) => push("success", message, options),
  info: (message, options) => push("info", message, options),
  error: (message, options) => push("error", message, options),
  /** Stays until dismissed — pair it with toast.dismiss(id) when the work ends. */
  loading: (message) => push("loading", message, { duration: 0 }),
  dismiss,
};
