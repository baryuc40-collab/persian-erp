// Relative date filters in the Jalali calendar (STORY-042).
//
// NocoBase's parseVariables middleware resolves `{{$nDate.thisMonth}}` and `{ type: 'thisMonth' }` filter values with
// Gregorian months. This middleware runs just before it and, when the client sent `X-Calendar: jalali`, replaces the
// calendar-dependent ones with explicit Jalali ranges in the shapes NocoBase itself produces, so parseVariables and
// the date operators handle them unchanged.

import { isCalendarPreset, jalaliDateVar, jalaliRangeByParams } from '../shared/jalali-ranges';

export const CALENDAR_HEADER = 'x-calendar';

const DATE_OPERATORS = new Set([
  '$dateOn',
  '$dateNotOn',
  '$dateBefore',
  '$dateAfter',
  '$dateNotBefore',
  '$dateNotAfter',
  '$dateBetween',
]);

// `{{$nDate.thisMonth}}`, and the deprecated `{{$date.thisMonth}}`.
const DATE_VAR = /^\{\{\s*\$n?[dD]ate\.(\w+)\s*\}\}$/;

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJalaliValue(value: any, timezone: string, now?: Date) {
  if (typeof value === 'string') {
    const match = DATE_VAR.exec(value);
    return match && isCalendarPreset(match[1]) ? jalaliDateVar(match[1], timezone, now) : value;
  }
  if (isPlainObject(value) && typeof value.type === 'string') {
    return jalaliRangeByParams(value as any, timezone, now) ?? value;
  }
  return value;
}

/** A copy of `filter` with the calendar-dependent relative dates replaced by Jalali ranges. */
export function jalaliFilter(filter: any, timezone: string, now?: Date): any {
  if (Array.isArray(filter)) {
    return filter.map((item) => jalaliFilter(item, timezone, now));
  }
  if (!isPlainObject(filter)) {
    return filter;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(filter)) {
    result[key] = DATE_OPERATORS.has(key) ? toJalaliValue(value, timezone, now) : jalaliFilter(value, timezone, now);
  }
  return result;
}

export async function jalaliFilterMiddleware(ctx, next) {
  const filter = ctx.action?.params?.filter;
  if (filter && ctx.get(CALENDAR_HEADER) === 'jalali') {
    ctx.action.params.filter = jalaliFilter(filter, ctx.get('x-timezone') || '+00:00');
  }
  await next();
}
