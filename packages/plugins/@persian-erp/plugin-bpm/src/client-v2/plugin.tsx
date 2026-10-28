import { Plugin } from '@nocobase/client-v2';
import React from 'react';
import { BPM_SETTINGS_KEY, BpmSettings } from '../client/BpmSettings';
import { BpmTaskInboxBlockModel } from './TaskInboxBlockModel';

const START_INSTRUCTION = 'bpm-start';
const MESSAGE_INSTRUCTION = 'bpm-message';
const SERVICE_TASK_TRIGGER = 'bpm-service-task';

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
    if (workflow?.registerInstruction || workflow?.registerTrigger) {
      // The node classes extend `Instruction`/`Trigger` from `@nocobase/plugin-workflow/client-v2`,
      // which that package only provides once the app has finished loading its externals; importing
      // them at module scope could run before then (seen in `yarn dev`) and crash the whole app with
      // "Cannot read properties of undefined (reading 'Instruction')". Loading them here, after the
      // app and its externals are up, avoids that race; if they still fail to load, skip them instead
      // of taking the app down.
      try {
        const [
          { default: StartProcessInstruction },
          { default: SendMessageInstruction },
          { default: ServiceTaskTrigger },
        ] = await Promise.all([
          import('./StartProcessInstruction'),
          import('./SendMessageInstruction'),
          import('./ServiceTaskTrigger'),
        ]);
        workflow.registerInstruction?.(START_INSTRUCTION, StartProcessInstruction);
        workflow.registerInstruction?.(MESSAGE_INSTRUCTION, SendMessageInstruction);
        workflow.registerTrigger?.(SERVICE_TASK_TRIGGER, ServiceTaskTrigger);
      } catch (err) {
        console.warn(
          '[plugin-bpm] BPMN workflow nodes were skipped: @nocobase/plugin-workflow/client-v2 failed to load.',
          err,
        );
      }
    }

    // The task inbox block of modern pages (STORY-082).
    this.flowEngine.registerModels({ BpmTaskInboxBlockModel });
  }
}

export default PluginBpmClientV2;
