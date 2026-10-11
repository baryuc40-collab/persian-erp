import { createMockServer, MockServer } from '@nocobase/test';
import { readLocalePack } from '../locale-pack';

describe('locale pack', () => {
  let app: MockServer;

  beforeEach(async () => {
    app = await createMockServer({
      plugins: ['@persian-erp/plugin-fa'],
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  it('reads one namespace per file for fa-IR only', async () => {
    const pack = await readLocalePack('fa-IR');
    expect(pack.client['System settings']).toBe('تنظیمات سیستم');
    expect(await readLocalePack('en-US')).toEqual({});
  });

  it('serves the pack through the locale manager', async () => {
    const resources = await app.localeManager.getResources('fa-IR');
    expect(resources.client['System settings']).toBe('تنظیمات سیستم');
    const en = await app.localeManager.getResources('en-US');
    expect(en.client?.['System settings']).not.toBe('تنظیمات سیستم');
  });

  it('survives a locale reset', async () => {
    await expect(app.localeManager.reset()).resolves.not.toThrow();
  });
});
