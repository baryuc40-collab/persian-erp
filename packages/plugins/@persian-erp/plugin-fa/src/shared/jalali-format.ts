// Formatting and parsing Jalali dates without a Jalali dayjs (STORY-043): the server formats field values with the
// field's own dayjs format, and only the year, month and day tokens are swapped for their Jalali values.

import { dayToJalali, jalaliToDay } from './jalali-ranges';

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Days since 1970-01-01 of a Gregorian calendar date. */
export const gregorianDay = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / 86400000;

/**
 * A dayjs format with the date tokens (YYYY, YY, MMMM, MMM, MM, M, DD, D) replaced by the Jalali values of the
 * Gregorian calendar date `year-month-day`, as escaped literals; time tokens are left to dayjs.
 */
export function jalaliFormat(format: string, year: number, month: number, day: number): string {
  const { jy, jm, jd } = dayToJalali(gregorianDay(year, month, day));
  const tokens: Record<string, string> = {
    YYYY: String(jy),
    YY: pad(jy % 100),
    MMMM: JALALI_MONTHS[jm - 1],
    MMM: JALALI_MONTHS[jm - 1],
    MM: pad(jm),
    M: String(jm),
    DD: pad(jd),
    D: String(jd),
  };
  // Bracketed text is already literal; Do (ordinal day) has no Persian form and is left to dayjs.
  return format.replace(/\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|D(?!o)/g, (match) =>
    match.startsWith('[') ? match : `[${tokens[match]}]`,
  );
}

const JALALI_DATE = /^(1[2-5]\d\d)[-/.](\d{1,2})[-/.](\d{1,2})(?=$|[\sT])/;

/**
 * The same text with a leading Jalali date (years 1200 to 1599, e.g. `1405/07/20 14:30`) rewritten as the Gregorian
 * `2026-10-12`; anything else is returned unchanged.
 */
export function jalaliTextToGregorian(text: string): string {
  const match = JALALI_DATE.exec(text.trim());
  if (!match) return text;
  const [whole, jy, jm, jd] = match;
  const days = jalaliToDay(Number(jy), Number(jm), Number(jd));
  // Out-of-range months and days (13/01, 07/31, 30 Esfand of a common year) do not survive the round trip.
  const back = dayToJalali(days);
  if (back.jy !== Number(jy) || back.jm !== Number(jm) || back.jd !== Number(jd)) return text;
  const date = new Date(days * 86400000);
  const gregorian = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return gregorian + text.trim().slice(whole.length);
}
