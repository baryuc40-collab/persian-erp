// Jalali dates in Excel export and import (STORY-043).
//
// The exporter turns each value into text with the field interface's toString(value, ctx), and the importer turns
// text back into a value with toValue(text, ctx) (plugin-action-export base-exporter.ts, plugin-action-import
// xlsx-importer.ts). The date interfaces are wrapped so that, for requests from a user who reads the Jalali calendar
// (the X-Calendar header, see jalali-filter.ts), dates are written in Jalali and Jalali dates are read back.

import { DatetimeNoTzInterface, resolveTimeZoneFromCtx } from '@nocobase/database';
import { getDefaultFormat, str2moment } from '@nocobase/utils';
import { jalaliFormat, jalaliTextToGregorian } from '../shared/jalali-format';
import { CALENDAR_HEADER } from './jalali-filter';

export const JALALI_INTERFACES = ['datetime', 'datetimeNoTz', 'date', 'createdAt', 'updatedAt', 'unixTimestamp'];

export function isJalaliRequest(ctx: any): boolean {
  const get = typeof ctx?.get === 'function' ? ctx.get.bind(ctx) : ctx?.request?.get?.bind(ctx.request);
  return get?.(CALENDAR_HEADER) === 'jalali';
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

type InterfaceClass = new (...args: any[]) => {
  options: any;
  toString(value: any, ctx?: any): any;
  toValue(value: any, ctx?: any): any;
};

/** A subclass of a date field interface that reads and writes Jalali dates for Jalali requests. */
export function withJalali<T extends InterfaceClass>(Base: T, name: string): T {
  const withoutTimezone =
    name === 'date' || Base === (DatetimeNoTzInterface as any) || Base.prototype instanceof DatetimeNoTzInterface;

  return class JalaliDateInterface extends Base {
    toString(value: any, ctx?: any) {
      if (!isJalaliRequest(ctx) || value === null || value === undefined || value === '') {
        return super.toString(value, ctx);
      }
      if (name === 'date') {
        // Date-only values are exported as they are stored, YYYY-MM-DD; keep that shape.
        const text = super.toString(value, ctx);
        const match = typeof text === 'string' ? DATE_ONLY.exec(text) : null;
        if (!match) return text;
        return jalaliFormat('YYYY-MM-DD', Number(match[1]), Number(match[2]), Number(match[3])).replace(/[[\]]/g, '');
      }
      const props = this.options?.uiSchema?.['x-component-props'] ?? {};
      const utcOffset = withoutTimezone ? undefined : resolveTimeZoneFromCtx(ctx) ?? 0;
      const m = str2moment(value, withoutTimezone ? { ...props } : { ...props, utcOffset });
      if (!m || Array.isArray(m)) return super.toString(value, ctx);
      return m.format(jalaliFormat(getDefaultFormat(props), m.year(), m.month() + 1, m.date()));
    }

    async toValue(value: any, ctx?: any) {
      if (typeof value === 'string' && isJalaliRequest(ctx)) {
        return super.toValue(jalaliTextToGregorian(value), ctx);
      }
      return super.toValue(value, ctx);
    }
  };
}

/** Wraps the registered date interfaces of a database's interface manager. */
export function registerJalaliInterfaces(db: { interfaceManager: any }) {
  for (const name of JALALI_INTERFACES) {
    const Base = db.interfaceManager.getInterfaceType(name);
    if (Base) {
      db.interfaceManager.registerInterfaceType(name, withJalali(Base, name));
    }
  }
}
