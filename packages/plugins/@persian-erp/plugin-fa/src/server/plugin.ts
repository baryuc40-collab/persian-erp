import { Plugin } from '@nocobase/server';
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

  async load() {}

  async install() {}

  async afterEnable() {}

  async afterDisable() {}

  async remove() {}
}

export default PluginFaServer;
