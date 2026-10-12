import { Plugin } from '@nocobase/client';
import models from './models';
import { FaProvider } from './FaProvider';
import { installJalali } from './jalali';

export class PluginFaClient extends Plugin {
  async load() {
    // Adds the Jalali calendar to the shared dayjs instance; the default calendar stays Gregorian.
    installJalali();
    this.flowEngine.registerModels(models);
    this.app.use(FaProvider);
  }
}

export default PluginFaClient;
