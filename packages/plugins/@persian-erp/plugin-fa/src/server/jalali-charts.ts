// Charts grouped by Jalali months, quarters and years (STORY-044).
//
// Chart dimensions on a date field are grouped in SQL by the field formatted with the dimension's format
// (QueryFormatter.format in core/database/src/query, to_char on PostgreSQL), which groups by Gregorian months. For a
// charts:queryData request from a user who reads the Jalali calendar (the X-Calendar header, see jalali-filter.ts),
// the formatter is asked for the local Gregorian date instead, and a SQL function turns it into the Jalali date, whose
// prefix is the Jalali year, month or day. Only PostgreSQL is supported; other databases keep Gregorian groups.

import { AsyncLocalStorage } from 'async_hooks';
import { QueryFormatter } from '@nocobase/database';
import { formatDay, jalaliToDay } from '../shared/jalali-ranges';
import { jalaliFilter } from './jalali-filter';
import { isJalaliRequest } from './jalali-interfaces';

export const JALALI_SQL_FUNCTION = 'persian_erp_jalali';

const FIRST_YEAR = 1300;
const LAST_YEAR = 1500;

/**
 * A PostgreSQL function from a date to its Jalali 'YYYY-MM-DD', using the Gregorian dates of Nowruz from 1300 to 1500
 * (1921 to 2121) computed by this plugin; dates outside that range keep their Gregorian text.
 */
export function jalaliFunctionSql() {
  const starts: string[] = [];
  for (let jy = FIRST_YEAR; jy <= LAST_YEAR; jy += 1) {
    starts.push(`'${formatDay(jalaliToDay(jy, 1, 1))}'`);
  }
  // starts[1] is Nowruz of FIRST_YEAR, so the year jy is at index jy - (FIRST_YEAR - 1).
  const index = (year: string) => `starts[${year} - ${FIRST_YEAR - 1}]`;
  return `CREATE OR REPLACE FUNCTION ${JALALI_SQL_FUNCTION}(d date) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  starts date[] := ARRAY[${starts.join(',')}]::date[];
  jy int;
  k int;
BEGIN
  IF d IS NULL THEN RETURN NULL; END IF;
  jy := extract(year from d)::int - 621;
  IF jy <= ${FIRST_YEAR} OR jy > ${LAST_YEAR} THEN RETURN to_char(d, 'YYYY-MM-DD'); END IF;
  IF d < ${index('jy')} THEN jy := jy - 1; END IF;
  k := d - ${index('jy')};
  IF k < 186 THEN
    RETURN lpad(jy::text, 4, '0') || '-' || lpad((k / 31 + 1)::text, 2, '0') || '-' || lpad((k % 31 + 1)::text, 2, '0');
  END IF;
  k := k - 186;
  RETURN lpad(jy::text, 4, '0') || '-' || lpad((k / 30 + 7)::text, 2, '0') || '-' || lpad((k % 30 + 1)::text, 2, '0');
END
$fn$;`;
}

const created = new WeakMap<object, Promise<unknown>>();

/** Creates the SQL function once per database connection. */
export function ensureJalaliFunction(db: { sequelize: any }) {
  if (!created.has(db)) {
    const creating = db.sequelize.query(jalaliFunctionSql());
    creating.catch(() => created.delete(db));
    created.set(db, creating);
  }
  return created.get(db);
}

const jalaliQuery = new AsyncLocalStorage<boolean>();

// Formats the chart settings offer for dates; others keep Gregorian groups.
const SUPPORTED_FORMAT = /^YYYY(-MM(-DD)?)?(?: (hh:mm(?::ss)?))?$/;
const DATE_TYPES = new Set(['date', 'datetime', 'datetimeTz', 'datetimeNoTz', 'dateOnly', 'unixTimestamp']);

let installed = false;

/** Makes QueryFormatter.format group dates by the Jalali calendar inside a Jalali chart query. */
export function installJalaliChartFormatter() {
  if (installed) return;
  installed = true;
  const proto = QueryFormatter.prototype as any;
  const original = proto.format;
  proto.format = function (options: { type: string; format: string; [key: string]: any }) {
    const match =
      jalaliQuery.getStore() &&
      DATE_TYPES.has(options?.type) &&
      typeof options.format === 'string' &&
      this.sequelize.getDialect() === 'postgres'
        ? SUPPORTED_FORMAT.exec(options.format)
        : null;
    if (!match) {
      return original.call(this, options);
    }
    const { sequelize } = this;
    // The local Gregorian date, with the field's timezone handling, as NocoBase formats it.
    const localDate = original.call(this, { ...options, format: 'YYYY-MM-DD' });
    const length = 4 + (match[1] ? 3 : 0) + (match[2] ? 3 : 0);
    let result = sequelize.fn(
      'substr',
      sequelize.fn(JALALI_SQL_FUNCTION, sequelize.cast(localDate, 'date')),
      1,
      length,
    );
    if (match[3]) {
      result = sequelize.fn('concat', result, ' ', original.call(this, { ...options, format: match[3] }));
    }
    return result;
  };
}

function queryDatabase(ctx: any, dataSource?: string) {
  return ctx.app.dataSourceManager.dataSources.get(dataSource)?.collectionManager?.db || ctx.db;
}

/** Runs a Jalali charts:queryData request with Jalali relative filters and Jalali date groups. */
export async function jalaliChartsMiddleware(ctx: any, next: () => Promise<any>) {
  const { resourceName, actionName } = ctx.action || {};
  if (resourceName !== 'charts' || actionName !== 'queryData' || !isJalaliRequest(ctx)) {
    return next();
  }
  const values = ctx.action.params.values;
  if (values && typeof values === 'object') {
    if (values.filter) {
      values.filter = jalaliFilter(values.filter, ctx.get('x-timezone') || '+00:00');
    }
    // Cached results are keyed by uid and query; keep the Jalali ones apart.
    if (values.uid) {
      values.uid = `${values.uid}:jalali`;
    }
    const db = queryDatabase(ctx, values.dataSource);
    if (db?.sequelize?.getDialect?.() === 'postgres') {
      await ensureJalaliFunction(db);
    }
  }
  return jalaliQuery.run(true, next);
}
