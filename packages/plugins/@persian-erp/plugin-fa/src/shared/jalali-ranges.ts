// Relative date ranges ("this month", "last quarter", "past 3 years") in the Jalali calendar.
//
// NocoBase resolves relative date filters on the server with Gregorian units (core/utils/src/parse-filter.ts and
// dateRangeUtils.ts). The server side of this plugin swaps them for the ranges below when the request says the user
// reads the Jalali calendar (docs/decisions/0004-jalali-calendar.md, STORY-042). Day-based ranges (today, last 7 days)
// are the same in both calendars and stay with NocoBase.
//
// Ranges are whole local days, so the arithmetic works on calendar dates (day numbers) rather than on dayjs instances:
// jalaliday's startOf() does not keep a utc offset, and the server's offset is not the user's.

export type JalaliUnit = 'week' | 'month' | 'quarter' | 'year';

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

// The arithmetic Jalali calendar, after jalaali-js (MIT, Behrang Noruzi Niya): the years in which the 33-year leap
// cycle breaks.
const BREAKS = [
  -61,
  9,
  38,
  199,
  426,
  686,
  756,
  818,
  1111,
  1181,
  1210,
  1635,
  2060,
  2097,
  2192,
  2262,
  2324,
  2394,
  2456,
  3178,
];

function jalCal(jy: number) {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Days since 1970-01-01 of a Gregorian date. */
const dayOf = (gy: number, gm: number, gd: number) => Date.UTC(gy, gm - 1, gd) / 86400000;

/** Day number of a Jalali date. */
export function jalaliToDay(jy: number, jm: number, jd: number): number {
  const { gy, march } = jalCal(jy);
  return dayOf(gy, 3, march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** Jalali date of a day number. */
export function dayToJalali(day: number): { jy: number; jm: number; jd: number } {
  const gy = new Date(day * 86400000).getUTCFullYear();
  let jy = gy - 621;
  const { leap, march } = jalCal(jy);
  let k = day - dayOf(gy, 3, march);
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 'YYYY-MM-DD' (Gregorian) of a day number. */
export function formatDay(day: number): string {
  const d = new Date(day * 86400000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The local calendar day of `now` in `timezone`: an offset like '+03:30', an IANA name, or UTC when empty. */
export function localDay(timezone?: string | number, now: Date | string | number = new Date()): number {
  const instant = new Date(now).getTime();
  let minutes = 0;
  if (typeof timezone === 'number') {
    minutes = timezone;
  } else if (timezone) {
    const match = /^([+-])(\d{1,2}):?(\d{2})$/.exec(timezone);
    if (match) {
      minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
    } else {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date(instant));
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
        return dayOf(get('year'), get('month'), get('day'));
      } catch (error) {
        minutes = 0;
      }
    }
  }
  return Math.floor((instant + minutes * 60000) / 86400000);
}

/** Day number of the first day of the Jalali month `jm` of `jy`, after adding `months` to it. */
function monthStart(jy: number, jm: number, months: number): number {
  const total = jy * 12 + (jm - 1) + months;
  return jalaliToDay(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1, 1);
}

/**
 * The Jalali unit that holds `today`, moved by `offset` units, as [first day, first day after] day numbers.
 * Weeks run from Saturday to Friday, as in the Iranian calendar.
 */
export function jalaliRange(unit: JalaliUnit, offset: number, today: number): [number, number] {
  if (unit === 'week') {
    // getUTCDay: Sunday is 0 and Saturday is 6, so Saturday is 0 days into the week ... Friday 6.
    const start = today - ((new Date(today * 86400000).getUTCDay() + 1) % 7) + offset * 7;
    return [start, start + 7];
  }
  const { jy, jm } = dayToJalali(today);
  if (unit === 'year') {
    return [jalaliToDay(jy + offset, 1, 1), jalaliToDay(jy + offset + 1, 1, 1)];
  }
  const size = unit === 'quarter' ? 3 : 1;
  const first = jm - ((jm - 1) % size);
  return [monthStart(jy, first, offset * size), monthStart(jy, first, (offset + 1) * size)];
}

const PRESETS: Record<string, [JalaliUnit, number]> = {
  thisWeek: ['week', 0],
  lastWeek: ['week', -1],
  nextWeek: ['week', 1],
  thisMonth: ['month', 0],
  lastMonth: ['month', -1],
  nextMonth: ['month', 1],
  thisQuarter: ['quarter', 0],
  lastQuarter: ['quarter', -1],
  nextQuarter: ['quarter', 1],
  thisYear: ['year', 0],
  lastYear: ['year', -1],
  nextYear: ['year', 1],
};

/** The preset names that depend on the calendar: thisWeek, lastMonth, nextYear, ... */
export const CALENDAR_PRESETS = Object.keys(PRESETS);

/** Whether a preset name (thisMonth, lastYear, ...) depends on the calendar. */
export function isCalendarPreset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}

/**
 * The value NocoBase's `{{$nDate.<preset>}}` variable stands for, in the Jalali calendar: the same
 * [startDate, endDate, '[)', timezone] shape that its own day ranges (last7Days) use.
 */
export function jalaliDateVar(preset: string, timezone?: string, now?: Date | string | number) {
  const [unit, offset] = PRESETS[preset];
  const [start, end] = jalaliRange(unit, offset, localDay(timezone, now));
  return [formatDay(start), formatDay(end), '[)', timezone || '+00:00'];
}

export type RangeParams = { type: string; unit?: string; number?: number };

const UNITS = new Set(['week', 'month', 'quarter', 'year']);

/**
 * The Jalali counterpart of NocoBase's getDayRangeByParams: [start, end] as 'YYYY-MM-DD HH:mm:ss' local times, end
 * being the last second of the range. Returns undefined when the range does not depend on the calendar.
 */
export function jalaliRangeByParams(
  params: RangeParams,
  timezone?: string,
  now?: Date | string | number,
): [string, string] | undefined {
  const today = localDay(timezone, now);
  let range: [number, number];
  if (params.type === 'past' || params.type === 'next') {
    const unit = params.unit || 'day';
    if (!UNITS.has(unit)) return undefined;
    const count = Number(params.number ?? 1);
    if (!Number.isInteger(count) || count < 1) return undefined;
    const u = unit as JalaliUnit;
    range =
      params.type === 'past'
        ? [jalaliRange(u, -count, today)[0], jalaliRange(u, 0, today)[0]]
        : [jalaliRange(u, 1, today)[0], jalaliRange(u, count, today)[1]];
  } else if (isCalendarPreset(params.type)) {
    const [unit, offset] = PRESETS[params.type];
    range = jalaliRange(unit, offset, today);
  } else {
    return undefined;
  }
  return [`${formatDay(range[0])} 00:00:00`, `${formatDay(range[1] - 1)} 23:59:59`];
}
