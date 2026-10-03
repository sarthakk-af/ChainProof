/**
 * Utility functions for input validation.
 */

// Retains only numeric characters
export const numbersOnly = (str) => str.replace(/\D/g, '');

// Strips emojis and extended pictographics
export const noEmojis = (str) => str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

// Retains only alphanumeric characters
export const alphanumericOnly = (str) => str.replace(/[^a-zA-Z0-9]/g, '');

// The characters each identifier may hold — the same rules the backend applies
// (backend/src/studentProfile.js and registrationNumber.js). Filtering a field
// to fewer characters than the backend accepts silently changes what the user
// meant: "21-CE-1042" became "21CE1042", which matches no roster row.

// Roll numbers: letters, digits, / and -
export const rollNumberChars = (str) => str.replace(/[^a-zA-Z0-9/-]/g, '').toUpperCase();

// Course codes: letters, digits and -, e.g. MECH-B
export const courseCodeChars = (str) => str.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase();

// Institution registration IDs: letters, digits, spaces and / - .
export const registrationIdChars = (str) => str.replace(/[^a-zA-Z0-9/. -]/g, '').toUpperCase();

