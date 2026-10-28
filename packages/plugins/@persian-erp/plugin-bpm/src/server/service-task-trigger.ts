import { Trigger } from '@nocobase/plugin-workflow';

export const SERVICE_TASK_TRIGGER = 'bpm-service-task';

export interface ServiceTaskTriggerConfig {
  /** The service task type in the BPMN model: the type of zeebe:taskDefinition, or operaton:topic in Operaton. */
  topic?: string;
}

/**
 * The workflow event «BPMN service task» (STORY-081). The worker starts these workflows itself, one per task it
 * fetches, and waits for the result to complete or fail the task; so they always run synchronously.
 */
export class ServiceTaskTrigger extends Trigger {
  sync = true;
}

export default ServiceTaskTrigger;
