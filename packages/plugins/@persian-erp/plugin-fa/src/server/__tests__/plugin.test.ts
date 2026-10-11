import { createMockServer, MockServer } from '@nocobase/test';

describe('@persian-erp/plugin-fa', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: ['@persian-erp/plugin-fa'],
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('is loaded and enabled', async () => {
    const plugin = app.pm.get('@persian-erp/plugin-fa');
    expect(plugin).toBeTruthy();
    expect(plugin.enabled).toBe(true);
  });
});
