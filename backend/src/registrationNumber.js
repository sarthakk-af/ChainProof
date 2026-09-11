/**
 * registrationNumber.js — Validates the one concrete, externally-checkable
 * identifier a College/Company gives at registration, so an admin has more
 * to weigh than a name and an optional website (see FLOW_AUDIT.md gap #4).
 *
 * A Company's CIN (Corporate Identification Number) has a real, fixed
 * structure defined by India's Ministry of Corporate Affairs, so that one
 * can actually be format-validated, not just checked for "not empty". A
 * College's accreditation ID has no single universal format across AICTE,
 * UGC, state boards, and individual universities, so that one only gets a
 * sanity check on length and character set — the admin still has to
 * actually look it up, but now there's something concrete to look up.
 */

// L/U + 5-digit industry code + 2-letter state code + 4-digit year +
// 3-letter ownership type (PLC/PTC/OPC/GOI/NPL/...) + 6-digit registration
// number = 21 characters total. e.g. L12345MH2020PLC123456
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

export function validateRegistrationNumber(role, rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim().toUpperCase() : "";

  if (role === "Company") {
    if (!value) {
      return { error: "CIN (Corporate Identification Number) is required for companies." };
    }
    if (!CIN_RE.test(value)) {
      return {
        error:
          "That doesn't look like a valid CIN — expected a format like L12345MH2020PLC123456 (21 characters).",
      };
    }
    return { value };
  }

  if (role === "College") {
    if (!value) {
      return { error: "An institution registration/accreditation ID is required for colleges." };
    }
    if (value.length < 4 || value.length > 50) {
      return { error: "Registration ID must be between 4 and 50 characters." };
    }
    if (!/^[A-Z0-9/\-. ]+$/.test(value)) {
      return { error: "Registration ID can only contain letters, numbers, spaces, and /.- " };
    }
    return { value };
  }

  return { value: "" };
}
