import { Plugin } from '@nocobase/client-v2';
import React from 'react';
import { MODULES_SETTINGS_KEY, ModulesSettings } from '../client/ModulesSettings';

export class PluginModulesClientV2 extends Plugin {
  async load() {
    const title = this.t('ERP modules');
    this.pluginSettingsManager.addMenuItem({
      key: MODULES_SETTINGS_KEY,
      title,
      icon: 'AppstoreAddOutlined',
      aclSnippet: 'pm.erp-modules',
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: MODULES_SETTINGS_KEY,
      key: 'index',
      title,
      Component: () => <ModulesSettings api={this.app.apiClient} />,
    });
  }
}

export default PluginModulesClientV2;
