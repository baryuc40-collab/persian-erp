// Which calendar dates are shown and picked in. Persian users get Jalali unless they chose Gregorian in the user
// menu, or the administrator made Gregorian the system's default (STORY-048); everyone else keeps Gregorian. The
// user's choice is kept in the browser, like NocoBase keeps the UI language.

import dayjs, { Dayjs } from 'dayjs';
import { installJalali } from './dayjs';

let languageSource: () => string | undefined = () => undefined;

/** Tells the calendar helpers where the current UI language comes from (the app's i18n instance). */
export function setCalendarLanguageSource(source: () => string | undefined) {
  languageSource = source;
}

export const CALENDAR_STORAGE_KEY = 'PERSIAN_ERP_CALENDAR';

export type CalendarName = 'jalali' | 'gregory';

export function getCalendarPreference(): CalendarName | undefined {
  try {
    const value = window.localStorage.getItem(CALENDAR_STORAGE_KEY);
    return value === 'jalali' || value === 'gregory' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setCalendarPreference(value: CalendarName) {
  try {
    window.localStorage.setItem(CALENDAR_STORAGE_KEY, value);
  } catch {
    // Storage can be blocked (private windows); the default calendar stays in use.
  }
}

let systemCalendar: CalendarName | null = null;

/** The system's default calendar from the server (null when the administrator never set one). */
export function setSystemCalendar(value: CalendarName | null) {
  systemCalendar = value === 'jalali' || value === 'gregory' ? value : null;
}

export function isPersian(language = languageSource()): boolean {
  return (language || '').split(/[-_]/)[0].toLowerCase() === 'fa';
}

export function usesJalali(language = languageSource()): boolean {
  return isPersian(language) && (getCalendarPreference() || systemCalendar || 'jalali') === 'jalali';
}

/** The request header that tells the server side of this plugin to resolve relative dates in Jalali (STORY-042). */
export const CALENDAR_HEADER = 'X-Calendar';

/** Adds the calendar header to a request's headers when the user reads the Jalali calendar. */
export function withCalendarHeader<T extends { headers?: any }>(config: T): T {
  if (usesJalali()) {
    config.headers = config.headers || {};
    config.headers[CALENDAR_HEADER] = 'jalali';
  }
  return config;
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
