import { createMockServer, MockServer } from '@nocobase/test';
import { IRAN_PROVINCES, isIranRegion, normalizeRegion } from '../../shared/iran-regions';
import PluginFaServer from '../plugin';

describe('Province and city data', () => {
  it('lists the 31 provinces with their cities', () => {
    expect(IRAN_PROVINCES).toHaveLength(31);
    expect(IRAN_PROVINCES.find((p) => p.name === 'اصفهان')?.cities).toContain('کاشان');
    expect(new Set(IRAN_PROVINCES.map((p) => p.name)).size).toBe(31);
  });

  it('checks a province and one of its cities', () => {
    expect(isIranRegion('اصفهان / کاشان')).toBe(true);
    expect(isIranRegion('اصفهان')).toBe(true);
    expect(isIranRegion('تهران / کاشان')).toBe(false);
    expect(isIranRegion('اصفهان / کاشان / قمصر')).toBe(false);
    expect(isIranRegion('Isfahan')).toBe(false);
    expect(normalizeRegion(' اصفهان/كاشان ')).toBe('اصفهان / کاشان');
  });
});

describe('Province and city field', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({ plugins: ['error-handler', PluginFaServer], acl: false });
    app.db.collection({
      name: 'branches',
      fields: [{ type: 'string', name: 'region', interface: 'iranRegion', uiSchema: { title: 'استان و شهر' } }],
    });
    await app.db.sync();
  });

  afterEach(async () => {
    await app.destroy();
  });

  const create = (region: string, lang = 'en-US') =>
    app.agent().resource('branches').create({ values: { region } }).set('X-Locale', lang);

  it('stores the normalized value and refuses a city of another province', async () => {
    expect((await create('اصفهان/كاشان')).status).toBe(200);
    expect((await app.db.getRepository('branches').findOne()).get('region')).toBe('اصفهان / کاشان');
    const res = await create('تهران / کاشان', 'fa-IR');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toBe('«استان و شهر» معتبر نیست؛ استان و شهر را از فهرست انتخاب کنید.');
  });

  it('finds a province and all its cities, not a province whose name starts the same', async () => {
    for (const region of ['اصفهان / کاشان', 'اصفهان', 'کرمان / بم', 'کرمانشاه / کنگاور', 'تهران / تهران']) {
      expect((await create(region)).status).toBe(200);
    }
    const list = async (filter: object) => {
      const res = await app
        .agent()
        .resource('branches')
        .list({ filter, sort: ['id'] });
      return res.body.data.map((record: { region: string }) => record.region);
    };
    expect(await list({ region: { $iranRegionWithin: 'اصفهان' } })).toEqual(['اصفهان / کاشان', 'اصفهان']);
    expect(await list({ region: { $iranRegionWithin: 'کرمان' } })).toEqual(['کرمان / بم']);
    expect(await list({ region: { $iranRegionWithin: 'كرمانشاه/کنگاور' } })).toEqual(['کرمانشاه / کنگاور']);
    expect(await list({ region: { $iranRegionWithin: ['تهران', 'کرمان'] } })).toEqual(['کرمان / بم', 'تهران / تهران']);
  });
});
