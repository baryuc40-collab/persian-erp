import { createMockServer, MockServer } from '@nocobase/test';
import PluginFaServer from '../plugin';
import { defaultCalendar } from '../settings';

describe('default calendar setting', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: ['field-sort', 'users', 'auth', 'acl', 'data-source-manager', 'system-settings', PluginFaServer],
      acl: true,
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  const root = async () => {
    const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
    return app.agent().login(user);
  };

  it('is unset on a new install, so work without a user stays Gregorian', async () => {
    const res = await app.agent().resource('persianErp').getSettings();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ calendar: null });
    expect(await defaultCalendar(app.db)).toBe('gregory');
  });

  it('is saved by an administrator and read by the server', async () => {
    const agent = await root();
    const res = await agent.resource('persianErp').setSettings({ values: { calendar: 'jalali' } });
    expect(res.status).toBe(200);
    expect(await defaultCalendar(app.db)).toBe('jalali');
    expect((await app.agent().resource('persianErp').getSettings()).body.data).toEqual({ calendar: 'jalali' });
    // The rest of the system settings are left as they were.
    const settings = await app.db.getRepository('systemSettings').findOne({ filterByTk: 1 });
    expect(settings.get('title')).toBeTruthy();
  });

  it('refuses changes from anyone but administrators, and unknown calendars', async () => {
    const set = (agent) => agent.resource('persianErp').setSettings({ values: { calendar: 'jalali' } });
    expect((await set(app.agent())).status).toBe(401);
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    expect((await set(await app.agent().login(member))).status).toBe(403);
    const agent = await root();
    expect((await agent.resource('persianErp').setSettings({ values: { calendar: 'hijri' } })).status).toBe(400);
  });
});
