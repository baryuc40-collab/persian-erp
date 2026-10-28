import { EXECUTION_STATUS, JOB_STATUS } from '@nocobase/plugin-workflow';
import type { Transaction } from 'sequelize';
import { BpmEngineError, InstanceState } from './engine';
import type { PluginBpmServer } from './plugin';
import { splitBusinessKey } from './worker';

export const PROCESSES_COLLECTION = 'bpmProcesses';
export const INSTANCES_COLLECTION = 'bpmInstances';
export const BUILDERS = ['nocobase', 'camunda'] as const;
export type Builder = typeof BUILDERS[number];
/** An instance in one of these still runs. */
export const OPEN_STATUSES = ['active', 'suspended', 'incident'];

const STATUS_OF_EXECUTION = new Map<number | null, string>([
  [EXECUTION_STATUS.QUEUEING, 'active'],
  [EXECUTION_STATUS.STARTED, 'active'],
  [EXECUTION_STATUS.RESOLVED, 'completed'],
  [EXECUTION_STATUS.FAILED, 'failed'],
  [EXECUTION_STATUS.ERROR, 'failed'],
  [EXECUTION_STATUS.ABORTED, 'canceled'],
  [EXECUTION_STATUS.CANCELED, 'canceled'],
  [EXECUTION_STATUS.REJECTED, 'rejected'],
  // Waits for a person to run it again.
  [-6, 'incident'],
]);

// The fields compared with the row to tell what changed.
const TRACKED = [
  'processId',
  'processKey',
  'version',
  'businessKey',
  'recordCollection',
  'recordId',
  'requesterId',
  'status',
  'currentStep',
  'currentStepId',
  'assigneeId',
  'candidateGroups',
  'dueAt',
  'startedAt',
  'endedAt',
];

export interface RegistryOptions {
  /** Milliseconds between two looks at the engine for changed instances. */
  interval: number;
  /** How far back the first look after a start goes; the nightly check covers anything older. */
  lookbackMs: number;
  /** Each look also goes this far behind the last one, as the engine's searches follow it by a moment. */
  overlapMs: number;
  /** Instances read from the engine at the same time. */
  concurrency: number;
}

const DEFAULTS: RegistryOptions = { interval: 5000, lookbackMs: 60 * 60 * 1000, overlapMs: 10 * 1000, concurrency: 4 };
const DAY_MS = 24 * 60 * 60 * 1000;
// Another app instance of a cluster changes bpmProcesses without this one seeing it, so the list is read again after this.
const PROCESSES_TTL_MS = 60 * 1000;

type Values = Record<string, unknown>;
type Row = { get(name: string): any };

const same = (a: unknown, b: unknown) => {
  if (a === undefined || a === null || b === undefined || b === null) return (a ?? null) === (b ?? null);
  if (a instanceof Date || b instanceof Date)
    return new Date(a as string).getTime() === new Date(b as string).getTime();
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
};

/** A NocoBase user ID of the engine's assignee, which the task inbox sets to the user ID. */
const userIdOf = (assignee: string | null | undefined) => (assignee && /^\d+$/.test(assignee) ? assignee : null);

/** The collection name of a workflow's collection, which may carry its data source: `main:posts`. */
const collectionOf = (name: unknown) => {
  if (typeof name !== 'string' || !name) return null;
  const [source, collection] = name.includes(':') ? name.split(':') : ['main', name];
  return source === 'main' ? collection : name;
};

/**
 * The process registry of STORY-095: keeps bpmInstances up to date for the processes of bpmProcesses. NocoBase
 * workflows update their row at once, from the database events of executions, jobs and manual tasks. Instances of the
 * engine are updated after each change the plugin makes, by a look every few seconds for instances the engine changed
 * (also through Operate or its REST API), and by a nightly check of every open instance. A change the plugin did not
 * make is logged in bpmEvents.
 */
export class BpmRegistry {
  options: RegistryOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private since: Date | null = null;
  private lastError: string | null = null;
  private processes: Promise<Map<string, Row>> | null = null;
  private processesAt = 0;
  private versions = new Map<string, number>();
  private queue = new Map<string, { builder: Builder; id: string; event?: string }>();
  private flushing: Promise<void> | null = null;

  constructor(private bpm: PluginBpmServer, options: Partial<RegistryOptions> = {}) {
    const given = Object.entries(options).filter(([, value]) => value !== undefined && !Number.isNaN(value));
    this.options = { ...DEFAULTS, ...Object.fromEntries(given) };
  }

  private get db() {
    return this.bpm.db;
  }

  private get logger() {
    return this.bpm.app.logger;
  }

  private get instances() {
    return this.db.getRepository(INSTANCES_COLLECTION);
  }

  /** The marked processes by `<builder>:<key>`, read again after each change of bpmProcesses and every minute. */
  private processMap() {
    if (!this.processes || Date.now() - this.processesAt > PROCESSES_TTL_MS) {
      this.processesAt = Date.now();
      this.processes = this.db
        .getRepository(PROCESSES_COLLECTION)
        .find({ filter: { enabled: true } })
        .then((rows: Row[]) => new Map(rows.map((row) => [`${row.get('builder')}:${row.get('key')}`, row])));
      this.processes.catch(() => (this.processes = null));
    }
    return this.processes;
  }

  async processOf(builder: Builder, key: string | null | undefined) {
    return key ? (await this.processMap()).get(`${builder}:${key}`) ?? null : null;
  }

  async keysOf(builder: Builder) {
    return [...(await this.processMap()).values()]
      .filter((row) => row.get('builder') === builder)
      .map((row) => row.get('key') as string);
  }

  /** Runs work once the transaction around it is saved, or now when there is none. */
  private afterCommit(options: { transaction?: Transaction } | undefined, run: () => unknown) {
    if (options?.transaction) {
      options.transaction.afterCommit(() => {
        run();
      });
    } else {
      run();
    }
  }

  /** The database events of NocoBase workflows and of the process list. */
  listen() {
    const db = this.db;
    const execution = (id: unknown, options?: { transaction?: Transaction }) => {
      if (id !== undefined && id !== null) this.afterCommit(options, () => this.schedule('nocobase', String(id)));
    };
    db.on('executions.afterCreate', (row: Row, options) => execution(row.get('id'), options));
    db.on('executions.afterUpdate', (row: Row, options) => execution(row.get('id'), options));
    // The dispatcher starts an execution with an update of the model.
    db.on('executions.afterBulkUpdate', (options) => {
      const id = options?.where?.id;
      if (typeof id === 'string' || typeof id === 'number' || typeof id === 'bigint') execution(id, options);
    });
    db.on('jobs.afterCreate', (row: Row, options) => execution(row.get('executionId'), options));
    db.on('jobs.afterBulkCreate', (rows: Row[], options) => {
      for (const id of new Set(rows.map((row) => row.get('executionId')))) execution(id, options);
    });
    db.on('workflowManualTasks.afterCreate', (row: Row, options) => execution(row.get('executionId'), options));
    db.on('workflowManualTasks.afterUpdate', (row: Row, options) => execution(row.get('executionId'), options));
    const changed = (row: Row, options) =>
      this.afterCommit(options, () => {
        this.processes = null;
        this.backfill(row).catch((error) => this.warn('the instances of a new process were not read', error));
      });
    db.on(`${PROCESSES_COLLECTION}.afterSave`, changed);
    db.on(`${PROCESSES_COLLECTION}.afterDestroy`, (row: Row, options) =>
      this.afterCommit(options, () => (this.processes = null)),
    );
  }

  private warn(what: string, error: unknown) {
    const message = (error as Error)?.message || String(error);
    if (message !== this.lastError) this.logger.warn(`bpm registry: ${what}: ${message}`, { module: 'bpm' });
    this.lastError = message;
  }

  /** Reads an instance again soon; the same instance asked for twice is read once. */
  schedule(builder: Builder, id: string, event?: string) {
    const key = `${builder}:${id}`;
    if (!this.queue.has(key) || event) this.queue.set(key, { builder, id, event });
    if (!this.flushing) {
      this.flushing = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => this.flush())
        .finally(() => (this.flushing = null));
    }
    return this.flushing;
  }

  /** Reads an instance of the engine again after a while, when its searches have caught up with a change. */
  later(builder: Builder, id: string, ms = 3000) {
    setTimeout(() => this.schedule(builder, id), ms).unref?.();
  }

  /** Until nothing more is asked for; resolves when the instances asked for so far are read. */
  async idle() {
    while (this.flushing) await this.flushing;
  }

  private async flush() {
    while (this.queue.size) {
      const items = [...this.queue.values()];
      this.queue.clear();
      await this.all(items.map((item) => () => this.refresh(item.builder, item.id, item.event)));
    }
  }

  private async all(tasks: (() => Promise<unknown>)[]) {
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        try {
          await task();
        } catch (error) {
          this.warn('an instance was not read', error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.options.concurrency, tasks.length) }, worker));
  }

  /** Reads an instance from its source and updates its row; returns the row, or null when it is not a process's. */
  async refresh(builder: Builder, id: string, event?: string) {
    if (builder === 'nocobase') return this.refreshExecution(id);
    return this.refreshEngineInstance(id, event ?? 'instance.sync');
  }

  private async versionOf(workflowId: unknown, key: string) {
    const cached = this.versions.get(String(workflowId));
    if (cached) return cached;
    const version = await this.db.getRepository('workflows').count({ filter: { key, id: { $lte: workflowId } } });
    this.versions.set(String(workflowId), version);
    return version;
  }

  async refreshExecution(id: string) {
    if (!(await this.keysOf('nocobase')).length) return null;
    const execution = await this.db.getRepository('executions').findOne({ filterByTk: id });
    if (!execution) return null;
    const key = execution.get('key') as string;
    const process = await this.processOf('nocobase', key);
    if (!process) return null;
    const workflow = await this.db.getRepository('workflows').findOne({ filterByTk: execution.get('workflowId') });
    const [job] = await this.db.getRepository('jobs').find({
      filter: { executionId: id, status: JOB_STATUS.PENDING },
      sort: ['-createdAt', '-id'],
      limit: 1,
    });
    const node = job ? await this.db.getRepository('flow_nodes').findOne({ filterByTk: job.get('nodeId') }) : null;
    const assignees =
      job && this.db.getCollection('workflowManualTasks')
        ? (
            await this.db.getRepository('workflowManualTasks').find({
              filter: { jobId: job.get('id'), status: JOB_STATUS.PENDING },
              sort: ['userId'],
            })
          ).map((task: Row) => task.get('userId'))
        : [];
    const context = (execution.get('context') || {}) as {
      data?: Record<string, any>;
      user?: { id?: unknown };
    };
    const collection = collectionOf(workflow?.get('config')?.collection);
    const primaryKey = (collection && this.db.getCollection(collection)?.filterTargetKey) || 'id';
    const recordId = context.data?.[primaryKey as string];
    const businessKey = collection && recordId !== undefined && recordId !== null ? `${collection}:${recordId}` : null;
    const status = STATUS_OF_EXECUTION.get(execution.get('status')) ?? 'active';
    return this.upsert('nocobase', String(id), {
      processId: process.get('id'),
      processKey: key,
      version: workflow ? await this.versionOf(workflow.get('id'), key) : null,
      businessKey,
      recordCollection: businessKey ? collection : null,
      recordId: businessKey ? String(recordId) : null,
      requesterId: context.user?.id ?? context.data?.createdById ?? null,
      status,
      currentStep: node ? node.get('title') || node.get('type') : null,
      currentStepId: node ? node.get('key') : null,
      assigneeId: assignees[0] ?? null,
      candidateGroups: null,
      startedAt: execution.get('startedAt') || execution.get('createdAt'),
      endedAt: OPEN_STATUSES.includes(status) ? null : execution.get('updatedAt'),
    });
  }

  /** The row of an engine instance from what the engine says now; `event` names the log row of a change. */
  async refreshEngineInstance(id: string, event = 'instance.sync') {
    const engine = await this.bpm.getEngine();
    const state = await engine.getInstance(id);
    if (!state) return null;
    const process = await this.processOf('camunda', state.processKey);
    if (!process) return null;
    return this.upsert('camunda', id, this.valuesOf(state, process), event);
  }

  private valuesOf(state: InstanceState, process: Row): Values {
    const [collection, recordId] = splitBusinessKey(state.businessKey);
    const task = state.tasks[0];
    const dues = state.tasks.map((t) => t.dueAt).filter(Boolean) as string[];
    return {
      processId: process.get('id'),
      processKey: state.processKey,
      version: state.version,
      businessKey: state.businessKey,
      recordCollection: collection,
      recordId: recordId === null ? null : String(recordId),
      status: state.status,
      currentStep: state.steps.map((step) => step.name || step.id).join('، ') || null,
      currentStepId: state.steps.map((step) => step.id).join(',') || null,
      assigneeId: userIdOf(task?.assignee),
      candidateGroups: state.tasks.length ? [...new Set(state.tasks.flatMap((t) => t.candidateGroups))] : null,
      dueAt: dues.length ? dues.sort()[0] : null,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
    };
  }

  /**
   * Writes the row of an instance: a new row, or the fields that changed. A change of an engine instance is logged
   * under `event` (instance.sync or instance.reconcile), as the plugin did not make it.
   */
  async upsert(builder: Builder, instanceId: string, values: Values, event?: string) {
    return this.bpm.app.lockManager.runExclusive(
      `bpm-instance:${builder}:${instanceId}`,
      async () => {
        const now = new Date();
        const row = await this.instances.findOne({ filter: { builder, instanceId } });
        if (!row) {
          const created = await this.instances.create({ values: { ...values, builder, instanceId, syncedAt: now } });
          if (event) await this.log(event, instanceId, values, { created: true });
          return created;
        }
        const changed = TRACKED.filter((field) => field in values && !same(row.get(field), values[field]));
        const update = Object.fromEntries(changed.map((field) => [field, values[field]]));
        await this.instances.update({ filterByTk: row.get('id'), values: { ...update, syncedAt: now } });
        if (event && changed.length) {
          await this.log(event, instanceId, values, {
            changed,
            before: Object.fromEntries(changed.map((field) => [field, row.get(field) ?? null])),
          });
        }
        return this.instances.findOne({ filterByTk: row.get('id') });
      },
      30 * 1000,
    );
  }

  private async log(event: string, instanceId: string, values: Values, detail: Record<string, unknown>) {
    await this.bpm.events.note(
      event,
      {
        processKey: values.processKey as string,
        businessKey: values.businessKey as string,
        instanceId,
        detail: { ...detail, status: values.status, currentStep: values.currentStep ?? null },
      },
      'in',
    );
  }

  /**
   * A start the plugin made: the row at once, with the user who started it, then what the engine says once its
   * searches have the instance. An instance that was running already keeps its row.
   */
  async noteStarted(start: {
    processKey: string;
    businessKey: string;
    instanceId: string | null;
    created: boolean;
    userId?: unknown;
  }) {
    if (!start.instanceId) return;
    const process = await this.processOf('camunda', start.processKey);
    if (!process) return;
    if (start.created) {
      const [collection, recordId] = splitBusinessKey(start.businessKey);
      const row = await this.instances.findOne({ filter: { builder: 'camunda', instanceId: start.instanceId } });
      if (!row) {
        await this.upsert('camunda', start.instanceId, {
          processId: process.get('id'),
          processKey: start.processKey,
          businessKey: start.businessKey,
          recordCollection: collection,
          recordId: recordId === null ? null : String(recordId),
          requesterId: start.userId ?? null,
          status: 'active',
          startedAt: new Date(),
        });
      }
    }
    this.later('camunda', start.instanceId);
  }

  /** The instances of a process that was just marked: the running ones of the engine, the recent executions. */
  async backfill(process: Row) {
    if (!process.get('enabled')) return;
    const key = process.get('key');
    if (process.get('builder') === 'camunda') {
      const engine = await this.bpm.getEngine();
      for (const id of await engine.activeInstances([key])) this.schedule('camunda', id);
      return;
    }
    const executions = await this.db.getRepository('executions').find({
      filter: { key, createdAt: { $gte: new Date(Date.now() - 30 * DAY_MS) } },
      fields: ['id'],
      sort: ['-id'],
      limit: 1000,
    });
    for (const execution of executions) this.schedule('nocobase', String(execution.get('id')));
  }

  /** One look at the engine for instances it changed since the last look; returns how many it read. */
  async syncOnce(now = new Date()) {
    const keys = await this.keysOf('camunda');
    if (!keys.length) {
      this.since = now;
      return 0;
    }
    const from = this.since ? this.since.getTime() : now.getTime() - this.options.lookbackMs;
    const engine = await this.bpm.getEngine();
    const ids = await engine.changedInstances(keys, new Date(from - this.options.overlapMs));
    await this.all(ids.map((id) => () => this.refreshEngineInstance(id, 'instance.sync')));
    this.since = now;
    return ids.length;
  }

  /**
   * The nightly check: every running instance of the engine and every open row is read again, and an open row whose
   * instance the engine no longer knows is logged; open rows of NocoBase executions are read from the executions.
   */
  async reconcile() {
    // Logged as one row with what it read, which the monitoring page shows (STORY-099).
    return this.bpm.events.track('reconcile', {}, () => this.reconcileAll(), {
      after: (result) => ({ detail: result }),
    });
  }

  private async reconcileAll() {
    let read = 0;
    let missing = 0;
    const keys = await this.keysOf('camunda');
    const open = async (builder: Builder) =>
      (await this.instances.find({ filter: { builder, status: { $in: OPEN_STATUSES } }, fields: ['instanceId'] })).map(
        (row: Row) => row.get('instanceId') as string,
      );
    if (keys.length) {
      const engine = await this.bpm.getEngine();
      const ids = [...new Set([...(await engine.activeInstances(keys)), ...(await open('camunda'))])];
      await this.all(
        ids.map((id) => async () => {
          read++;
          if (await this.refreshEngineInstance(id, 'instance.reconcile')) return;
          const row = await this.instances.findOne({ filter: { builder: 'camunda', instanceId: id } });
          if (row && OPEN_STATUSES.includes(row.get('status'))) {
            missing++;
            await this.bpm.events.fail(
              'instance.missing',
              { processKey: row.get('processKey'), businessKey: row.get('businessKey'), instanceId: id },
              new BpmEngineError('The engine does not know this open instance'),
            );
          }
        }),
      );
    }
    const executions = await open('nocobase');
    await this.all(
      executions.map((id) => async () => {
        read++;
        await this.refreshExecution(id);
      }),
    );
    return { read, missing };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.since = null;
    this.tick(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(ms: number) {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.syncOnce();
        this.lastError = null;
      } catch (error) {
        this.warn('the look for changed instances failed', error);
      }
      this.tick(this.options.interval);
    }, ms);
  }
}
