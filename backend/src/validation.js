export const noEmojis = (str) => {
  // A number is text that happens to arrive unquoted — a roll number or phone
  // from a spreadsheet, say. Treating it as empty turned a valid value into a
  // "wrong format" error.
  if (typeof str === "number" && Number.isFinite(str)) str = String(str);
  if (typeof str !== "string") return "";
  return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
};

export const alphanumericOnly = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/[^a-zA-Z0-9]/g, "");
};

export const numbersOnly = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/[^0-9]/g, "");
};

export const cleanText = (str) => {
  if (typeof str !== "string") return "";
  return noEmojis(str).trim();
};
