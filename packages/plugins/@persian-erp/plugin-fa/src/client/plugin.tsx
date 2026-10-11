import { Plugin } from '@nocobase/client';
import models from './models';
import { FaProvider } from './FaProvider';

export class PluginFaClient extends Plugin {
  async load() {
    this.flowEngine.registerModels(models);
    this.app.use(FaProvider);
  }
}

export default PluginFaClient;
