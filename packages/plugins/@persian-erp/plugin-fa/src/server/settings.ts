// The system's default calendar (STORY-048), kept as one column on NocoBase's systemSettings record.
//
// - unset (a new install): Persian users see Jalali, and work that runs without a user (workflows) uses Gregorian;
//   this is how the plugin behaved before the setting existed.
// - 'jalali': as unset, and work without a user also uses Jalali.
// - 'gregory': Persian users who did not pick a calendar themselves see Gregorian too.

import type { Context, Next } from '@nocobase/actions';

export const CALENDAR_FIELD = 'persianErpCalendar';
export const SETTINGS_RESOURCE = 'persianErp';
export const SETTINGS_SNIPPET = 'pm.persian-erp';

export type CalendarSetting = 'jalali' | 'gregory' | null;

const CALENDARS = ['jalali', 'gregory'];

interface SettingsDb {
  getRepository(
    name: string,
  ): {
    findOne(options: object): Promise<{ get(key: string): unknown } | null>;
    update(options: object): Promise<unknown>;
  };
}

export async function getCalendarSetting(db: SettingsDb): Promise<CalendarSetting> {
  const settings = await db.getRepository('systemSettings').findOne({ filterByTk: 1 });
  const value = settings?.get(CALENDAR_FIELD);
  return CALENDARS.includes(value as string) ? (value as CalendarSetting) : null;
}

/** The calendar of work that runs without a user, such as workflows (used by STORY-049). */
export async function defaultCalendar(db: SettingsDb): Promise<'jalali' | 'gregory'> {
  return (await getCalendarSetting(db)) === 'jalali' ? 'jalali' : 'gregory';
}

export function settingsActions(db: SettingsDb) {
  return {
    // Public, like systemSettings:get: the client needs it before anyone signs in.
    async getSettings(ctx: Context, next: Next) {
      ctx.body = { calendar: await getCalendarSetting(db) };
      await next();
    },
    async setSettings(ctx: Context, next: Next) {
      const calendar = ctx.action.params.values?.calendar ?? null;
      if (calendar !== null && !CALENDARS.includes(calendar)) ctx.throw(400, 'Invalid calendar');
      // Only this column: systemSettings:put would also rewrite the title.
      await db.getRepository('systemSettings').update({ filterByTk: 1, values: { [CALENDAR_FIELD]: calendar } });
      ctx.body = { calendar };
      await next();
    },
  };
}
