// Which digits Persian users see. Persian digits are drawn by the Vazirmatn FD font, which renders the Latin digits
// of the page with Persian shapes: the text itself, and so copy, search, export and the API, keeps Latin digits
// (EPIC-012). The choice is kept in the browser, like the calendar (jalali/calendar.ts).

export const DIGITS_STORAGE_KEY = 'PERSIAN_ERP_DIGITS';

export type DigitsName = 'persian' | 'latin';

export function getDigitsPreference(): DigitsName | undefined {
  try {
    const value = window.localStorage.getItem(DIGITS_STORAGE_KEY);
    return value === 'persian' || value === 'latin' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setDigitsPreference(value: DigitsName) {
  try {
    window.localStorage.setItem(DIGITS_STORAGE_KEY, value);
  } catch {
    // Storage can be blocked (private windows); the default digits stay in use.
  }
}

/** Persian digits unless the user chose Latin ones; only asked for Persian pages. */
export function usesPersianDigits(): boolean {
  return getDigitsPreference() !== 'latin';
}
