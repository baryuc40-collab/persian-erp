import { createMockServer, MockServer } from '@nocobase/test';
import PluginFaServer from '../plugin';

describe('Jalali chart groups', () => {
  let app: MockServer;
  let token: string;

  beforeAll(async () => {
    app = await createMockServer({
      acl: true,
      plugins: [
        'field-sort',
        'users',
        'auth',
        'acl',
        'data-source-manager',
        'flow-engine',
        'system-settings',
        'data-visualization',
        // The class itself, so the test runs this source rather than the built package.
        PluginFaServer,
      ],
    });
    app.db.collection({
      name: 'jalali_chart_samples',
      fields: [
        { type: 'bigInt', name: 'id', primaryKey: true, autoIncrement: true },
        { type: 'date', name: 'moment', interface: 'datetime' },
        { type: 'double', name: 'amount' },
      ],
    });
    await app.db.sync();
    await app.db.getRepository('jalali_chart_samples').create({
      values: [
        // 31 Shahrivar 1405, 22:30 in Tehran.
        { moment: '2026-09-22T19:00:00Z', amount: 1 },
        // 1 Mehr 1405, 00:30 in Tehran: the same Gregorian month as the first.
        { moment: '2026-09-22T21:00:00Z', amount: 2 },
        { moment: '2026-10-12T08:00:00Z', amount: 4 },
        // 1 Aban 1405 in Tehran, still October.
        { moment: '2026-10-23T08:00:00Z', amount: 8 },
      ],
    });
    const root = await app.db.getRepository('users').findOne();
    token = await app.authManager.jwt.sign({ userId: root.id, roleName: 'root', signInTime: 'jalali-charts' });
  });

  afterAll(async () => {
    await app.destroy();
  });

  const query = async (headers: Record<string, string>, format: string, filter?: any) => {
    const res = await app
      .agent()
      .post('/charts:queryData')
      .set({ Authorization: `Bearer ${token}`, 'X-Authenticator': 'basic', 'X-Role': 'root', ...headers })
      .send({
        collection: 'jalali_chart_samples',
        dataSource: 'main',
        mode: 'builder',
        variableResolution: 'legacy-schema',
        measures: [{ field: ['amount'], aggregation: 'sum', alias: 'total' }],
        dimensions: [{ field: ['moment'], format, alias: 'period' }],
        orders: [{ field: ['moment'], alias: 'period', order: 'asc' }],
        filter,
      });
    expect(res.status).toBe(200);
    return res.body.data.map((row) => [row.period, Number(row.total)]);
  };

  const jalali = { 'X-Timezone': '+03:30', 'X-Calendar': 'jalali' };

  it('groups by Jalali month for Jalali requests', async () => {
    expect(await query(jalali, 'YYYY-MM')).toEqual([
      ['1405-06', 1],
      ['1405-07', 6],
      ['1405-08', 8],
    ]);
  });

  it('formats Jalali days and keeps the time of day', async () => {
    expect(await query(jalali, 'YYYY-MM-DD hh:mm')).toEqual([
      ['1405-06-31 22:30', 1],
      ['1405-07-01 00:30', 2],
      ['1405-07-20 11:30', 4],
      ['1405-08-01 11:30', 8],
    ]);
    expect(await query(jalali, 'YYYY')).toEqual([['1405', 15]]);
  });

  it('resolves relative filters in Jalali', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    try {
      expect(await query(jalali, 'YYYY-MM', { moment: { $dateOn: { type: 'thisMonth' } } })).toEqual([['1405-07', 6]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Gregorian groups otherwise', async () => {
    expect(await query({ 'X-Timezone': '+03:30' }, 'YYYY-MM')).toEqual([
      ['2026-09', 3],
      ['2026-10', 12],
    ]);
  });
});
