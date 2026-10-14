import { Plugin } from '@nocobase/client';
import React from 'react';
// @ts-ignore
import pkg from '../../package.json';
import ServiceTaskTrigger, { SERVICE_TASK_TRIGGER } from '../client-v2/ServiceTaskTrigger';
import StartProcessInstruction, { START_INSTRUCTION } from '../client-v2/StartProcessInstruction';
import { BPM_SETTINGS_KEY, BpmSettings } from './BpmSettings';

export class PluginBpmClient extends Plugin {
  async load() {
    this.app.pluginSettingsManager.add(BPM_SETTINGS_KEY, {
      icon: 'ApartmentOutlined',
      title: `{{t("BPMN engine", { ns: "${pkg.name}" })}}`,
      Component: () => <BpmSettings api={this.app.apiClient} />,
      aclSnippet: 'pm.bpm',
    });

    // The workflow pages use the same node in both clients, as the NocoBase workflow plugins do.
    const workflow = (this.app.pm.get('workflow') as unknown) as
      | {
          registerInstruction?: (type: string, instruction: unknown) => void;
          registerTrigger?: (type: string, trigger: unknown) => void;
        }
      | undefined;
    workflow?.registerInstruction?.(START_INSTRUCTION, StartProcessInstruction);
    workflow?.registerTrigger?.(SERVICE_TASK_TRIGGER, ServiceTaskTrigger);
  }
}

export default PluginBpmClient;
