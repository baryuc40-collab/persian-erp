import { Plugin } from '@nocobase/client-v2';
import { FaProvider } from '../client/FaProvider';

export class PluginFaClientV2 extends Plugin {
  async load() {
    this.app.use(FaProvider);
  }
}

export default PluginFaClientV2;
