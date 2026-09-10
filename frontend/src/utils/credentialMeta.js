import { FileText, Star, Mic, Trophy, X } from "lucide-react";

/** Shared between CredentialTimeline and ProofGenerator (both display credType). */
export const CRED_TYPE_META = {
  General: { label: "General", cls: "cred-general", badgeCls: "badge-college", Icon: FileText },
  Shortlist: { label: "Shortlisted", cls: "cred-shortlist", badgeCls: "badge-warning", Icon: Star },
  Interview: { label: "Interviewed", cls: "cred-interview", badgeCls: "badge-student", Icon: Mic },
  Offer: { label: "Offer", cls: "cred-offer", badgeCls: "badge-success", Icon: Trophy },
  Rejection: { label: "Rejection", cls: "cred-rejection", badgeCls: "badge-danger", Icon: X },
};

export { formatTimestamp } from "./format.js";

/** Same badge colors as CRED_TYPE_META, keyed just by name — for places that only need the badge class. */
export const STAGE_BADGE = Object.fromEntries(
  Object.entries(CRED_TYPE_META).map(([key, meta]) => [key, meta.badgeCls])
);
