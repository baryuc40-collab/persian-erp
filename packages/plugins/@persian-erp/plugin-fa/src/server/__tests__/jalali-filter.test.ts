import { createMockServer, MockServer } from '@nocobase/test';
import { jalaliDateVar, jalaliRangeByParams } from '../../shared/jalali-ranges';
import { jalaliFilter } from '../jalali-filter';
import PluginFaServer from '../plugin';

// 2026-10-13 13:30 in Tehran: 21 Mehr 1405, a Tuesday.
const NOW = new Date('2026-10-13T10:00:00Z');
const TZ = '+03:30';

describe('Jalali relative date ranges', () => {
  it('resolves the date variables to Jalali units', () => {
    expect(jalaliDateVar('thisMonth', TZ, NOW)).toEqual(['2026-09-23', '2026-10-23', '[)', TZ]);
    expect(jalaliDateVar('lastMonth', TZ, NOW)).toEqual(['2026-08-23', '2026-09-23', '[)', TZ]);
    expect(jalaliDateVar('thisQuarter', TZ, NOW)).toEqual(['2026-09-23', '2026-12-22', '[)', TZ]);
    expect(jalaliDateVar('lastQuarter', TZ, NOW)).toEqual(['2026-06-22', '2026-09-23', '[)', TZ]);
    expect(jalaliDateVar('thisYear', TZ, NOW)).toEqual(['2026-03-21', '2027-03-21', '[)', TZ]);
    expect(jalaliDateVar('thisWeek', TZ, NOW)).toEqual(['2026-10-10', '2026-10-17', '[)', TZ]);
  });

  it('uses the local date of the timezone, not the UTC date', () => {
    // 2026-09-22 21:00 UTC is already 1 Mehr in Tehran.
    expect(jalaliDateVar('thisMonth', TZ, new Date('2026-09-22T21:00:00Z'))[0]).toBe('2026-09-23');
    expect(jalaliDateVar('thisMonth', '+00:00', new Date('2026-09-22T21:00:00Z'))[0]).toBe('2026-08-23');
  });

  it('crosses the year boundary', () => {
    // 5 Farvardin 1405: last month is Esfand 1404, which has 29 days.
    expect(jalaliDateVar('lastMonth', TZ, new Date('2026-03-25T10:00:00Z'))).toEqual([
      '2026-02-20',
      '2026-03-21',
      '[)',
      TZ,
    ]);
    // The first quarter of 1405 starts on Nowruz.
    expect(jalaliDateVar('thisQuarter', TZ, new Date('2026-05-01T10:00:00Z'))).toEqual([
      '2026-03-21',
      '2026-06-22',
      '[)',
      TZ,
    ]);
  });

  it('resolves range objects like getDayRangeByParams does', () => {
    expect(jalaliRangeByParams({ type: 'thisMonth' }, TZ, NOW)).toEqual(['2026-09-23 00:00:00', '2026-10-22 23:59:59']);
    expect(jalaliRangeByParams({ type: 'past', unit: 'month', number: 3 }, TZ, NOW)).toEqual([
      '2026-06-22 00:00:00',
      '2026-09-22 23:59:59',
    ]);
    expect(jalaliRangeByParams({ type: 'next', unit: 'year', number: 1 }, TZ, NOW)).toEqual([
      '2027-03-21 00:00:00',
      '2028-03-19 23:59:59',
    ]);
  });

  it('leaves calendar-independent ranges to NocoBase', () => {
    expect(jalaliRangeByParams({ type: 'today' }, TZ, NOW)).toBeUndefined();
    expect(jalaliRangeByParams({ type: 'past', unit: 'day', number: 7 }, TZ, NOW)).toBeUndefined();
  });

  it('rewrites only date operator values', () => {
    const filter = {
      $and: [
        { createdAt: { $dateOn: '{{$nDate.thisMonth}}' } },
        { updatedAt: { $dateBefore: { type: 'lastYear' } } },
        { createdAt: { $dateOn: '{{$nDate.today}}' } },
        { title: { $eq: '{{$nDate.thisMonth}}' } },
      ],
    };
    expect(jalaliFilter(filter, TZ, NOW)).toEqual({
      $and: [
        { createdAt: { $dateOn: ['2026-09-23', '2026-10-23', '[)', TZ] } },
        { updatedAt: { $dateBefore: ['2025-03-21 00:00:00', '2026-03-20 23:59:59'] } },
        { createdAt: { $dateOn: '{{$nDate.today}}' } },
        { title: { $eq: '{{$nDate.thisMonth}}' } },
      ],
    });
  });
});

describe('Jalali relative date filters on the server', () => {
  let app: MockServer;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    // The class itself, so the test runs this source rather than the built package.
    app = await createMockServer({ plugins: [PluginFaServer] });
    app.db.collection({
      name: 'jalali_filter_samples',
      fields: [
        { type: 'string', name: 'title' },
        { type: 'date', name: 'moment', interface: 'datetime' },
      ],
    });
    await app.db.sync();
    await app.db.getRepository('jalali_filter_samples').create({
      values: [
        // 31 Shahrivar, 22:30 in Tehran.
        { title: 'shahrivar', moment: '2026-09-22T19:00:00Z' },
        // 1 Mehr, 00:30 in Tehran.
        { title: 'mehr-first', moment: '2026-09-22T21:00:00Z' },
        { title: 'mehr', moment: '2026-10-12T08:00:00Z' },
        // 1 Aban in Tehran, still October.
        { title: 'aban', moment: '2026-10-23T08:00:00Z' },
      ],
    });
  });

  afterEach(async () => {
    await app.destroy();
    vi.useRealTimers();
  });

  const titles = async (headers: Record<string, string>, value: any) => {
    const res = await app
      .agent()
      .resource('jalali_filter_samples')
      .list({ filter: { moment: { $dateOn: value } }, sort: ['moment'] })
      .set(headers);
    expect(res.status).toBe(200);
    return res.body.data.map((row) => row.title);
  };

  it('filters "this month" by the Jalali month with X-Calendar: jalali', async () => {
    const headers = { 'X-Timezone': TZ, 'X-Calendar': 'jalali' };
    expect(await titles(headers, { type: 'thisMonth' })).toEqual(['mehr-first', 'mehr']);
    expect(await titles(headers, '{{$nDate.thisMonth}}')).toEqual(['mehr-first', 'mehr']);
  });

  it('keeps NocoBase behaviour without the header', async () => {
    expect(await titles({ 'X-Timezone': TZ }, { type: 'thisMonth' })).toEqual(['mehr', 'aban']);
  });
});
