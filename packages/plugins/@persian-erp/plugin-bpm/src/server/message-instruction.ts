import { randomUUID } from 'crypto';
import { Instruction, JOB_STATUS } from '@nocobase/plugin-workflow';
import type { FlowNodeModel, Processor } from '@nocobase/plugin-workflow';
import { sendFromNode } from './outbox';
import type PluginBpmServer from './plugin';
import { userOf, variablesOf } from './start-instruction';

export const MESSAGE_INSTRUCTION = 'bpm-message';
const DEFAULT_TTL_MINUTES = 60;

export interface SendMessageConfig {
  /** The message name in the BPMN model. */
  messageName?: string;
  /** The business key of the instance the message is for (its correlation key). */
  businessKey?: string;
  variables?: { name: string; value: unknown }[];
  /** How long a message may wait for its instance; 60 minutes unless set. */
  ttlMinutes?: number;
}

/**
 * The workflow node «Send a BPMN message» (STORY-094): sends a message to the process instance of a business key,
 * also before the instance waits for it. Like the start, it goes through the outbox when the engine is away.
 */
export class SendMessageInstruction extends Instruction {
  constructor(workflow: ConstructorParameters<typeof Instruction>[0], private bpm: PluginBpmServer) {
    super(workflow);
  }

  async run(node: FlowNodeModel, prevJob: { id?: unknown } | null, processor: Processor) {
    const config = processor.getParsedValue(node.config, node.id) as SendMessageConfig;
    const name = String(config.messageName || '').trim();
    const businessKey =
      config.businessKey === undefined || config.businessKey === null ? '' : String(config.businessKey).trim();
    if (!name || !businessKey) {
      return {
        status: JOB_STATUS.FAILED,
        result: { error: await this.bpm.translate('Choose a message and a business key') },
      };
    }
    const minutes = Number(config.ttlMinutes);
    const item = {
      kind: 'message' as const,
      name,
      businessKey,
      variables: variablesOf(config.variables),
      ttlMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TTL_MINUTES) * 60 * 1000,
      messageId: `nocobase-${randomUUID()}`,
    };
    return sendFromNode(this.bpm, item, node, prevJob, processor, userOf(processor));
  }

  async resume(node: FlowNodeModel, job: unknown) {
    return job;
  }
}

export default SendMessageInstruction;
