/**
 * PasswordInput.jsx — the one password field every form uses.
 *
 * Each form used to write its own: the sign-in and reset pages had a
 * show/hide button, the admin screens had a bare input with none. One
 * component means every password box behaves the same.
 *
 * Pass `shown` and `onToggle` to share one show/hide state between two fields
 * (a password and its confirmation); otherwise the field keeps its own.
 * `withToggle={false}` drops the button — for a confirmation field that
 * follows the main one.
 */

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({ shown, onToggle, withToggle = true, style, ...inputProps }) {
  const [ownShown, setOwnShown] = useState(false);
  const visible = shown ?? ownShown;
  const toggle = onToggle ?? (() => setOwnShown((v) => !v));

  return (
    <div className="password-field">
      <input
        {...inputProps}
        type={visible ? "text" : "password"}
        style={withToggle ? { paddingRight: 44, ...style } : style}
      />
      {withToggle && (
        <button
          type="button"
          className="btn btn-ghost btn-sm password-toggle"
          onClick={toggle}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  );
}
