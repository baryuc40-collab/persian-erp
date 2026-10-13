import { createMockServer, MockServer } from '@nocobase/test';
import PluginFaServer from '../plugin';

describe('Iranian fields on save', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({ plugins: ['error-handler', PluginFaServer], acl: false });
    app.db.collection({
      name: 'people',
      fields: [
        { type: 'string', name: 'nid', interface: 'iranNationalId', uiSchema: { title: 'کد ملی' } },
        { type: 'string', name: 'company', interface: 'iranLegalId' },
      ],
    });
    await app.db.sync();
  });

  afterEach(async () => {
    await app.destroy();
  });

  const create = (values: object, lang = 'en-US') =>
    app.agent().resource('people').create({ values }).set('X-Locale', lang);

  it('stores the normalized national ID', async () => {
    const res = await create({ nid: '۰۴۹۹-۳۷۰۸۹۹', company: '10380284790' });
    expect(res.status).toBe(200);
    const record = await app.db.getRepository('people').findOne();
    expect(record.get('nid')).toBe('0499370899');
  });

  it('refuses invalid IDs with a message in the user language', async () => {
    let res = await create({ nid: '0499370898' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toBe('کد ملی is not a valid national ID');
    res = await create({ nid: '1111111111' }, 'fa-IR');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toBe('«کد ملی» معتبر نیست؛ کد ملی ۱۰ رقم با رقم کنترل درست است.');
    res = await create({ company: '10380284791' });
    expect(res.status).toBe(400);
    expect(await app.db.getRepository('people').count()).toBe(0);
  });

  it('accepts an empty value', async () => {
    expect((await create({ nid: '' })).status).toBe(200);
  });
});
