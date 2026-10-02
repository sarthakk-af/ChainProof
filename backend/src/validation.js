export const noEmojis = (str) => {
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
