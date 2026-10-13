import {
  CALENDAR_STORAGE_KEY,
  setCalendarLanguageSource,
  setCalendarPreference,
  withCalendarHeader,
} from '../jalali/calendar';

let language = 'fa-IR';
setCalendarLanguageSource(() => language);

describe('X-Calendar request header', () => {
  afterEach(() => {
    language = 'fa-IR';
    localStorage.removeItem(CALENDAR_STORAGE_KEY);
  });

  it('is sent in Persian with the Jalali calendar', () => {
    expect(withCalendarHeader({ headers: {} }).headers).toEqual({ 'X-Calendar': 'jalali' });
  });

  it('is not sent when the user chose the Gregorian calendar', () => {
    setCalendarPreference('gregory');
    expect(withCalendarHeader({ headers: {} }).headers).toEqual({});
  });

  it('is not sent in other languages', () => {
    language = 'en-US';
    expect(withCalendarHeader({ headers: {} }).headers).toEqual({});
  });
});
