import { Plugin } from '@nocobase/client-v2';
import React from 'react';
import { BPM_SETTINGS_KEY, BpmSettings } from '../client/BpmSettings';
import { BpmTaskInboxBlockModel } from './TaskInboxBlockModel';
import ServiceTaskTrigger, { SERVICE_TASK_TRIGGER } from './ServiceTaskTrigger';
import StartProcessInstruction, { START_INSTRUCTION } from './StartProcessInstruction';

export class PluginBpmClientV2 extends Plugin {
  async load() {
    const title = this.t('BPMN engine');
    this.pluginSettingsManager.addMenuItem({
      key: BPM_SETTINGS_KEY,
      title,
      icon: 'ApartmentOutlined',
      aclSnippet: 'pm.bpm',
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: BPM_SETTINGS_KEY,
      key: 'index',
      title,
      Component: () => <BpmSettings api={this.app.apiClient} />,
    });

    const workflow = (this.app.pm.get('workflow') || this.app.pm.get('@nocobase/plugin-workflow')) as
      | {
          registerInstruction?: (type: string, instruction: unknown) => void;
          registerTrigger?: (type: string, trigger: unknown) => void;
        }
      | undefined;
    workflow?.registerInstruction?.(START_INSTRUCTION, StartProcessInstruction);
    workflow?.registerTrigger?.(SERVICE_TASK_TRIGGER, ServiceTaskTrigger);

    // The task inbox block of modern pages (STORY-082).
    this.flowEngine.registerModels({ BpmTaskInboxBlockModel });
  }
}

export default PluginBpmClientV2;
