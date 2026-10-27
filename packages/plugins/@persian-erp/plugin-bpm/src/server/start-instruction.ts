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
      // Operaton does not keep business keys unique, so two starts for one key at once would make two instances
      // (decision 0007, section 6); Camunda 8 refuses the second, which then has to find the first by search. The app's
      // lock manager makes them wait for each other; across a cluster it needs the shared lock adapter of NocoBase's
      // cluster mode.
      const started = await this.bpm.app.lockManager.runExclusive(
        `bpm-start:${processKey}:${businessKey}`,
        () => engine.start(processKey, businessKey, variables),
        30 * 1000,
      );
      return { status: JOB_STATUS.RESOLVED, result: { ...started, processKey, businessKey } };
    } catch (error) {
      if (!(error instanceof BpmEngineError)) throw error;
      const message = await this.bpm.translate(error.message, error.values);
      processor.logger.warn(`bpm-start (#${node.id}) failed: ${message}`);
      return { status: JOB_STATUS.FAILED, result: { error: message } };
    }
  }
}

export default StartProcessInstruction;
