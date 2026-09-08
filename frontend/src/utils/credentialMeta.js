/** Shared between CredentialTimeline and ProofGenerator (both display credType). */
export const CRED_TYPE_META = {
  General: { label: "General", icon: "📄", cls: "cred-general", badgeCls: "badge-college" },
  Shortlist: { label: "Shortlisted", icon: "⭐", cls: "cred-shortlist", badgeCls: "badge-warning" },
  Interview: { label: "Interviewed", icon: "🎙️", cls: "cred-interview", badgeCls: "badge-student" },
  Offer: { label: "Offer", icon: "🎉", cls: "cred-offer", badgeCls: "badge-success" },
  Rejection: { label: "Rejection", icon: "❌", cls: "cred-rejection", badgeCls: "badge-danger" },
};

export { formatTimestamp } from "./format.js";

/** Same badge colors as CRED_TYPE_META, keyed just by name — for places that only need the badge class. */
export const STAGE_BADGE = Object.fromEntries(
  Object.entries(CRED_TYPE_META).map(([key, meta]) => [key, meta.badgeCls])
);
