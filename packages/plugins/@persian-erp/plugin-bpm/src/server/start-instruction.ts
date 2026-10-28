import { Instruction, JOB_STATUS } from '@nocobase/plugin-workflow';
import type { FlowNodeModel, Processor } from '@nocobase/plugin-workflow';
import { Variables } from './engine';
import { sendFromNode } from './outbox';
import type PluginBpmServer from './plugin';

export const START_INSTRUCTION = 'bpm-start';

export interface StartProcessConfig {
  processKey?: string;
  /** Usually "<collection>:<id>" (decision 0007, section 4); variables of the workflow are filled in first. */
  businessKey?: string;
  variables?: { name: string; value: unknown }[];
}

// Only the simple values of decision 0007; anything else is sent as JSON text.
export const simple = (value: unknown): Variables[string] => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
};

export function variablesOf(list: { name: string; value: unknown }[] = []) {
  const variables: Variables = {};
  for (const variable of list) {
    if (variable?.name) variables[variable.name] = simple(variable.value);
  }
  return variables;
}

/**
 * The NocoBase user behind the execution: the user of an action event, else who last changed or made the record of a
 * collection event; none for a schedule.
 */
export function userOf(processor: Processor) {
  const context = (processor.execution?.context || {}) as {
    user?: { id?: number | string };
    data?: { updatedById?: number | string; createdById?: number | string };
  };
  return context.user?.id ?? context.data?.updatedById ?? context.data?.createdById ?? null;
}

/**
 * The workflow node «Start a BPMN process» (STORY-080): starts the process for a business key, or finds the instance
 * already running for it. When the engine is away the start waits in the outbox and the node with it (STORY-094); when
 * the engine refuses it the node fails with the engine's message.
 */
export class StartProcessInstruction extends Instruction {
  constructor(workflow: ConstructorParameters<typeof Instruction>[0], private bpm: PluginBpmServer) {
    super(workflow);
  }

  async run(node: FlowNodeModel, prevJob: { id?: unknown } | null, processor: Processor) {
    const config = processor.getParsedValue(node.config, node.id) as StartProcessConfig;
    const processKey = String(config.processKey || '').trim();
    const businessKey =
      config.businessKey === undefined || config.businessKey === null ? '' : String(config.businessKey).trim();
    if (!processKey || !businessKey) {
      return {
        status: JOB_STATUS.FAILED,
        result: { error: await this.bpm.translate('Choose a process and a business key') },
      };
    }
    const item = { kind: 'start' as const, processKey, businessKey, variables: variablesOf(config.variables) };
    return sendFromNode(this.bpm, item, node, prevJob, processor, userOf(processor));
  }

  // The outbox has set the job's status and result when it sent the start or gave up on it.
  async resume(node: FlowNodeModel, job: unknown) {
    return job;
  }
}

export default StartProcessInstruction;
