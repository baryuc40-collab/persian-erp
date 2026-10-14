import { Plugin } from '@nocobase/client';
import React from 'react';
// @ts-ignore
import pkg from '../../package.json';
import { MODULES_SETTINGS_KEY, ModulesSettings } from './ModulesSettings';

export class PluginModulesClient extends Plugin {
  async load() {
    this.app.pluginSettingsManager.add(MODULES_SETTINGS_KEY, {
      icon: 'AppstoreAddOutlined',
      title: `{{t("ERP modules", { ns: "${pkg.name}" })}}`,
      Component: () => <ModulesSettings api={this.app.apiClient} />,
      aclSnippet: 'pm.erp-modules',
    });
  }
}

export default PluginModulesClient;
