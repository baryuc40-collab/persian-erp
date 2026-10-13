import { Plugin } from '@nocobase/client';
import models from './models';
import { FaProvider } from './FaProvider';
import {
  installJalali,
  installJalaliPickers,
  JalaliDatePicker,
  registerJalaliModels,
  setCalendarLanguageSource,
} from './jalali';

export class PluginFaClient extends Plugin {
  async load() {
    // Adds the Jalali calendar to the shared dayjs instance; the default calendar stays Gregorian.
    installJalali();
    setCalendarLanguageSource(() => this.app.i18n.language);
    this.app.addComponents({ DatePicker: JalaliDatePicker });
    installJalaliPickers();
    this.flowEngine.registerModels(models);
    registerJalaliModels(this.flowEngine);
    this.app.use(FaProvider);
  }
}

export default PluginFaClient;
