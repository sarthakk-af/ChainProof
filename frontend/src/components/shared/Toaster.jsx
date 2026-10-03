/**
 * Toaster.jsx — draws the toast messages raised through utils/toast.js.
 *
 * Mounted once at the top of the app. Toasts sit in the bottom corner, out of
 * the way of whatever the person was doing, and are announced to screen
 * readers: errors immediately, everything else politely.
 */

import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { subscribeToToasts, toast } from "../../utils/toast.js";

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => subscribeToToasts(setItems), []);

  return (
    <div className="toaster" aria-live="polite" aria-relevant="additions">
      {items.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "loading" ? <span className="spinner toast-spinner" aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
            <span className="toast-message">{t.message}</span>
            {t.kind !== "loading" && (
              <button type="button" className="toast-close" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
