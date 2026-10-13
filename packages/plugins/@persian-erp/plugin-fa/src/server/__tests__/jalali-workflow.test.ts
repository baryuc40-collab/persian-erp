import { createMockServer, MockServer } from '@nocobase/test';
import { parse } from '@nocobase/utils';
import { serverTimezone } from '../jalali-workflow';
import PluginFaServer from '../plugin';

// 2026-10-12 is 20 Mehr 1405. Mehr runs from 2026-09-23 to 2026-10-22.
const NOW = new Date('2026-10-12T12:00:00Z');

describe('Jalali date ranges in workflows', () => {
  let app: MockServer;
  const range = (name: string) => app.pm.get('workflow')['functions'].get(`dateRange.${name}`).call({});
  const setCalendar = (calendar: string | null) =>
    app.db.getRepository('systemSettings').update({ filterByTk: 1, values: { persianErpCalendar: calendar } });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    app = await createMockServer({
      plugins: [
        'field-sort',
        'users',
        'auth',
        'acl',
        'data-source-manager',
        'system-settings',
        'workflow',
        PluginFaServer,
      ],
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.destroy();
  });

  it('stay Gregorian until the administrator picks Jalali', async () => {
    const [start] = range('thisMonth');
    expect(start).not.toBe('2026-09-23');
  });

  it('follow Jalali months, quarters and years once Jalali is the default', async () => {
    await setCalendar('jalali');
    const tz = serverTimezone(NOW);
    expect(range('thisMonth')).toEqual(['2026-09-23', '2026-10-23', '[)', tz]);
    expect(range('lastMonth')).toEqual(['2026-08-23', '2026-09-23', '[)', tz]);
    expect(range('thisYear')).toEqual(['2026-03-21', '2027-03-21', '[)', tz]);
    // Day ranges do not depend on the calendar and stay NocoBase's own.
    expect(range('today')).toEqual(range('today'));
    await setCalendar('gregory');
    expect(range('thisMonth')[0]).not.toBe('2026-09-23');
  });

  it('filter records by the Jalali month in a workflow query', async () => {
    await setCalendar('jalali');
    app.db.collection({ name: 'wf_dates', fields: [{ type: 'date', name: 'at' }] });
    await app.db.sync();
    const repo = app.db.getRepository('wf_dates');
    // 25 Sep is Mehr (this Jalali month) but not October; 30 Oct is Aban.
    await repo.createMany({ records: [{ at: '2026-09-25T10:00:00Z' }, { at: '2026-10-30T10:00:00Z' }] });
    const fns = app.pm.get('workflow')['functions'];
    const filter = parse({ at: { $dateOn: '{{$system.dateRange.thisMonth}}' } })({
      $system: { dateRange: { thisMonth: () => fns.get('dateRange.thisMonth').call({}) } },
    });
    const found = await repo.find({ filter });
    expect(found.map((r) => r.get('at').toISOString())).toEqual(['2026-09-25T10:00:00.000Z']);
  });
});
