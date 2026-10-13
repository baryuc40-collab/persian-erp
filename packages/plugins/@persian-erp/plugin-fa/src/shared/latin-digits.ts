// Persian (U+06F0-06F9) and Arabic-Indic (U+0660-0669) digits typed or pasted by users are stored as Latin digits, so
// numbers parse, sort and search the same way whatever keyboard was used (STORY-052). Persian pages still show them
// with Persian shapes through the Vazirmatn FD font (STORY-051).

export function hasNonLatinDigits(text: string) {
  return /[۰-۹٠-٩]/.test(text);
}

// Both ranges start at a code point ending in 0, so the low four bits are the digit.
export function toLatinDigits(text: string) {
  return text.replace(/[۰-۹٠-٩]/g, (d) => String(d.charCodeAt(0) & 0xf));
}

// For number fields: also the Arabic decimal separator (U+066B, ٫) and thousands separator (U+066C, ٬).
export function toLatinNumber(text: string) {
  return toLatinDigits(text).replace(/٫/g, '.').replace(/٬/g, ',');
}
