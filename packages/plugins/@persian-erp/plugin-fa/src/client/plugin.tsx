import { Plugin } from '@nocobase/client';
import { IranianCurrency, IranianCurrencyFieldInterface, registerCurrencyModels } from './currency';
import models from './models';
import { DigitsSettings } from './DigitsSettings';
import { FaProvider } from './FaProvider';
import { registerIranianFields } from './iranian-fields';
import {
  CalendarSettings,
  installJalali,
  installJalaliPickers,
  JalaliDatePicker,
  registerJalaliModels,
  setCalendarLanguageSource,
  withCalendarHeader,
} from './jalali';

export class PluginFaClient extends Plugin {
  async load() {
    // Adds the Jalali calendar to the shared dayjs instance; the default calendar stays Gregorian.
    installJalali();
    setCalendarLanguageSource(() => this.app.i18n.language);
    // Relative date filters ("this month") are resolved on the server, which has to know the user's calendar.
    this.app.apiClient.axios.interceptors.request.use(withCalendarHeader);
    this.app.addComponents({ DatePicker: JalaliDatePicker });
    installJalaliPickers();
    this.app.addUserCenterSettingsItem({ name: 'calendar', Component: CalendarSettings, sort: 360 });
    this.app.addUserCenterSettingsItem({ name: 'digits', Component: DigitsSettings, sort: 361 });
    this.flowEngine.registerModels(models);
    registerJalaliModels(this.flowEngine);
    // Amounts in rials or tomans (STORY-054).
    this.app.addComponents({ IranianCurrency });
    this.app.dataSourceManager.addFieldInterfaces([IranianCurrencyFieldInterface]);
    registerCurrencyModels(this.flowEngine);
    // National ID, Sheba and other Iranian field types (EPIC-013).
    registerIranianFields(this.app, this.flowEngine);
    this.app.use(FaProvider);
  }
}

export default PluginFaClient;
