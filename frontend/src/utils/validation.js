/**
 * Utility functions for input validation.
 */

// Retains only numeric characters
export const numbersOnly = (str) => str.replace(/\D/g, '');

// Strips emojis and extended pictographics
export const noEmojis = (str) => str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

// Retains only alphanumeric characters
export const alphanumericOnly = (str) => str.replace(/[^a-zA-Z0-9]/g, '');

// Retains only alphanumeric characters, spaces, and basic punctuation
export const cleanText = (str) => noEmojis(str).replace(/[<>{}|[\]\\]/g, '');
