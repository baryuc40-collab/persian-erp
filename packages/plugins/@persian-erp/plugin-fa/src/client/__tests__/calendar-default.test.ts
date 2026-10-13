import { CALENDAR_STORAGE_KEY, setCalendarPreference, setSystemCalendar, usesJalali } from '../jalali/calendar';

describe('default calendar', () => {
  afterEach(() => {
    window.localStorage.removeItem(CALENDAR_STORAGE_KEY);
    setSystemCalendar(null);
  });

  it('follows the language when the administrator set nothing', () => {
    expect(usesJalali('fa-IR')).toBe(true);
    expect(usesJalali('en-US')).toBe(false);
  });

  it('uses the system default for Persian users who did not choose', () => {
    setSystemCalendar('gregory');
    expect(usesJalali('fa-IR')).toBe(false);
    setSystemCalendar('jalali');
    expect(usesJalali('fa-IR')).toBe(true);
    // Jalali needs the Persian language for month names, so other languages stay Gregorian.
    expect(usesJalali('en-US')).toBe(false);
  });

  it("puts the user's own choice first", () => {
    setSystemCalendar('gregory');
    setCalendarPreference('jalali');
    expect(usesJalali('fa-IR')).toBe(true);
  });
});
