/**
 * SectionIntro.jsx — one line at the top of a section saying what it is for
 * and what to do there.
 *
 * Every tab used to open straight onto a form or a list, which assumed the
 * reader already knew what the placement process asks of them at that step.
 */

import React from "react";
import { Info } from "lucide-react";

export default function SectionIntro({ children }) {
  return (
    <p className="section-intro">
      <Info size={14} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
