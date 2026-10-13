import { Plugin } from '@nocobase/server';
import { installJalaliChartFormatter, jalaliChartsMiddleware } from './jalali-charts';
import { jalaliFilterMiddleware } from './jalali-filter';
import { registerJalaliHelper } from './jalali-handlebars';
import { registerJalaliInterfaces } from './jalali-interfaces';
import { normalizeFilterMiddleware, registerPersianText } from './persian-text';
import { readLocalePack } from './locale-pack';
import { installJalaliWorkflowRanges } from './jalali-workflow';
import {
  CALENDAR_FIELD,
  CalendarSetting,
  getCalendarSetting,
  settingsActions,
  SETTINGS_RESOURCE,
  SETTINGS_SNIPPET,
  toCalendarSetting,
} from './settings';

export class PluginFaServer extends Plugin {
  // The system's default calendar, kept in memory for code that cannot wait for the database (workflow functions).
  calendarSetting: CalendarSetting = null;

  async afterAdd() {}

  async beforeLoad() {
    // The official extension point for extra translations. Storers are merged in
    // registration order, so registering here (before any plugin's load()) lets
    // plugin-localization's storer, registered in its load(), override this pack
    // with the translations users edit in the UI.
    this.app.localeManager.registerResourceStorer('@persian-erp/plugin-fa', {
      getResources: (lang: string) => readLocalePack(lang),
      // Typed as optional, but Locale.reset() calls it on every storer.
      reset: async () => {},
    });
    // The system's default calendar; see settings.ts. New columns are added when the plugin is enabled or upgraded.
    this.db.extendCollection({ name: 'systemSettings', fields: [{ type: 'string', name: CALENDAR_FIELD }] });
    this.app.acl.registerSnippet({ name: SETTINGS_SNIPPET, actions: [`${SETTINGS_RESOURCE}:setSettings`] });
  }

  async load() {
    this.app.resourceManager.define({ name: SETTINGS_RESOURCE, actions: settingsActions(this.db) });
    this.app.acl.allow(SETTINGS_RESOURCE, 'getSettings', 'public');
    this.db.on('systemSettings.afterSave', (settings) => {
      this.calendarSetting = toCalendarSetting(settings.get(CALENDAR_FIELD));
    });
    this.app.on('beforeStart', async () => {
      this.calendarSetting = await getCalendarSetting(this.db);
    });
    // After every plugin's load(), so plugin-workflow has registered its own functions; see jalali-workflow.ts.
    this.app.on('afterLoad', () => {
      installJalaliWorkflowRanges(this.app.pm.get('workflow') as any, () =>
        this.calendarSetting === 'jalali' ? 'jalali' : 'gregory',
      );
    });
    // Must run before NocoBase resolves the relative date variables; see jalali-filter.ts.
    this.app.dataSourceManager.use(jalaliFilterMiddleware, {
      tag: 'persian-erp-jalali-filter',
      before: 'parseVariables',
    });
    // Amounts in rials (STORY-054): imported and exported as whole numbers, like integer fields.
    this.db.interfaceManager.registerInterfaceType('currencyIRR', this.db.interfaceManager.getInterfaceType('integer'));
    // Text is stored and searched with Latin digits and Persian Yeh and Kaf; see persian-text.ts.
    registerPersianText(this.db);
    this.app.dataSourceManager.use(normalizeFilterMiddleware, {
      tag: 'persian-erp-normalize-filter',
      before: 'persian-erp-jalali-filter',
    });
    // Jalali dates in Excel export and import; see jalali-interfaces.ts.
    registerJalaliInterfaces(this.db);
    // Jalali relative filters and date groups in charts; see jalali-charts.ts.
    installJalaliChartFormatter();
    this.app.resourceManager.use(jalaliChartsMiddleware, { tag: 'persian-erp-jalali-charts' });
    // {{jalali date}} in notification messages; see jalali-handlebars.ts.
    registerJalaliHelper();
  }

  async install() {}

  async afterEnable() {}

  async afterDisable() {}

  async remove() {}
}

export default PluginFaServer;
