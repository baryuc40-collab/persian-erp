// Which calendar dates are shown and picked in. For now Jalali follows the language: Persian users get Jalali,
// everyone else keeps Gregorian. STORY-041 adds a per-user choice on top of this.

import dayjs, { Dayjs } from 'dayjs';
import { installJalali } from './dayjs';

let languageSource: () => string | undefined = () => undefined;

/** Tells the calendar helpers where the current UI language comes from (the app's i18n instance). */
export function setCalendarLanguageSource(source: () => string | undefined) {
  languageSource = source;
}

export function usesJalali(language = languageSource()): boolean {
  return (language || '').split(/[-_]/)[0].toLowerCase() === 'fa';
}

// jalaliday has no Jalali quarters or weeks, so those pickers stay Gregorian.
const JALALI_PICKERS = ['date', 'month', 'year'];

export function isJalaliPicker(picker = 'date') {
  return JALALI_PICKERS.includes(picker);
}

/**
 * The value to hand to NocoBase's own display code so that its format() prints a Jalali date: a Jalali dayjs
 * instance of the same moment, with the Persian locale for month names. Anything else is returned unchanged.
 */
export function toJalaliDisplay<T>(value: T, picker?: string): T | Dayjs {
  if (!usesJalali() || !isJalaliPicker(picker) || value === null || value === undefined || value === '') return value;
  installJalali();
  const date = dayjs.isDayjs(value) ? value : dayjs(value as any);
  return date.isValid() ? date.locale('fa').calendar('jalali') : value;
}
