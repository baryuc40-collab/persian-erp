import { Plugin } from '@nocobase/server';
import { installJalaliChartFormatter, jalaliChartsMiddleware } from './jalali-charts';
import { jalaliFilterMiddleware } from './jalali-filter';
import { registerJalaliHelper } from './jalali-handlebars';
import { registerJalaliInterfaces } from './jalali-interfaces';
import { normalizeFilterMiddleware, registerPersianText } from './persian-text';
import { iranianFieldMessages, registerIranianFields } from './iranian-fields';
import { readLocalePack } from './locale-pack';

export class PluginFaServer extends Plugin {
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
  }

  async load() {
    // Must run before NocoBase resolves the relative date variables; see jalali-filter.ts.
    this.app.dataSourceManager.use(jalaliFilterMiddleware, {
      tag: 'persian-erp-jalali-filter',
      before: 'parseVariables',
    });
    // Amounts in rials (STORY-054): imported and exported as whole numbers, like integer fields.
    this.db.interfaceManager.registerInterfaceType('currencyIRR', this.db.interfaceManager.getInterfaceType('integer'));
    // National ID, Sheba and other Iranian field types (EPIC-013); see iranian-fields.ts.
    registerIranianFields(this.db);
    iranianFieldMessages(this.app.i18n);
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
