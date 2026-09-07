/** Shared between CredentialTimeline and ProofGenerator (both display credType). */
export const CRED_TYPE_META = {
  General: { label: "General", icon: "📄", cls: "cred-general", badgeCls: "badge-college" },
  Shortlist: { label: "Shortlisted", icon: "⭐", cls: "cred-shortlist", badgeCls: "badge-warning" },
  Interview: { label: "Interviewed", icon: "🎙️", cls: "cred-interview", badgeCls: "badge-student" },
  Offer: { label: "Offer", icon: "🎉", cls: "cred-offer", badgeCls: "badge-success" },
  Rejection: { label: "Rejection", icon: "❌", cls: "cred-rejection", badgeCls: "badge-danger" },
};

export function formatTimestamp(ts) {
  return new Date(Number(ts) * 1000).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
