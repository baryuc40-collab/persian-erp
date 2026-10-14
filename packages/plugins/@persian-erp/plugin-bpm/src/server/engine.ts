// The engine interface of decision 0007, section 3. The plugin talks to a BPMN engine only through it, so another
// engine needs another adapter and nothing else.

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
  processKey: string;
  processInstanceId: string;
  businessKey: string | null;
  assignee: string | null;
  candidateGroups: string[];
  created: string;
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
  /** Starts a process for a business key, or returns the instance already running for it. */
  start(
    processKey: string,
    businessKey: string,
    variables?: Variables,
  ): Promise<{ instanceId: string; created: boolean }>;
  sendMessage(name: string, businessKey: string, variables?: Variables): Promise<void>;
  listUserTasks(filter: { candidateGroups?: string[]; assignee?: string; businessKey?: string }): Promise<UserTask[]>;
  getUserTask(taskId: string): Promise<UserTask | null>;
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
  constructor(message: string, public values: Record<string, unknown> = {}, public status?: number) {
    super(message);
  }
}
