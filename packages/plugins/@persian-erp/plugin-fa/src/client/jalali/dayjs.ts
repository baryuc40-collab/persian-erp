// Jalali (Persian) calendar support on top of NocoBase's shared dayjs instance.
//
// jalaliday adds a per-instance calendar: dayjs(value).calendar('jalali'). The default calendar stays Gregorian, and
// it must: several NocoBase paths build the value saved to the database with .format('YYYY-MM-DD'), so a global Jalali
// calendar would store Jalali dates (docs/decisions/0004-jalali-calendar.md). Only display and picker code asks for
// Jalali instances, and pickers hand Gregorian instances back to NocoBase.

import dayjs, { Dayjs } from 'dayjs';
import jalaliday from 'jalaliday/dayjs';

declare module 'dayjs' {
  interface Dayjs {
    calendar(calendar: 'jalali' | 'gregory'): Dayjs;
    isJalali(): boolean;
  }
}

let installed = false;

export function installJalali() {
  if (installed) return;
  installed = true;
  const proto = Object.getPrototypeOf(dayjs());
  const gregorianClone = proto.clone;
  dayjs.extend(jalaliday);
  // jalaliday replaces clone() for every instance and drops the utc offset and timezone that the utc and timezone
  // plugins keep on the instance. Keep dayjs's own clone for Gregorian instances.
  const jalaliClone = proto.clone;
  proto.clone = function (this: Dayjs) {
    return this.isJalali() ? jalaliClone.call(this) : gregorianClone.call(this);
  };
}

export type DateInput = Dayjs | Date | string | number | null | undefined;

/** The same moment in the Jalali calendar, or undefined for an empty or invalid value. */
export function toJalali(value: DateInput): Dayjs | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  installJalali();
  const date = dayjs.isDayjs(value) ? value : dayjs(value);
  return date.isValid() ? date.calendar('jalali') : undefined;
}

/** The same moment in the Gregorian calendar, which is what NocoBase stores. */
export function toGregorian<T extends Dayjs | null | undefined>(value: T): T {
  if (!value) return value;
  installJalali();
  return value.calendar('gregory') as T;
}

/** Formats a date in the Jalali calendar; month names follow the dayjs locale (fa: فروردین ...). */
export function formatJalali(value: DateInput, format = 'YYYY/MM/DD', locale = 'fa'): string {
  const date = toJalali(value);
  return date ? date.locale(locale).format(format) : '';
}
