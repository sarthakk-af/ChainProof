/**
 * DriveDescription.jsx — a drive's job description, folded away until asked for.
 *
 * Folded because it sits inside lists of drives, where the terms are what a
 * reader scans first. Renders nothing when there is no description.
 */

import React from "react";

export default function DriveDescription({ text, open = false }) {
  if (!text) return null;
  return (
    <details className="drive-description" open={open}>
      <summary>Job description</summary>
      <p>{text}</p>
    </details>
  );
}
