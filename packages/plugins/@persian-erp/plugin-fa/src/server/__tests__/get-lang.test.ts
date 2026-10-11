import { createMockServer, MockServer } from '@nocobase/test';

const PLUGINS = ['field-sort', 'client', 'system-settings', 'localization', '@persian-erp/plugin-fa'];

async function getLang(app: MockServer, locale?: string) {
  const res = await app
    .agent()
    .resource('app')
    .getLang(locale ? { locale } : {});
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('app:getLang with plugin-fa', () => {
  let app: MockServer;

  afterEach(async () => {
    await app?.destroy();
  });

  describe('fa-IR enabled', () => {
    beforeEach(async () => {
      app = await createMockServer({ plugins: PLUGINS });
      await app.db.getRepository('systemSettings').update({
        filterByTk: 1,
        values: { enabledLanguages: ['en-US', 'fa-IR'] },
      });
    });

    it('serves Persian translations from the locale pack', async () => {
      const data = await getLang(app, 'fa-IR');
      expect(data.lang).toBe('fa-IR');
      expect(data.resources.client['System settings']).toBe('تنظیمات سیستم');
    });

    it('leaves untranslated keys to the English fallback', async () => {
      const data = await getLang(app, 'fa-IR');
      // A key the pack does not cover must be absent, not an empty string: i18next then shows the key
      // (the English text). An empty value would render as blank.
      const empty = Object.entries(data.resources).flatMap(([ns, keys]) =>
        Object.entries(keys as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string' && v.trim() === '')
          .map(([k]) => `${ns}:${k}`),
      );
      expect(empty).toEqual([]);
    });

    it('does not touch other languages', async () => {
      const data = await getLang(app, 'en-US');
      expect(data.resources.client['System settings']).not.toBe('تنظیمات سیستم');
    });

    it('lets translations edited in plugin-localization win over the pack', async () => {
      const text = await app.db.getRepository('localizationTexts').create({
        values: { module: 'resources.client', text: 'System settings' },
      });
      await app.db.getRepository('localizationTranslations').create({
        values: { locale: 'fa-IR', translation: 'تنظیمات ویژه', textId: text.get('id') },
      });
      const data = await getLang(app, 'fa-IR');
      expect(data.resources.client['System settings']).toBe('تنظیمات ویژه');
      // Keys the user did not edit still come from the pack.
      expect(data.resources.client['Plugin manager']).toBe('مدیریت پلاگین‌ها');
    });
  });

  describe('INIT_APP_LANG=fa-IR', () => {
    const previous = process.env.INIT_APP_LANG;

    beforeEach(async () => {
      process.env.INIT_APP_LANG = 'fa-IR';
      app = await createMockServer({ plugins: PLUGINS });
    });

    afterEach(() => {
      if (previous === undefined) delete process.env.INIT_APP_LANG;
      else process.env.INIT_APP_LANG = previous;
    });

    it('makes Persian the default language on first install', async () => {
      const data = await getLang(app);
      expect(data.lang).toBe('fa-IR');
      expect(data.resources.client['Submit']).toBe('ثبت');
    });
  });
});
