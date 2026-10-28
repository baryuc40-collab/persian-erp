// The engine interface of decision 0007, section 3, and decision 0008, section 4. The plugin talks to a BPMN engine
// only through it, so another engine needs another adapter and nothing else. IDs are text: the keys of Camunda 8 are
// 64-bit numbers.

/** The engines with an adapter: Camunda 8 (camunda8.ts) and Operaton (operaton.ts). */
export const ENGINES = ['camunda8', 'operaton'] as const;
export type EngineKind = typeof ENGINES[number];

/** Simple values only: text, numbers, booleans, and dates as ISO strings in UTC. */
export type Variables = Record<string, string | number | boolean | null>;

export interface ProcessDefinition {
  id: string;
  key: string;
  name: string | null;
  version: number;
  deploymentId: string;
}

export interface UserTask {
  id: string;
  name: string | null;
  /** The ID of the task in the model, like `approve`. */
  taskKey: string;
  processKey: string;
  processName: string | null;
  processDefinitionId: string;
  processInstanceId: string;
  businessKey: string | null;
  assignee: string | null;
  candidateGroups: string[];
  created: string;
}

/** A field of a user task's form, as the model declares it (operaton:formField, or a linked Camunda form). */
export interface FormField {
  id: string;
  label: string | null;
  type: 'string' | 'long' | 'boolean' | 'date' | 'enum';
  required: boolean;
  defaultValue: string | null;
  /** The choices of an enum field. */
  options: { id: string; name: string | null }[];
}

export interface ServiceTask {
  id: string;
  topic: string;
  processKey: string;
  processInstanceId: string;
  businessKey: string | null;
  variables: Variables;
  retries: number | null;
}

export interface BpmEngine {
  version(): Promise<string>;
  deploy(
    name: string,
    files: { name: string; content: string }[],
  ): Promise<{ id: string; processes: ProcessDefinition[] }>;
  /** The latest version of each process. */
  listProcesses(): Promise<ProcessDefinition[]>;
  /**
   * Starts a process for a business key, or returns the instance already running for it. The instance ID is null when
   * the engine refused a second instance but does not list the first one yet.
   */
  start(
    processKey: string,
    businessKey: string,
    variables?: Variables,
  ): Promise<{ instanceId: string | null; created: boolean }>;
  /** Correlates a message to the instance of a business key that waits for it; `delivered` is false when none does. */
  sendMessage(name: string, businessKey: string, variables?: Variables): Promise<{ delivered: boolean }>;
  /**
   * Sends a message that may come before its instance waits for it (STORY-094). Camunda 8 keeps it for ttlMs and
   * delivers it when an instance waits; Operaton only delivers it to one waiting now, else `delivered` is false. The
   * same messageId again does nothing, so a message sent twice after a lost answer arrives once.
   */
  publishMessage(
    name: string,
    businessKey: string,
    variables: Variables,
    options: { ttlMs: number; messageId: string },
  ): Promise<{ delivered: boolean }>;
  listUserTasks(filter: { candidateGroups?: string[]; assignee?: string; businessKey?: string }): Promise<UserTask[]>;
  getUserTask(taskId: string): Promise<UserTask | null>;
  /** The form fields of the task in its model; none when the model declares no form. */
  getTaskForm(task: UserTask): Promise<FormField[]>;
  completeUserTask(taskId: string, variables?: Variables): Promise<void>;
  fetchServiceTasks(workerId: string, topics: { name: string; lockMs: number }[], max: number): Promise<ServiceTask[]>;
  completeServiceTask(workerId: string, taskId: string, variables?: Variables): Promise<void>;
  failServiceTask(
    workerId: string,
    taskId: string,
    error: { message: string; retries: number; retryMs: number },
  ): Promise<void>;
}

/** An engine error with a message the plugin translates; `values` fill its placeholders. */
export class BpmEngineError extends Error {
  /** The engine's own error code, such as ALREADY_EXISTS or NOT_FOUND of Camunda 8. */
  code?: string;

  constructor(message: string, public values: Record<string, unknown> = {}, public status?: number) {
    super(message);
  }
}
