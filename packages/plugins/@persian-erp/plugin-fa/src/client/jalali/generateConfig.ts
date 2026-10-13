// A Jalali generateConfig for antd's DatePicker.generatePicker, modelled on rc-picker's dayjs config. Every value the
// picker works with is a Jalali dayjs instance; values that arrive in the Gregorian calendar are converted first, so the
// picker can be handed NocoBase's own (Gregorian) values. Callers convert back with toGregorian before saving.

import dayjs, { Dayjs } from 'dayjs';
import type { GenerateConfig } from 'rc-picker/lib/generate';
import { installJalali } from './dayjs';

installJalali();

const J = (date: Dayjs) => (date.isJalali() ? date : date.calendar('jalali'));

// antd passes its locale code (fa_IR); dayjs uses fa.
const dayjsLocale = (locale: string) => (locale === 'en_US' ? 'en' : locale.split('_')[0].toLowerCase());

const jalaliMonths = (locale: string): string[] =>
  (dayjs.Ls[dayjsLocale(locale)] as any)?.jmonths ?? (dayjs.Ls.en as any).jmonths;

export const jalaliGenerateConfig: GenerateConfig<Dayjs> = {
  getNow: () => dayjs().calendar('jalali'),
  getFixedDate: (fixed) => dayjs(fixed, ['YYYY-M-DD', 'YYYY-MM-DD']).calendar('jalali'),
  getEndDate: (date) => J(date).endOf('month'),
  getWeekDay: (date) => {
    const clone = J(date).locale('en');
    return clone.weekday() + clone.localeData().firstDayOfWeek();
  },
  getYear: (date) => J(date).year(),
  getMonth: (date) => J(date).month(),
  getDate: (date) => J(date).date(),
  getHour: (date) => date.hour(),
  getMinute: (date) => date.minute(),
  getSecond: (date) => date.second(),
  getMillisecond: (date) => date.millisecond(),
  addYear: (date, diff) => J(date).add(diff, 'year'),
  addMonth: (date, diff) => J(date).add(diff, 'month'),
  addDate: (date, diff) => J(date).add(diff, 'day'),
  setYear: (date, year) => J(date).year(year),
  setMonth: (date, month) => J(date).month(month),
  setDate: (date, num) => J(date).date(num),
  setHour: (date, hour) => J(date).hour(hour),
  setMinute: (date, minute) => J(date).minute(minute),
  setSecond: (date, second) => J(date).second(second),
  setMillisecond: (date, ms) => J(date).millisecond(ms),
  isAfter: (date1, date2) => date1.isAfter(date2),
  isValidate: (date) => date.isValid(),
  locale: {
    getWeekFirstDay: (locale) => dayjs().locale(dayjsLocale(locale)).localeData().firstDayOfWeek(),
    getWeekFirstDate: (locale, date) => J(date).locale(dayjsLocale(locale)).weekday(0),
    getWeek: (locale, date) => J(date).locale(dayjsLocale(locale)).week(),
    getShortWeekDays: (locale) => dayjs().locale(dayjsLocale(locale)).localeData().weekdaysMin(),
    getShortMonths: (locale) => jalaliMonths(locale),
    format: (locale, date, format) => J(date).locale(dayjsLocale(locale)).format(format),
    // Typed text is a Jalali date such as 1405/07/20 or 1405-07-20 14:30. jalaliday converts the date part to
    // Gregorian and keeps the rest; the result only counts if it formats back to exactly the typed text.
    parse: (locale, text, formats) => {
      if (!text) return null;
      const gregorian = dayjs(text, { jalali: true } as any);
      if (!gregorian.isValid()) return null;
      const date = gregorian.calendar('jalali').locale(dayjsLocale(locale));
      return formats.some((format) => date.format(format) === text) ? date : null;
    },
  },
};
