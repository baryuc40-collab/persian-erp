import {
  BpmEngine,
  BpmEngineError,
  FormField,
  InstanceState,
  ProcessDefinition,
  ServiceTask,
  UserTask,
  Variables,
} from './engine';
import { EngineSettings, engineRequest } from './http';

export type Camunda8Settings = EngineSettings;

type Row = Record<string, any>;

// Open user tasks; COMPLETING, COMPLETED, CANCELING, CANCELED and FAILED are no longer the user's to do.
const OPEN_TASK_STATES = ['CREATED', 'ASSIGNING', 'UPDATING'];
// Searches read the engine's secondary storage, which follows the commands by a second or two (decision 0008).
// A task completed here stays hidden this long, so the inbox does not show it again in the meantime.
const COMPLETED_HIDE_MS = 60 * 1000;
const SEARCH_LIMIT = 1000;
// Where an instance waits is a task or event inside it, not the process or a container around them.
const CONTAINERS = ['PROCESS', 'SUB_PROCESS', 'EVENT_SUB_PROCESS', 'AD_HOC_SUB_PROCESS', 'MULTI_INSTANCE_BODY'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only the simple values of decision 0007 come out of the engine. */
const simpleVariables = (variables: Row = {}): Variables =>
  Object.fromEntries(
    Object.entries(variables).filter(
      ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
    ),
  );

const FORM_INPUTS: Record<string, FormField['type']> = {
  textfield: 'string',
  textarea: 'string',
  number: 'long',
  checkbox: 'boolean',
  datetime: 'date',
  select: 'enum',
  radio: 'enum',
};

/**
 * The fields of a Camunda form (form-js schema): inputs with a key, also inside groups. Inputs that hold more than one
 * value (checklist, taglist) and display-only components are left out, since only simple values go to the engine.
 */
export function parseCamundaForm(schema: string | Row | null | undefined): FormField[] {
  let form: Row | null = null;
  try {
    form = typeof schema === 'string' ? JSON.parse(schema) : schema || null;
  } catch {
    return [];
  }
  const fields: FormField[] = [];
  const walk = (components: Row[] = []) => {
    for (const component of components) {
      if (Array.isArray(component.components)) walk(component.components);
      const type = FORM_INPUTS[component.type];
      if (!type || !component.key) continue;
      const defaultValue = component.defaultValue;
      fields.push({
        id: component.key,
        label: component.label || null,
        type,
        // A checkbox always gives a value, false when left unchecked (and «required» in form-js means it must be
        // ticked); the inbox shows it as yes or no, so one of the two has to be chosen.
        required: component.type === 'checkbox' || !!component.validate?.required,
        defaultValue: defaultValue === undefined || defaultValue === null ? null : String(defaultValue),
        options: (Array.isArray(component.values) ? component.values : []).map((value: Row) => ({
          id: String(value.value),
          name: value.label ?? null,
        })),
      });
    }
  };
  walk(form?.components);
  return fields;
}

/** The name of a process in a model, for the deploy result; the engine's answer does not carry it. */
const processNames = (files: { name: string; content: string }[]) => {
  const names = new Map<string, string>();
  for (const file of files) {
    for (const [, attrs] of file.content.matchAll(/<(?:[\w-]+:)?process\b([^>]*)>/g)) {
      const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
      const name = /\bname="([^"]*)"/.exec(attrs)?.[1];
      if (id && name) names.set(id, name);
    }
  }
  return names;
};

/**
 * The engine of decision 0008: Camunda 8 (the Orchestration Cluster) through its REST API v2 at <url>/v2. Business
 * keys are the engine's business IDs, which it keeps unique (BUSINESSIDUNIQUENESSENABLED); user tasks are Camunda user
 * tasks (zeebe:userTask) with a linked Camunda form; service tasks are jobs, whose type is the topic.
 */
export class Camunda8Engine implements BpmEngine {
  private base: string;
  // Process definitions never change once deployed, so their names are kept by key.
  private definitions = new Map<string, Promise<Row | null>>();
  private completed = new Map<string, number>();

  constructor(private settings: Camunda8Settings) {
    this.base = `${settings.url.replace(/\/+$/, '')}/v2`;
  }

  private call<T = any>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    return engineRequest<T>(this.settings, `${this.base}${path}`, { method, body, form });
  }

  private async search(path: string, body: Row): Promise<Row[]> {
    const result = await this.call<Row>('POST', path, { ...body, page: { limit: SEARCH_LIMIT, ...body.page } });
    return result?.items || [];
  }

  /** Every page of a search, up to `max` rows. */
  private async searchAll(path: string, body: Row, max = 100 * SEARCH_LIMIT): Promise<Row[]> {
    const rows: Row[] = [];
    let after: string | undefined;
    while (rows.length < max) {
      const result = await this.call<Row>('POST', path, { ...body, page: { limit: SEARCH_LIMIT, after } });
      const items: Row[] = result?.items || [];
      rows.push(...items);
      after = result?.page?.endCursor;
      if (items.length < SEARCH_LIMIT || !after) break;
    }
    return rows;
  }

  async version() {
    return (await this.call<Row>('GET', '/topology')).gatewayVersion as string;
  }

  async deploy(name: string, files: { name: string; content: string }[]) {
    const form = new FormData();
    for (const file of files) {
      const type = /\.form$/i.test(file.name) ? 'application/json' : 'application/xml';
      form.append('resources', new Blob([file.content], { type }), file.name);
    }
    // The same file under the same name makes no new version: the answer names the version already there.
    const result = await this.call<Row>('POST', '/deployments', undefined, form);
    const names = processNames(files);
    const processes = (result.deployments || [])
      .map((item: Row) => item.processDefinition)
      .filter(Boolean)
      .map(
        (row: Row): ProcessDefinition => ({
          id: String(row.processDefinitionKey),
          key: row.processDefinitionId,
          name: names.get(row.processDefinitionId) ?? null,
          version: row.processDefinitionVersion,
          deploymentId: String(result.deploymentKey),
        }),
      );
    return { id: String(result.deploymentKey), processes };
  }

  async listProcesses() {
    const rows = await this.search('/process-definitions/search', {
      filter: { isLatestVersion: true },
      sort: [{ field: 'processDefinitionId', order: 'asc' }],
    });
    return rows.map(
      (row): ProcessDefinition => ({
        id: String(row.processDefinitionKey),
        key: row.processDefinitionId,
        name: row.name ?? null,
        version: row.version,
        deploymentId: '',
      }),
    );
  }

  private async runningInstance(processKey: string, businessKey: string) {
    const [row] = await this.search('/process-instances/search', {
      filter: { processDefinitionId: processKey, businessId: businessKey, state: 'ACTIVE' },
      page: { limit: 1 },
    });
    return row ? String(row.processInstanceKey) : null;
  }

  async start(processKey: string, businessKey: string, variables: Variables = {}) {
    try {
      const instance = await this.call<Row>('POST', '/process-instances', {
        processDefinitionId: processKey,
        businessId: businessKey,
        // Also a variable, so a message event of the model correlates with =businessKey (STORY-094).
        variables: { ...variables, businessKey },
      });
      return { instanceId: String(instance.processInstanceKey), created: true };
    } catch (error) {
      if (!(error instanceof BpmEngineError && error.code === 'ALREADY_EXISTS')) throw error;
    }
    // The engine refused a second instance for the key. The first one may be too new for the search, so it is looked
    // for a few times before giving up on its ID.
    for (let attempt = 0; attempt < 6; attempt++) {
      const instanceId = await this.runningInstance(processKey, businessKey);
      if (instanceId) return { instanceId, created: false };
      await sleep(500 * (attempt + 1));
    }
    return { instanceId: null, created: false };
  }

  async sendMessage(name: string, businessKey: string, variables: Variables = {}) {
    try {
      await this.call('POST', '/messages/correlation', { name, correlationKey: businessKey, variables });
      return { delivered: true };
    } catch (error) {
      if (error instanceof BpmEngineError && error.code === 'NOT_FOUND') return { delivered: false };
      throw error;
    }
  }

  async publishMessage(
    name: string,
    businessKey: string,
    variables: Variables = {},
    options: { ttlMs: number; messageId: string },
  ) {
    try {
      await this.call('POST', '/messages/publication', {
        name,
        correlationKey: businessKey,
        timeToLive: options.ttlMs,
        messageId: options.messageId,
        variables,
      });
    } catch (error) {
      // Published before, by a send whose answer was lost.
      if (!(error instanceof BpmEngineError && error.code === 'ALREADY_EXISTS')) throw error;
    }
    return { delivered: true };
  }

  private definition(key: string) {
    if (!this.definitions.has(key)) {
      const row = this.call<Row>('GET', `/process-definitions/${encodeURIComponent(key)}`).catch((error) => {
        this.definitions.delete(key);
        if (error instanceof BpmEngineError && error.status === 404) return null;
        throw error;
      });
      this.definitions.set(key, row);
    }
    return this.definitions.get(key);
  }

  private hidden(taskId: string) {
    const until = this.completed.get(taskId);
    if (until && until < Date.now()) this.completed.delete(taskId);
    return !!until && until >= Date.now();
  }

  private async userTask(row: Row): Promise<UserTask> {
    const definition = row.processName ? null : await this.definition(String(row.processDefinitionKey));
    return {
      id: String(row.userTaskKey),
      name: row.name ?? null,
      taskKey: row.elementId,
      processKey: row.processDefinitionId,
      processName: row.processName ?? definition?.name ?? null,
      processDefinitionId: String(row.processDefinitionKey),
      processInstanceId: String(row.processInstanceKey),
      businessKey: row.businessId ?? null,
      assignee: row.assignee ?? null,
      candidateGroups: row.candidateGroups || [],
      created: row.creationDate,
    };
  }

  async listUserTasks(filter: { candidateGroups?: string[]; assignee?: string; businessKey?: string }) {
    const query: Row = { state: { $in: OPEN_TASK_STATES } };
    if (filter.businessKey) query.businessId = filter.businessKey;
    const or: Row[] = [];
    if (filter.candidateGroups?.length) or.push({ candidateGroup: { $in: filter.candidateGroups } });
    if (filter.assignee) or.push({ assignee: filter.assignee });
    if (or.length) query.$or = or;
    const rows = await this.search('/user-tasks/search', {
      filter: query,
      sort: [{ field: 'creationDate', order: 'desc' }],
    });
    return Promise.all(rows.filter((row) => !this.hidden(String(row.userTaskKey))).map((row) => this.userTask(row)));
  }

  async getUserTask(taskId: string) {
    if (this.hidden(taskId)) return null;
    let row: Row;
    try {
      row = await this.call<Row>('GET', `/user-tasks/${encodeURIComponent(taskId)}`);
    } catch (error) {
      // 400 for a key that is not a number, 404 for one the engine does not know.
      if (error instanceof BpmEngineError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }
    return OPEN_TASK_STATES.includes(row.state) ? this.userTask(row) : null;
  }

  async getTaskForm(task: UserTask) {
    try {
      const form = await this.call<Row>('GET', `/user-tasks/${encodeURIComponent(task.id)}/form`);
      return parseCamundaForm(form?.schema);
    } catch (error) {
      // A task without a linked form.
      if (error instanceof BpmEngineError && error.status === 404) return [];
      throw error;
    }
  }

  async completeUserTask(taskId: string, variables: Variables = {}) {
    await this.call('POST', `/user-tasks/${encodeURIComponent(taskId)}/completion`, { variables });
    this.completed.set(taskId, Date.now() + COMPLETED_HIDE_MS);
  }

  async fetchServiceTasks(workerId: string, topics: { name: string; lockMs: number }[], max: number) {
    // One activation per type; no long polling, since the worker polls on its own interval.
    const tasks: ServiceTask[] = [];
    for (const topic of topics) {
      if (tasks.length >= max) break;
      const result = await this.call<Row>('POST', '/jobs/activation', {
        type: topic.name,
        worker: workerId,
        timeout: topic.lockMs,
        maxJobsToActivate: max - tasks.length,
        requestTimeout: -1,
      });
      for (const job of result?.jobs || []) {
        tasks.push({
          id: String(job.jobKey),
          topic: job.type,
          processKey: job.processDefinitionId,
          processInstanceId: String(job.processInstanceKey),
          businessKey: job.businessId ?? null,
          variables: simpleVariables(job.variables),
          retries: job.retries ?? null,
        });
      }
    }
    return tasks;
  }

  // Jobs are not bound to a worker for reports: any client may complete or fail an activated job.
  async getInstance(instanceId: string): Promise<InstanceState | null> {
    let row: Row;
    try {
      row = await this.call<Row>('GET', `/process-instances/${encodeURIComponent(instanceId)}`);
    } catch (error) {
      if (error instanceof BpmEngineError && error.status === 404) return null;
      throw error;
    }
    const running = row.state === 'ACTIVE';
    const [elements, tasks] = running
      ? await Promise.all([
          this.searchAll('/element-instances/search', { filter: { processInstanceKey: instanceId, state: 'ACTIVE' } }),
          this.searchAll('/user-tasks/search', {
            filter: { processInstanceKey: instanceId, state: { $in: OPEN_TASK_STATES } },
          }),
        ])
      : [[], []];
    let status: InstanceState['status'] = 'completed';
    if (row.state === 'TERMINATED') status = 'canceled';
    else if (running) status = row.hasIncident ? 'incident' : row.suspendedDate ? 'suspended' : 'active';
    return {
      instanceId: String(row.processInstanceKey),
      processKey: row.processDefinitionId,
      version: row.processDefinitionVersion ?? null,
      businessKey: row.businessId ?? null,
      status,
      startedAt: row.startDate ?? null,
      endedAt: row.endDate ?? null,
      steps: elements
        .filter((element) => !CONTAINERS.includes(element.type))
        .map((element) => ({ id: element.elementId, name: element.elementName ?? null })),
      tasks: tasks
        .filter((task) => !this.hidden(String(task.userTaskKey)))
        .map((task) => ({
          id: String(task.userTaskKey),
          name: task.name ?? null,
          assignee: task.assignee ?? null,
          candidateGroups: task.candidateGroups || [],
          dueAt: task.dueDate ?? null,
        })),
    };
  }

  async changedInstances(processKeys: string[], since: Date) {
    if (!processKeys.length) return [];
    const after = { $gt: since.toISOString() };
    const processes = { processDefinitionId: { $in: processKeys } };
    const searches = await Promise.all([
      this.searchAll('/process-instances/search', { filter: { ...processes, startDate: after } }),
      this.searchAll('/process-instances/search', { filter: { ...processes, endDate: after } }),
      this.searchAll('/user-tasks/search', { filter: { ...processes, creationDate: after } }),
      this.searchAll('/user-tasks/search', { filter: { ...processes, completionDate: after } }),
      this.searchAll('/incidents/search', { filter: { ...processes, creationTime: after } }),
    ]);
    return [...new Set(searches.flat().map((row) => String(row.processInstanceKey)))];
  }

  async activeInstances(processKeys: string[]) {
    if (!processKeys.length) return [];
    const rows = await this.searchAll('/process-instances/search', {
      filter: { processDefinitionId: { $in: processKeys }, state: 'ACTIVE' },
    });
    return rows.map((row) => String(row.processInstanceKey));
  }

  async completeServiceTask(workerId: string, taskId: string, variables: Variables = {}) {
    await this.call('POST', `/jobs/${encodeURIComponent(taskId)}/completion`, { variables });
  }

  async failServiceTask(
    workerId: string,
    taskId: string,
    error: { message: string; retries: number; retryMs: number },
  ) {
    await this.call('POST', `/jobs/${encodeURIComponent(taskId)}/failure`, {
      errorMessage: error.message,
      retries: error.retries,
      retryBackOff: error.retryMs,
    });
  }
}
