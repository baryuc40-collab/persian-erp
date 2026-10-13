import { Plugin } from '@nocobase/client';
// @ts-ignore
import pkg from '../../package.json';
import { IranianCurrency, IranianCurrencyFieldInterface, registerCurrencyModels } from './currency';
import models from './models';
import { DigitsSettings } from './DigitsSettings';
import { FaProvider } from './FaProvider';
import { PersianSettings } from './PersianSettings';
import {
  CalendarSettings,
  installJalali,
  installJalaliPickers,
  JalaliDatePicker,
  registerJalaliModels,
  setCalendarLanguageSource,
  setSystemCalendar,
  withCalendarHeader,
} from './jalali';

export class PluginFaClient extends Plugin {
  async load() {
    // Adds the Jalali calendar to the shared dayjs instance; the default calendar stays Gregorian.
    installJalali();
    setCalendarLanguageSource(() => this.app.i18n.language);
    await this.loadSystemCalendar();
    // Relative date filters ("this month") are resolved on the server, which has to know the user's calendar.
    this.app.apiClient.axios.interceptors.request.use(withCalendarHeader);
    this.app.addComponents({ DatePicker: JalaliDatePicker });
    installJalaliPickers();
    this.app.addUserCenterSettingsItem({ name: 'calendar', Component: CalendarSettings, sort: 360 });
    this.app.addUserCenterSettingsItem({ name: 'digits', Component: DigitsSettings, sort: 361 });
    this.flowEngine.registerModels(models);
    registerJalaliModels(this.flowEngine);
    this.app.pluginSettingsManager.add('persian-erp', {
      icon: 'GlobalOutlined',
      title: `{{t("Persian", { ns: "${pkg.name}" })}}`,
      Component: PersianSettings,
      aclSnippet: 'pm.persian-erp',
    });
    // Amounts in rials or tomans (STORY-054).
    this.app.addComponents({ IranianCurrency });
    this.app.dataSourceManager.addFieldInterfaces([IranianCurrencyFieldInterface]);
    registerCurrencyModels(this.flowEngine);
    this.app.use(FaProvider);
  }

  // The administrator's default calendar (STORY-048). Without it, the calendar follows the language as before.
  async loadSystemCalendar() {
    try {
      const { data } = await this.app.apiClient.request({ url: 'persianErp:getSettings' });
      setSystemCalendar(data?.data?.calendar ?? null);
    } catch {
      setSystemCalendar(null);
    }
  }
}

export default PluginFaClient;
