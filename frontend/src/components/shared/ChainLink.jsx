/**
 * ChainLink.jsx — a small "View on blockchain" link next to a record.
 *
 * Renders nothing when the record's transaction isn't known, or when the
 * network has no public explorer (a local test chain): a link that leads
 * nowhere is worse than none.
 */

import React from "react";
import { ExternalLink } from "lucide-react";
import { useExplorer, txUrl } from "../../utils/chain.js";

export default function ChainLink({ tx, label = "View on blockchain" }) {
  const explorer = useExplorer();
  const href = txUrl(explorer, tx);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="chain-link"
      title="Opens this record's transaction on Polygonscan, a public site ChainProof doesn't control"
    >
      ⛓ {label} <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}
