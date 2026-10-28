import { Plugin } from '@nocobase/client';
import React from 'react';
// @ts-ignore
import pkg from '../../package.json';
import { BpmTaskInboxBlockModel } from '../client-v2/TaskInboxBlockModel';
import { BPM_SETTINGS_KEY, BpmSettings } from './BpmSettings';

const START_INSTRUCTION = 'bpm-start';
const MESSAGE_INSTRUCTION = 'bpm-message';
const SERVICE_TASK_TRIGGER = 'bpm-service-task';

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
    if (workflow?.registerInstruction || workflow?.registerTrigger) {
      // These node classes extend `Instruction`/`Trigger` from `@nocobase/plugin-workflow/client-v2`,
      // which this legacy client does not always provide; importing them at module scope could run
      // before that package's externals are ready (seen in `yarn dev`) and crash the whole app with
      // "Cannot read properties of undefined (reading 'Instruction')". Loading them here, after the
      // app is up, avoids that race; if `client-v2` genuinely is not available, skip them with a
      // warning instead of taking the app down.
      try {
        const [
          { default: StartProcessInstruction },
          { default: SendMessageInstruction },
          { default: ServiceTaskTrigger },
        ] = await Promise.all([
          import('../client-v2/StartProcessInstruction'),
          import('../client-v2/SendMessageInstruction'),
          import('../client-v2/ServiceTaskTrigger'),
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

export default PluginBpmClient;
