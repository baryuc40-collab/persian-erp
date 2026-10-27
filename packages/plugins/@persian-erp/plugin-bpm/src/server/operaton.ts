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

export type OperatonSettings = EngineSettings;

type Row = Record<string, any>;

// Variables of Operaton's REST API: {name: {value, type}}. Only the simple types of decision 0007 go in or come out.
const toOperaton = (variables: Variables = {}) =>
  Object.fromEntries(
    Object.entries(variables).map(([name, value]) => {
      if (value === null) return [name, { value: null, type: 'Null' }];
      if (typeof value === 'boolean') return [name, { value, type: 'Boolean' }];
      if (typeof value === 'number') return [name, { value, type: Number.isInteger(value) ? 'Long' : 'Double' }];
      return [name, { value: String(value), type: 'String' }];
    }),
  );

const fromOperaton = (variables: Row = {}): Variables =>
  Object.fromEntries(
    Object.entries(variables)
      .filter(
        ([, v]) => v && ['Null', 'Boolean', 'Integer', 'Long', 'Short', 'Double', 'String', 'Date'].includes(v.type),
      )
      .map(([name, v]) => [name, v.value ?? null]),
  );

// Dates of Operaton's REST API: 2026-10-27T22:07:55.616+0000.
const toOperatonDate = (date: Date) => date.toISOString().replace('Z', '+0000');
const fromOperatonDate = (text: string | null | undefined) =>
  text ? new Date(text.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString() : null;
// Pages of the history queries; a page that comes back full is followed by the next one.
const PAGE = 500;
// Where an instance waits is a task or event inside it, not the process or a container around them.
const CONTAINERS = ['processDefinition', 'subProcess', 'eventSubProcess', 'multiInstanceBody', 'transaction'];

/** The innermost activities of an activity instance tree. */
function waitingActivities(tree: Row): { id: string; name: string | null }[] {
  const children: Row[] = tree?.childActivityInstances || [];
  const transitions: Row[] = tree?.childTransitionInstances || [];
  const own = CONTAINERS.includes(tree?.activityType) ? [] : [{ id: tree.activityId, name: tree.activityName ?? null }];
  const inner = [
    ...children.flatMap(waitingActivities),
    ...transitions.map((t) => ({ id: t.activityId, name: t.activityName ?? null })),
  ];
  return inner.length ? inner : own;
}

const definition = (row: Row): ProcessDefinition => ({
  id: row.id,
  key: row.key,
  name: row.name ?? null,
  version: row.version,
  deploymentId: row.deploymentId,
});

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

const attributes = (text: string) =>
  Object.fromEntries(
    Array.from(text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g), ([, name, value]) => [name, decode(value)]),
  );

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FORM_TYPES = ['string', 'long', 'boolean', 'date', 'enum'];

/**
 * The form fields of a user task in a BPMN model (operaton:formField, as Camunda Modeler writes them). The models are
 * the ones an administrator deployed, so a small reader of these elements is enough.
 */
export function parseFormFields(xml: string, taskKey: string): FormField[] {
  const task = new RegExp(
    `<(?:[\\w-]+:)?userTask\\b[^>]*\\bid="${escapeRegExp(taskKey)}"[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?userTask>)`,
  ).exec(xml);
  const body = task?.[1] || '';
  return Array.from(body.matchAll(/<(?:[\w-]+:)?formField\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?formField>)/g)).map(
    ([, attrs, inner = '']) => {
      const field = attributes(attrs);
      const constraints = Array.from(inner.matchAll(/<(?:[\w-]+:)?constraint\b([^>]*?)\/?>/g), ([, a]) =>
        attributes(a),
      );
      return {
        id: field.id,
        label: field.label || null,
        type: (FORM_TYPES.includes(field.type) ? field.type : 'string') as FormField['type'],
        required: constraints.some((c) => c.name === 'required' && c.config !== 'false'),
        defaultValue: field.defaultValue ?? null,
        options: Array.from(inner.matchAll(/<(?:[\w-]+:)?value\b([^>]*?)\/?>/g), ([, a]) => {
          const value = attributes(a);
          return { id: value.id, name: value.name || null };
        }),
      };
    },
  );
}

/** The engine of decision 0007: Operaton (a Camunda 7 fork) through its REST API at <url>/engine-rest. */
export class OperatonEngine implements BpmEngine {
  private base: string;
  // Process definitions and their models never change once deployed, so they are kept by ID.
  private definitions = new Map<string, Promise<Row>>();
  private models = new Map<string, Promise<string>>();

  constructor(private settings: OperatonSettings) {
    this.base = `${settings.url.replace(/\/+$/, '')}/engine-rest`;
  }

  private call<T = any>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    return engineRequest<T>(this.settings, `${this.base}${path}`, { method, body, form });
  }

  async version() {
    return (await this.call<{ version: string }>('GET', '/version')).version;
  }

  async deploy(name: string, files: { name: string; content: string }[]) {
    const form = new FormData();
    form.append('deployment-name', name);
    // The same files again make no new version (checked in decision 0007).
    form.append('enable-duplicate-filtering', 'true');
    form.append('deploy-changed-only', 'true');
    for (const file of files) form.append(file.name, new Blob([file.content], { type: 'application/xml' }), file.name);
    const result = await this.call<Row>('POST', '/deployment/create', undefined, form);
    const processes = Object.values(result.deployedProcessDefinitions || {}).map(definition);
    return { id: result.id as string, processes };
  }

  async listProcesses() {
    const rows = await this.call<Row[]>('GET', '/process-definition?latestVersion=true&sortBy=key&sortOrder=asc');
    return rows.map(definition);
  }

  async start(processKey: string, businessKey: string, variables?: Variables) {
    // The engine does not keep business keys unique (decision 0007, section 6).
    const running = await this.call<Row[]>(
      'GET',
      `/process-instance?processDefinitionKey=${encodeURIComponent(processKey)}&businessKey=${encodeURIComponent(
        businessKey,
      )}`,
    );
    if (running.length) return { instanceId: running[0].id as string, created: false };
    const instance = await this.call<Row>('POST', `/process-definition/key/${encodeURIComponent(processKey)}/start`, {
      businessKey,
      variables: toOperaton(variables),
    });
    return { instanceId: instance.id as string, created: true };
  }

  async sendMessage(name: string, businessKey: string, variables?: Variables) {
    try {
      await this.call('POST', '/message', { messageName: name, businessKey, processVariables: toOperaton(variables) });
      return { delivered: true };
    } catch (error) {
      // Operaton answers 400 "Cannot correlate message" when no instance waits for it.
      if (error instanceof BpmEngineError && error.status === 400 && /correlate/i.test(String(error.values.message))) {
        return { delivered: false };
      }
      throw error;
    }
  }

  // Operaton keeps no message for later: it is delivered to an instance waiting now, or not at all. Correlating a
  // message twice delivers it twice, so the outbox sends it again only when the first one was not delivered.
  publishMessage(name: string, businessKey: string, variables: Variables = {}) {
    return this.sendMessage(name, businessKey, variables);
  }

  private definition(id: string) {
    if (!this.definitions.has(id)) {
      const row = this.call<Row>('GET', `/process-definition/${encodeURIComponent(id)}`);
      row.catch(() => this.definitions.delete(id));
      this.definitions.set(id, row);
    }
    return this.definitions.get(id);
  }

  async getTaskForm(task: UserTask) {
    const id = task.processDefinitionId;
    if (!this.models.has(id)) {
      const xml = this.call<Row>('GET', `/process-definition/${encodeURIComponent(id)}/xml`).then(
        (row) => row.bpmn20Xml as string,
      );
      xml.catch(() => this.models.delete(id));
      this.models.set(id, xml);
    }
    return parseFormFields(await this.models.get(id), task.taskKey);
  }

  private async userTask(row: Row): Promise<UserTask> {
    const links = await this.call<Row[]>('GET', `/task/${row.id}/identity-links?type=candidate`);
    const instance = row.processInstanceId
      ? await this.call<Row>('GET', `/process-instance/${row.processInstanceId}`).catch(() => null)
      : null;
    const definitionRow = await this.definition(row.processDefinitionId);
    return {
      id: row.id,
      name: row.name ?? null,
      taskKey: row.taskDefinitionKey,
      processKey: definitionRow.key,
      processName: definitionRow.name ?? null,
      processDefinitionId: row.processDefinitionId,
      processInstanceId: row.processInstanceId,
      businessKey: instance?.businessKey ?? null,
      assignee: row.assignee ?? null,
      candidateGroups: links.filter((l) => l.groupId).map((l) => l.groupId),
      created: row.created,
    };
  }

  async listUserTasks(filter: { candidateGroups?: string[]; assignee?: string; businessKey?: string }) {
    const query: Row = { sorting: [{ sortBy: 'created', sortOrder: 'desc' }] };
    if (filter.businessKey) query.processInstanceBusinessKey = filter.businessKey;
    const or: Row = {};
    if (filter.candidateGroups?.length) or.candidateGroups = filter.candidateGroups;
    if (filter.assignee) or.assignee = filter.assignee;
    if (Object.keys(or).length) query.orQueries = [or];
    const rows = await this.call<Row[]>('POST', '/task', query);
    return Promise.all(rows.map((row) => this.userTask(row)));
  }

  async getUserTask(taskId: string) {
    try {
      return await this.userTask(await this.call<Row>('GET', `/task/${encodeURIComponent(taskId)}`));
    } catch (error) {
      if (error instanceof BpmEngineError && error.status === 404) return null;
      throw error;
    }
  }

  async completeUserTask(taskId: string, variables?: Variables) {
    await this.call('POST', `/task/${encodeURIComponent(taskId)}/complete`, { variables: toOperaton(variables) });
  }

  async fetchServiceTasks(workerId: string, topics: { name: string; lockMs: number }[], max: number) {
    const rows = await this.call<Row[]>('POST', '/external-task/fetchAndLock', {
      workerId,
      maxTasks: max,
      topics: topics.map((topic) => ({ topicName: topic.name, lockDuration: topic.lockMs })),
    });
    return rows.map(
      (row): ServiceTask => ({
        id: row.id,
        topic: row.topicName,
        processKey: row.processDefinitionKey,
        processInstanceId: row.processInstanceId,
        businessKey: row.businessKey ?? null,
        variables: fromOperaton(row.variables),
        retries: row.retries ?? null,
      }),
    );
  }

  /** Every page of a query, up to `max` rows. */
  private async all(method: 'GET' | 'POST', path: string, body?: Row, max = 100 * PAGE): Promise<Row[]> {
    const rows: Row[] = [];
    const join = path.includes('?') ? '&' : '?';
    for (let first = 0; rows.length < max; first += PAGE) {
      const page = await this.call<Row[]>(method, `${path}${join}firstResult=${first}&maxResults=${PAGE}`, body);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  async getInstance(instanceId: string): Promise<InstanceState | null> {
    let row: Row;
    try {
      row = await this.call<Row>('GET', `/history/process-instance/${encodeURIComponent(instanceId)}`);
    } catch (error) {
      if (error instanceof BpmEngineError && error.status === 404) return null;
      throw error;
    }
    const running = row.state === 'ACTIVE' || row.state === 'SUSPENDED';
    const id = encodeURIComponent(instanceId);
    const [tree, incidents, tasks] = running
      ? await Promise.all([
          this.call<Row>('GET', `/process-instance/${id}/activity-instances`),
          this.call<Row[]>('GET', `/incident?processInstanceId=${id}`),
          this.all('GET', `/task?processInstanceId=${id}`),
        ])
      : [null, [], []];
    let status: InstanceState['status'] = 'completed';
    if (/TERMINATED/.test(row.state)) status = 'canceled';
    else if (running) status = incidents.length ? 'incident' : row.state === 'SUSPENDED' ? 'suspended' : 'active';
    return {
      instanceId: row.id,
      processKey: row.processDefinitionKey,
      version: row.processDefinitionVersion ?? null,
      businessKey: row.businessKey ?? null,
      status,
      startedAt: fromOperatonDate(row.startTime),
      endedAt: fromOperatonDate(row.endTime),
      steps: tree ? waitingActivities(tree) : [],
      tasks: await Promise.all(
        tasks.map(async (task) => {
          const links = await this.call<Row[]>('GET', `/task/${task.id}/identity-links?type=candidate`);
          return {
            id: task.id,
            name: task.name ?? null,
            assignee: task.assignee ?? null,
            candidateGroups: links.filter((l) => l.groupId).map((l) => l.groupId),
            dueAt: fromOperatonDate(task.due),
          };
        }),
      ),
    };
  }

  async changedInstances(processKeys: string[], since: Date) {
    if (!processKeys.length) return [];
    const after = toOperatonDate(since);
    const keys = { processDefinitionKeyIn: processKeys };
    const incidents = `processDefinitionKeyIn=${processKeys.map(encodeURIComponent).join(',')}`;
    // The task history takes one process key, not a list.
    const tasks = processKeys.flatMap((processDefinitionKey) => [
      this.all('POST', '/history/task', { processDefinitionKey, startedAfter: after }),
      this.all('POST', '/history/task', { processDefinitionKey, finishedAfter: after }),
    ]);
    const searches = await Promise.all([
      this.all('POST', '/history/process-instance', { ...keys, startedAfter: after }),
      this.all('POST', '/history/process-instance', { ...keys, finishedAfter: after }),
      ...tasks,
      this.all('GET', `/history/incident?${incidents}&createTimeAfter=${encodeURIComponent(after)}`),
      this.all('GET', `/history/incident?${incidents}&endTimeAfter=${encodeURIComponent(after)}`),
    ]);
    return [...new Set(searches.flat().map((row) => String(row.processInstanceId ?? row.id)))];
  }

  async activeInstances(processKeys: string[]) {
    if (!processKeys.length) return [];
    const rows = await this.all('POST', '/process-instance', { processDefinitionKeyIn: processKeys });
    return rows.map((row) => String(row.id));
  }

  async completeServiceTask(workerId: string, taskId: string, variables?: Variables) {
    await this.call('POST', `/external-task/${encodeURIComponent(taskId)}/complete`, {
      workerId,
      variables: toOperaton(variables),
    });
  }

  async failServiceTask(
    workerId: string,
    taskId: string,
    error: { message: string; retries: number; retryMs: number },
  ) {
    await this.call('POST', `/external-task/${encodeURIComponent(taskId)}/failure`, {
      workerId,
      errorMessage: error.message,
      retries: error.retries,
      retryTimeout: error.retryMs,
    });
  }
}
