import { Plugin } from '@nocobase/server';
import { readLocalePack } from './locale-pack';

export class PluginFaServer extends Plugin {
  async afterAdd() {}

  async beforeLoad() {}

  async load() {
    // The official extension point for extra translations (also used by
    // plugin-localization). Resources are merged over each package's own locale files.
    this.app.localeManager.registerResourceStorer('@persian-erp/plugin-fa', {
      getResources: (lang: string) => readLocalePack(lang),
      // Typed as optional, but Locale.reset() calls it on every storer.
      reset: async () => {},
    });
  }

  async install() {}

  async afterEnable() {}

  async afterDisable() {}

  async remove() {}
}

export default PluginFaServer;
