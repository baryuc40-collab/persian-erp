import { Plugin } from '@nocobase/client';
import React from 'react';
// @ts-ignore
import pkg from '../../package.json';
import { BPM_SETTINGS_KEY, BpmSettings } from './BpmSettings';

export class PluginBpmClient extends Plugin {
  async load() {
    this.app.pluginSettingsManager.add(BPM_SETTINGS_KEY, {
      icon: 'ApartmentOutlined',
      title: `{{t("BPMN engine", { ns: "${pkg.name}" })}}`,
      Component: () => <BpmSettings api={this.app.apiClient} />,
      aclSnippet: 'pm.bpm',
    });
  }
}

export default PluginBpmClient;
