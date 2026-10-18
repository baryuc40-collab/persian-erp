import { Instruction, JOB_STATUS } from '@nocobase/plugin-workflow';
import type { FlowNodeModel, Processor } from '@nocobase/plugin-workflow';
import { BpmEngineError, Variables } from './engine';
import type PluginBpmServer from './plugin';

export const START_INSTRUCTION = 'bpm-start';

export interface StartProcessConfig {
  processKey?: string;
  /** Usually "<collection>:<id>" (decision 0007, section 4); variables of the workflow are filled in first. */
  businessKey?: string;
  variables?: { name: string; value: unknown }[];
}

// Only the simple values of decision 0007; anything else is sent as JSON text.
const simple = (value: unknown): Variables[string] => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
};

/**
 * The workflow node «Start a BPMN process» (STORY-080): starts the process for a business key, or finds the instance
 * already running for it, and fails the node with a message when the engine cannot be reached.
 */
export class StartProcessInstruction extends Instruction {
  constructor(workflow: ConstructorParameters<typeof Instruction>[0], private bpm: PluginBpmServer) {
    super(workflow);
  }

  async run(node: FlowNodeModel, prevJob: unknown, processor: Processor) {
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
    const variables: Variables = {};
    for (const variable of config.variables || []) {
      if (variable?.name) variables[variable.name] = simple(variable.value);
    }
    try {
      const engine = await this.bpm.getEngine();
      const started = await engine.start(processKey, businessKey, variables);
      return { status: JOB_STATUS.RESOLVED, result: { ...started, processKey, businessKey } };
    } catch (error) {
      if (!(error instanceof BpmEngineError)) throw error;
      processor.logger.warn(`bpm-start (#${node.id}) failed: ${error.message}`);
      return { status: JOB_STATUS.FAILED, result: { error: await this.bpm.translate(error.message, error.values) } };
    }
  }
}

export default StartProcessInstruction;
