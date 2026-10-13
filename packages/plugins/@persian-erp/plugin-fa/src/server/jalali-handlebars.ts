// A Handlebars helper for Jalali dates in notification messages (STORY-050):
//
//   {{jalali $context.data.createdAt}}                         1405/07/20
//   {{jalali $context.data.createdAt "D MMMM YYYY، HH:mm"}}    20 مهر 1405، 14:30
//   {{jalali $context.data.createdAt "YYYY/MM/DD" tz="+00:00"}}
//
// plugin-notification-manager compiles message templates with the Handlebars instance of @nocobase/utils, which
// every plugin shares. Messages are sent without a user's request, so the timezone comes from the `tz` option and
// defaults to Iran's.

import { dayjs, Handlebars } from '@nocobase/utils';
import { jalaliFormat } from '../shared/jalali-format';

export const DEFAULT_TIMEZONE = 'Asia/Tehran';
export const DEFAULT_FORMAT = 'YYYY/MM/DD';

/** The utc offset in minutes of `timezone` (an offset like '+03:30' or an IANA name) at `instant`. */
export function offsetMinutes(timezone: string, instant: Date): number {
  const match = /^([+-])(\d{1,2}):?(\d{2})$/.exec(timezone);
  if (match) {
    return (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((local - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Formats a date in the Jalali calendar with a dayjs format, in the given timezone. */
export function formatJalaliDate(value: unknown, format = DEFAULT_FORMAT, timezone = DEFAULT_TIMEZONE): string {
  if (value === null || value === undefined || value === '') return '';
  const instant = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(instant.getTime())) return String(value);
  let offset = 0;
  try {
    offset = offsetMinutes(timezone, instant);
  } catch (error) {
    // An unknown timezone name: fall back to UTC rather than failing the whole message.
  }
  const local = dayjs(instant).utcOffset(offset);
  return local.format(jalaliFormat(format, local.year(), local.month() + 1, local.date()));
}

export function registerJalaliHelper() {
  Handlebars.registerHelper('jalali', function (value: unknown, ...args: any[]) {
    // Handlebars passes its options object last; the format is the optional positional argument before it.
    const options = args.pop();
    const format = typeof args[0] === 'string' ? args[0] : DEFAULT_FORMAT;
    const tz = typeof options?.hash?.tz === 'string' ? options.hash.tz : DEFAULT_TIMEZONE;
    return formatJalaliDate(value, format, tz);
  });
}
