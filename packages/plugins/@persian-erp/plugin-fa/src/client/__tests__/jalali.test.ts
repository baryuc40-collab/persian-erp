import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import weekday from 'dayjs/plugin/weekday';
import localeData from 'dayjs/plugin/localeData';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import 'dayjs/locale/fa';
import { formatJalali, installJalali, jalaliGenerateConfig as config, toGregorian, toJalali } from '../jalali';

// The plugins NocoBase's shared dayjs instance already has (core/utils/src/dayjs.ts).
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(weekOfYear);
installJalali();

describe('Jalali dayjs helpers', () => {
  it('keeps the default calendar Gregorian', () => {
    expect(dayjs('2026-10-12').format('YYYY-MM-DD')).toBe('2026-10-12');
    expect(dayjs('2026-10-12').year()).toBe(2026);
  });

  it('formats in the Jalali calendar', () => {
    expect(formatJalali('2026-10-12')).toBe('1405/07/20');
    expect(formatJalali('2026-03-21', 'D MMMM YYYY')).toBe('1 فروردین 1405');
    expect(formatJalali(null)).toBe('');
    expect(formatJalali('not a date')).toBe('');
  });

  it('converts back to the same Gregorian moment', () => {
    const value = dayjs('2026-10-12T08:30:00.000Z');
    const back = toGregorian(toJalali(value)!);
    expect(back.isJalali()).toBe(false);
    expect(back.toISOString()).toBe('2026-10-12T08:30:00.000Z');
    expect(back.format('YYYY-MM-DD')).toBe(value.format('YYYY-MM-DD'));
  });

  it('keeps the utc offset and timezone when a Gregorian instance is cloned', () => {
    // Offsets that differ from the machine's own, so a clone that drops them shows up.
    const offset = dayjs.utc('2026-10-12T20:30:00Z').utcOffset(-570);
    expect(offset.clone().utcOffset()).toBe(-570);
    expect(offset.clone().format('YYYY-MM-DD HH:mm')).toBe('2026-10-12 11:00');
    const zoned = dayjs.tz('2026-10-12 10:00', 'Pacific/Marquesas');
    expect(zoned.clone().format('Z')).toBe('-09:30');
  });

  it('keeps the utc offset in the Jalali calendar', () => {
    const offset = dayjs.utc('2026-10-12T20:30:00Z').utcOffset(-570);
    expect(formatJalali(offset, 'YYYY/MM/DD HH:mm')).toBe('1405/07/20 11:00');
    expect(toJalali(offset)!.clone().format('YYYY/MM/DD HH:mm Z')).toBe('1405/07/20 11:00 -09:30');
    expect(toGregorian(toJalali(offset)!).format('YYYY-MM-DD HH:mm Z')).toBe('2026-10-12 11:00 -09:30');
  });
});

describe('jalaliGenerateConfig', () => {
  const date = toJalali('2026-10-12')!; // 1405/07/20, a Monday

  it('reads Jalali parts, also from Gregorian values', () => {
    expect([config.getYear(date), config.getMonth(date), config.getDate(date)]).toEqual([1405, 6, 20]);
    const gregorian = dayjs('2026-10-12');
    expect([config.getYear(gregorian), config.getMonth(gregorian), config.getDate(gregorian)]).toEqual([1405, 6, 20]);
  });

  it('adds and sets in the Jalali calendar', () => {
    expect(config.locale.format('fa_IR', config.addMonth(date, 1), 'YYYY/MM/DD')).toBe('1405/08/20');
    expect(config.locale.format('fa_IR', config.addYear(date, -1), 'YYYY/MM/DD')).toBe('1404/07/20');
    expect(config.locale.format('fa_IR', config.addDate(date, 11), 'YYYY/MM/DD')).toBe('1405/08/01');
    expect(config.locale.format('fa_IR', config.setMonth(date, 11), 'YYYY/MM/DD')).toBe('1405/12/20');
    expect(config.locale.format('fa_IR', config.getEndDate(config.setMonth(date, 0)), 'YYYY/MM/DD')).toBe('1405/01/31');
    expect(config.locale.format('fa_IR', config.getEndDate(date), 'YYYY/MM/DD')).toBe('1405/07/30');
  });

  it('starts the week on Saturday in Persian', () => {
    expect(config.locale.getWeekFirstDay('fa_IR')).toBe(6);
    expect(config.locale.format('fa_IR', config.locale.getWeekFirstDate('fa_IR', date), 'YYYY/MM/DD')).toBe(
      '1405/07/18',
    );
  });

  it('lists Jalali month names', () => {
    expect(config.locale.getShortMonths!('fa_IR')[0]).toBe('فروردین');
    expect(config.locale.getShortMonths!('en_US')[6]).toBe('Mehr');
  });

  it('parses typed Jalali text', () => {
    const parsed = config.locale.parse('fa_IR', '1405/07/20', ['YYYY/MM/DD'])!;
    expect(toGregorian(parsed).format('YYYY-MM-DD')).toBe('2026-10-12');
    const withTime = config.locale.parse('fa_IR', '1405-07-20 14:30', ['YYYY-MM-DD HH:mm'])!;
    expect(toGregorian(withTime).format('YYYY-MM-DD HH:mm')).toBe('2026-10-12 14:30');
    expect(config.locale.parse('fa_IR', '1405/07/2', ['YYYY/MM/DD'])).toBeNull();
    expect(config.locale.parse('fa_IR', 'abc', ['YYYY/MM/DD'])).toBeNull();
  });
});
