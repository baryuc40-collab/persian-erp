import { EXECUTION_STATUS, JOB_STATUS } from '@nocobase/plugin-workflow';
import { BpmEngineError, EngineIncident } from './engine';
import { EVENTS_COLLECTION } from './events';
import { OUTBOX_COLLECTION } from './outbox';
import type { PluginBpmServer } from './plugin';
import { Builder, INSTANCES_COLLECTION, OPEN_STATUSES } from './registry';

export const ALERT_RULES_COLLECTION = 'bpmAlertRules';
export const ALERTS_COLLECTION = 'bpmAlerts';
/** The in-app channel the alerts go through unless a rule names others; made on start when in-app messages are on. */
export const ALERT_CHANNEL = 'bpm-alerts';
export const ALERT_KINDS = ['engineDown', 'worker', 'outbox', 'incident', 'overdue'] as const;
export type AlertKind = typeof ALERT_KINDS[number];

// The rules made on first start; an administrator changes them in bpmAlertRules.
const DEFAULT_RULES: Record<AlertKind, { minutes?: number; count?: number }> = {
  engineDown: { minutes: 2 },
  worker: { minutes: 5 },
  outbox: { minutes: 10, count: 10 },
  incident: {},
  overdue: {},
};
const DEFAULT_ROLES = ['admin'];
// A workflow execution that ended in one of these is a failure on the list; RETRY_NEEDED waits for a person.
const FAILED_EXECUTIONS = [EXECUTION_STATUS.FAILED, EXECUTION_STATUS.ERROR, -6];
const DEFAULT_FAILURE_DAYS = 7;
const MAX_FAILURES = 500;
// The alerts of one kind and round go out as one notification, naming this many of them.
const LISTED_IN_NOTIFICATION = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

type Row = Record<string, any>;

export interface MonitorOptions {
  /** Milliseconds between two rounds of checks and alerts. */
  interval: number;
}

export interface EngineStatus {
  configured: boolean;
  engine: string | null;
  url: string | null;
  /** The API answers and the engine's health check, where it has one, says UP. */
  up: boolean;
  version: string | null;
  health: string | null;
  error: string | null;
  checkedAt: Date;
  /** Since when it has been down, by this app instance's checks. */
  downSince: Date | null;
}

/** One line of the failure list: an incident of the engine, a failed NocoBase execution or a failed outbox item. */
export interface Failure {
  kind: 'incident' | 'execution' | 'outbox';
  builder: Builder | null;
  id: string;
  processKey: string | null;
  processTitle: string | null;
  instanceId: string | null;
  businessKey: string | null;
  /** The element of the model or the workflow node where it stopped. */
  step: string | null;
  stepId: string | null;
  message: string | null;
  /** How many times the service task was tried, by the worker's log; the outbox's own count for an outbox item. */
  attempts: number | null;
  /** The job of the engine whose retries ran out. */
  jobId: string | null;
  type: string | null;
  createdAt: Date | string | null;
  /** The page of a NocoBase execution. */
  link: string | null;
}

interface Condition {
  key: string;
  title: string;
  detail: Record<string, unknown>;
}

/** The problems of a kind that are there now, and which open alerts cannot be told this round and stay as they are. */
interface Conditions {
  items: Condition[];
  keep?: (key: string) => boolean;
}

const text = (value: unknown) => (value === undefined || value === null || value === '' ? null : String(value));

/**
 * The monitoring of STORY-099: checks the engine every round and logs when it goes down and comes back, keeps the
 * alerts of bpmAlerts open while their problem lasts and sends each new one to the roles of its rule, and gathers
 * the state and the failures of both builders for the monitoring page and the metrics.
 */
export class BpmMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt = new Date();
  private engineState: EngineStatus | null = null;
  /** What the last round counted, for the metrics. */
  private counts: { incidents: number | null; executions: number; at: Date } | null = null;
  options: MonitorOptions;

  constructor(private bpm: PluginBpmServer, options: Partial<MonitorOptions> = {}) {
    this.options = { interval: options.interval || 30000 };
  }

  private get db() {
    return this.bpm.db;
  }

  private get logger() {
    return this.bpm.app.logger;
  }

  get failureDays() {
    const days = Number(process.env.BPM_FAILURES_DAYS);
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_FAILURE_DAYS;
  }

  /** The rules of every kind, made with the defaults when missing. */
  async ensureRules() {
    const repository = this.db.getRepository(ALERT_RULES_COLLECTION);
    for (const kind of ALERT_KINDS) {
      if (await repository.findOne({ filter: { kind } })) continue;
      try {
        await repository.create({
          values: { kind, enabled: true, roleNames: DEFAULT_ROLES, channels: [ALERT_CHANNEL], ...DEFAULT_RULES[kind] },
        });
      } catch (error) {
        // Another app instance of a cluster made it first.
        if ((error as Error).name !== 'SequelizeUniqueConstraintError') throw error;
      }
    }
  }

  /** The in-app channel of the alerts, when in-app messages are on; one an administrator changed is left as it is. */
  async ensureChannel() {
    if (!this.db.getCollection('notificationChannels') || !this.db.getCollection('notificationInAppMessages')) return;
    const channels = this.db.getRepository('notificationChannels');
    if (await channels.findOne({ filterByTk: ALERT_CHANNEL })) return;
    try {
      await channels.create({
        values: {
          name: ALERT_CHANNEL,
          title: await this.bpm.translate('Process alerts'),
          notificationType: 'in-app-message',
          options: {},
          description: await this.bpm.translate('The alerts of the process engine and the process monitoring.'),
        },
      });
    } catch (error) {
      if ((error as Error).name !== 'SequelizeUniqueConstraintError') throw error;
    }
  }

  // Engine

  /** Asks the engine whether it answers, and logs engine.down and engine.up when that changes. */
  async checkEngine(): Promise<EngineStatus> {
    const settings = await this.bpm.settings();
    const previous = this.engineState;
    const now = new Date();
    if (!settings.url) {
      this.engineState = {
        configured: false,
        engine: settings.engine,
        url: null,
        up: false,
        version: null,
        health: null,
        error: null,
        checkedAt: now,
        downSince: null,
      };
      return this.engineState;
    }
    const engine = this.bpm.createEngine(settings);
    let version: string | null = null;
    let health: string | null = null;
    let failure: unknown = null;
    try {
      version = await engine.version();
      health = await engine.health();
      if (health && health !== 'UP') {
        failure = new BpmEngineError('The health check of the engine says {{health}}', { health });
      }
    } catch (error) {
      failure = error;
    }
    const up = !failure;
    const error = failure
      ? failure instanceof BpmEngineError
        ? await this.bpm.translate(failure.message, failure.values)
        : (failure as Error)?.message || String(failure)
      : null;
    const wasUp = previous?.configured ? previous.up : null;
    this.engineState = {
      configured: true,
      engine: settings.engine,
      url: settings.url,
      up,
      version,
      health,
      error,
      checkedAt: now,
      downSince: up ? null : previous?.downSince ?? now,
    };
    if (!up && wasUp !== false) {
      await this.bpm.events.fail('engine.down', { detail: { url: settings.url, health } }, failure);
    } else if (up && wasUp === false && previous?.downSince) {
      await this.bpm.events.note('engine.up', {
        detail: { url: settings.url, version, downMs: now.getTime() - previous.downSince.getTime() },
      });
    }
    return this.engineState;
  }

  /** The last check, or a new one when it is older than two rounds. */
  async engineStatus() {
    const state = this.engineState;
    if (state && Date.now() - state.checkedAt.getTime() < 2 * this.options.interval) return state;
    return this.checkEngine();
  }

  // State and failures

  async outboxState() {
    const repository = this.db.getRepository(OUTBOX_COLLECTION);
    const [pending, failed, oldest] = await Promise.all([
      repository.count({ filter: { status: 'pending' } }),
      repository.count({ filter: { status: 'failed' } }),
      repository.findOne({ filter: { status: 'pending' }, sort: ['createdAt'], fields: ['id', 'createdAt'] }),
    ]);
    return { pending, failed, oldestPendingAt: (oldest?.get('createdAt') as Date) ?? null };
  }

  /** The last nightly check of the instances, from its row in the connection log. */
  async lastReconcile() {
    const row = await this.db
      .getRepository(EVENTS_COLLECTION)
      .findOne({ filter: { event: 'reconcile' }, sort: ['-createdAt', '-id'] });
    if (!row) return null;
    return {
      at: row.get('createdAt') as Date,
      status: row.get('status') as string,
      durationMs: row.get('durationMs') as number,
      read: (row.get('detail') as Row)?.read ?? null,
      missing: (row.get('detail') as Row)?.missing ?? null,
      error: row.get('error') as string,
      correlationId: row.get('correlationId') as string,
    };
  }

  /**
   * The size of Camunda's database (BPM_ENGINE_DATABASE, camunda by default), when it is on the PostgreSQL server of
   * NocoBase as in docker-compose.yml.
   */
  async databaseSize() {
    const settings = await this.bpm.settings();
    if (settings.engine !== 'camunda8' || this.db.sequelize.getDialect() !== 'postgres') return null;
    const name = process.env.BPM_ENGINE_DATABASE || 'camunda';
    try {
      const [
        rows,
      ] = (await this.db.sequelize.query(
        'SELECT pg_database_size(datname) AS bytes FROM pg_database WHERE datname = :name',
        { replacements: { name } },
      )) as [Row[], unknown];
      return { name, bytes: rows[0] ? Number(rows[0].bytes) : null, error: null as string | null };
    } catch (error) {
      return { name, bytes: null, error: (error as Error).message };
    }
  }

  async instanceCounts(now = new Date()) {
    const repository = this.db.getRepository(INSTANCES_COLLECTION);
    const [open, incident, failed, overdue] = await Promise.all([
      repository.count({ filter: { status: { $in: OPEN_STATUSES } } }),
      repository.count({ filter: { status: 'incident' } }),
      repository.count({ filter: { status: 'failed' } }),
      repository.count({ filter: { status: { $in: OPEN_STATUSES }, dueAt: { $lt: now } } }),
    ]);
    return { open, incident, failed, overdue };
  }

  /** Everything the monitoring page shows above the failure list. */
  async snapshot() {
    const [engine, outbox, reconcile, database, instances, alerts] = await Promise.all([
      this.checkEngine(),
      this.outboxState(),
      this.lastReconcile(),
      this.databaseSize(),
      this.instanceCounts(),
      this.db.getRepository(ALERTS_COLLECTION).find({ filter: { status: 'open' }, sort: ['-openedAt'] }),
    ]);
    return {
      engine,
      worker: { ...this.bpm.worker.status(), enabled: process.env.BPM_WORKER !== 'off' },
      outbox,
      reconcile,
      database,
      instances,
      alerts,
    };
  }

  /** The processes of bpmProcesses by builder and key, for their titles. */
  private async processTitles() {
    const titles = new Map<string, string>();
    for (const row of await this.db.getRepository('bpmProcesses').find({ fields: ['builder', 'key', 'title'] })) {
      titles.set(`${row.get('builder')}:${row.get('key')}`, row.get('title'));
    }
    return titles;
  }

  /** The open incidents of the engine with their instance's business key and the attempts the worker logged. */
  async incidents(max = MAX_FAILURES): Promise<Failure[]> {
    const engine = await this.bpm.getEngine();
    const incidents = await engine.listIncidents(max);
    if (!incidents.length) return [];
    const [titles, rows, fails] = await Promise.all([
      this.processTitles(),
      this.db.getRepository(INSTANCES_COLLECTION).find({
        filter: { builder: 'camunda', instanceId: { $in: [...new Set(incidents.map((i) => i.instanceId))] } },
        fields: ['instanceId', 'businessKey'],
      }),
      this.db.getRepository(EVENTS_COLLECTION).find({
        filter: { event: 'serviceTask.fail', taskId: { $in: incidents.map((i) => i.jobId).filter(Boolean) } },
        fields: ['taskId'],
      }),
    ]);
    const businessKeys = new Map<string, string>(
      rows.map((row: Row) => [row.get('instanceId'), row.get('businessKey')]),
    );
    const attempts = new Map<string, number>();
    for (const row of fails) attempts.set(row.get('taskId'), (attempts.get(row.get('taskId')) || 0) + 1);
    return incidents.map((incident: EngineIncident) => ({
      kind: 'incident' as const,
      builder: 'camunda' as const,
      id: incident.id,
      processKey: incident.processKey,
      processTitle: titles.get(`camunda:${incident.processKey}`) ?? null,
      instanceId: incident.instanceId,
      businessKey: businessKeys.get(incident.instanceId) ?? null,
      step: incident.elementName || incident.elementId,
      stepId: incident.elementId,
      message: incident.message,
      attempts: incident.jobId ? attempts.get(incident.jobId) ?? null : null,
      jobId: incident.jobId,
      type: incident.type,
      createdAt: incident.createdAt,
      link: null,
    }));
  }

  /** The workflow executions that failed in the last BPM_FAILURES_DAYS days, with the node that failed. */
  async failedExecutions(now = new Date(), max = MAX_FAILURES): Promise<Failure[]> {
    if (!this.db.getCollection('executions')) return [];
    const executions = await this.db.getRepository('executions').find({
      filter: {
        status: { $in: FAILED_EXECUTIONS },
        createdAt: { $gte: new Date(now.getTime() - this.failureDays * DAY_MS) },
      },
      appends: ['workflow'],
      sort: ['-id'],
      limit: max,
    });
    if (!executions.length) return [];
    const ids = executions.map((row: Row) => row.get('id'));
    const [titles, jobs, instances] = await Promise.all([
      this.processTitles(),
      this.db.getRepository('jobs').find({
        filter: { executionId: { $in: ids }, status: { $in: [JOB_STATUS.FAILED, JOB_STATUS.ERROR, -6] } },
        appends: ['node'],
        sort: ['-id'],
      }),
      this.db.getRepository(INSTANCES_COLLECTION).find({
        filter: { builder: 'nocobase', instanceId: { $in: ids.map(String) } },
        fields: ['instanceId', 'businessKey'],
      }),
    ]);
    const jobOf = new Map<string, Row>();
    for (const job of jobs)
      if (!jobOf.has(String(job.get('executionId')))) jobOf.set(String(job.get('executionId')), job);
    const businessKeys = new Map<string, string>(
      instances.map((row: Row) => [row.get('instanceId'), row.get('businessKey')]),
    );
    return executions.map((execution: Row) => {
      const id = String(execution.get('id'));
      const workflow = execution.get('workflow') as Row;
      const job = jobOf.get(id);
      const node = job?.get('node') as Row;
      const result = job?.get('result') as Row | string;
      const key = (execution.get('key') as string) ?? workflow?.get('key');
      return {
        kind: 'execution' as const,
        builder: 'nocobase' as const,
        id,
        processKey: key,
        processTitle: titles.get(`nocobase:${key}`) ?? (workflow?.get('title') as string) ?? null,
        instanceId: id,
        businessKey: businessKeys.get(id) ?? null,
        step: (node?.get('title') as string) ?? null,
        stepId: text(node?.get('key')),
        message: typeof result === 'string' ? result : text(result?.message) ?? text(result?.error),
        attempts: null,
        jobId: job ? String(job.get('id')) : null,
        type: String(execution.get('status')),
        createdAt: execution.get('createdAt') as Date,
        link: `/admin/workflow/executions/${id}`,
      };
    });
  }

  /** The outbox items that ran out of attempts and wait for «send again» or «put aside». */
  async failedOutbox(max = MAX_FAILURES): Promise<Failure[]> {
    const rows = await this.db
      .getRepository(OUTBOX_COLLECTION)
      .find({ filter: { status: 'failed' }, sort: ['-id'], limit: max });
    return rows.map((row: Row) => ({
      kind: 'outbox' as const,
      builder: 'camunda' as const,
      id: String(row.get('id')),
      processKey: row.get('processKey') ?? null,
      processTitle: null,
      instanceId: null,
      businessKey: row.get('businessKey') ?? null,
      step: row.get('kind') === 'message' ? row.get('messageName') : null,
      stepId: null,
      message: row.get('lastError') ?? null,
      attempts: row.get('attempts') ?? null,
      jobId: text(row.get('jobId')),
      type: row.get('kind'),
      createdAt: row.get('createdAt') as Date,
      link: null,
    }));
  }

  /**
   * The failure list of the monitoring page, newest first. An engine that cannot be asked leaves its incidents out
   * and says why in `engineError`, so the NocoBase failures still show.
   */
  async failures(now = new Date()) {
    let engineError: string | null = null;
    let incidents: Failure[] = [];
    if ((await this.bpm.settings()).url) {
      try {
        incidents = await this.incidents();
      } catch (error) {
        engineError =
          error instanceof BpmEngineError
            ? await this.bpm.translate(error.message, error.values)
            : (error as Error).message;
      }
    }
    const [executions, outbox] = await Promise.all([this.failedExecutions(now), this.failedOutbox()]);
    const time = (failure: Failure) => (failure.createdAt ? new Date(failure.createdAt).getTime() : 0);
    const items = [...incidents, ...executions, ...outbox].sort((a, b) => time(b) - time(a));
    return { items, engineError, days: this.failureDays };
  }

  // Alerts

  private async rules() {
    const rows = await this.db.getRepository(ALERT_RULES_COLLECTION).find({ filter: { enabled: true } });
    return new Map<AlertKind, Row>(rows.map((row: Row) => [row.get('kind'), row]));
  }

  private minutes(rule: Row, kind: AlertKind) {
    const value = Number(rule.get('minutes'));
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RULES[kind].minutes ?? 0;
  }

  private async conditions(kind: AlertKind, rule: Row, now: Date): Promise<Conditions> {
    const t = (message: string, values: Record<string, unknown> = {}) => this.bpm.translate(message, values);
    const engine = this.engineState;
    switch (kind) {
      case 'engineDown': {
        const minutes = this.minutes(rule, kind);
        if (
          !engine?.configured ||
          engine.up ||
          !engine.downSince ||
          now.getTime() - engine.downSince.getTime() < minutes * MINUTE_MS
        ) {
          return { items: [] };
        }
        return {
          items: [
            {
              key: 'engineDown',
              title: await t('The BPMN engine has not answered for {{minutes}} minutes', { minutes }),
              detail: { url: engine.url, error: engine.error, health: engine.health, since: engine.downSince },
            },
          ],
        };
      }
      case 'worker': {
        // Each app instance has its own worker and tells only about it. An alert of another worker that nobody has
        // seen for three rounds belongs to an instance that stopped, and goes.
        const worker = this.bpm.worker.status();
        const own = `worker:${worker.workerId}`;
        const stale = now.getTime() - 3 * this.options.interval;
        const seen = new Map<string, number>(
          (
            await this.db.getRepository(ALERTS_COLLECTION).find({ filter: { kind, status: 'open' } })
          ).map((row: Row) => [
            row.get('key'),
            new Date((row.get('detail') as Row)?.seenAt || row.get('openedAt')).getTime(),
          ]),
        );
        const others = (key: string) => key !== own && (seen.get(key) ?? 0) >= stale;
        // A worker with no topic to poll has nothing to fetch; an engine that is down has its own alert.
        if (!worker.running || !worker.topics) return { items: [], keep: others };
        if (!engine?.up) return { items: [], keep: (key) => key === own || others(key) };
        const minutes = this.minutes(rule, kind);
        const last = worker.lastFetchAt ?? this.startedAt;
        if (now.getTime() - last.getTime() < minutes * MINUTE_MS) return { items: [], keep: others };
        return {
          items: [
            {
              key: own,
              title: await t('The service task worker has not fetched tasks for {{minutes}} minutes', { minutes }),
              detail: { workerId: worker.workerId, lastFetchAt: worker.lastFetchAt, error: worker.error, seenAt: now },
            },
          ],
          keep: others,
        };
      }
      case 'outbox': {
        const outbox = await this.outboxState();
        const minutes = this.minutes(rule, kind);
        const count = Number(rule.get('count')) || DEFAULT_RULES.outbox.count;
        const age = outbox.oldestPendingAt ? now.getTime() - new Date(outbox.oldestPendingAt).getTime() : 0;
        if (outbox.pending <= count && age < minutes * MINUTE_MS) return { items: [] };
        return {
          items: [
            {
              key: 'outbox',
              title: await t('{{count}} items wait in the outbox; the oldest has waited {{minutes}} minutes', {
                count: outbox.pending,
                minutes: Math.floor(age / MINUTE_MS),
              }),
              detail: outbox,
            },
          ],
        };
      }
      case 'incident': {
        const conditions: Condition[] = [];
        const describe = async (failure: Failure) => ({
          key: `incident:${failure.builder}:${failure.id}`,
          title: await t('{{process}} stopped at {{step}}: {{message}}', {
            process: failure.processTitle || failure.processKey || '-',
            step: failure.step || '-',
            message: failure.message || '-',
          }),
          detail: {
            builder: failure.builder,
            id: failure.id,
            processKey: failure.processKey,
            instanceId: failure.instanceId,
            businessKey: failure.businessKey,
            step: failure.step,
            link: failure.link,
          },
        });
        for (const failure of await this.failedExecutions(now)) conditions.push(await describe(failure));
        this.counts = { incidents: this.counts?.incidents ?? null, executions: conditions.length, at: now };
        if (!engine?.configured) return { items: conditions };
        // The incidents of an engine that is down or cannot be read cannot be told: their alerts stay as they are.
        const unknown = { items: conditions, keep: (key: string) => key.startsWith('incident:camunda:') };
        if (!engine.up) return unknown;
        try {
          const incidents = await this.incidents();
          this.counts = { ...this.counts, incidents: incidents.length };
          for (const failure of incidents) conditions.push(await describe(failure));
        } catch (error) {
          this.logger.warn(`bpm monitor: the incidents could not be read: ${(error as Error).message}`, {
            module: 'bpm',
          });
          return unknown;
        }
        return { items: conditions };
      }
      case 'overdue': {
        const rows = await this.db.getRepository(INSTANCES_COLLECTION).find({
          filter: { status: { $in: OPEN_STATUSES }, dueAt: { $lt: now } },
          appends: ['process'],
          sort: ['dueAt'],
          limit: MAX_FAILURES,
        });
        const items = await Promise.all(
          rows.map(async (row: Row) => ({
            key: `overdue:${row.get('builder')}:${row.get('instanceId')}`,
            title: await t('{{process}} is overdue at {{step}}', {
              process: (row.get('process') as Row)?.get('title') || row.get('processKey'),
              step: row.get('currentStep') || '-',
            }),
            detail: {
              builder: row.get('builder'),
              instanceId: row.get('instanceId'),
              processKey: row.get('processKey'),
              businessKey: row.get('businessKey'),
              dueAt: row.get('dueAt'),
            },
          })),
        );
        return { items };
      }
    }
  }

  /**
   * Opens an alert for each new problem and resolves the ones that are gone. Only the app instance that opens or
   * resolves the row notifies, so a cluster sends one notification.
   */
  private async apply(kind: AlertKind, rule: Row, conditions: Conditions, now: Date) {
    const repository = this.db.getRepository(ALERTS_COLLECTION);
    const open = await repository.find({ filter: { kind, status: 'open' } });
    const openByKey = new Map<string, Row>(open.map((row: Row) => [row.get('key'), row]));
    const opened: Row[] = [];
    for (const condition of conditions.items) {
      const current = openByKey.get(condition.key);
      if (current) {
        // A worker's alert says each round that its worker still cannot fetch.
        if (kind === 'worker') await current.update({ detail: condition.detail });
        continue;
      }
      try {
        opened.push(
          await repository.create({
            values: {
              kind,
              key: condition.key,
              openKey: condition.key,
              status: 'open',
              title: condition.title,
              detail: condition.detail,
              openedAt: now,
            },
          }),
        );
      } catch (error) {
        if ((error as Error).name !== 'SequelizeUniqueConstraintError') throw error;
      }
    }
    const resolved: Row[] = [];
    const keys = new Set(conditions.items.map((condition) => condition.key));
    for (const row of open) {
      if (keys.has(row.get('key')) || conditions.keep?.(row.get('key'))) continue;
      if (await this.resolve(row, now)) resolved.push(row);
    }
    for (const row of opened) {
      await this.bpm.events.note('alert.open', { detail: { kind, key: row.get('key'), alert: row.get('id') } });
    }
    if (opened.length) await this.notify(kind, rule, opened, false);
    // A problem of the whole system says when it is over; an incident or a late task just leaves the list.
    if (resolved.length && ['engineDown', 'worker', 'outbox'].includes(kind))
      await this.notify(kind, rule, resolved, true);
  }

  private async resolve(row: Row, now: Date) {
    const [count] = (await this.db
      .getModel(ALERTS_COLLECTION)
      .update(
        { status: 'resolved', openKey: null, resolvedAt: now },
        { where: { id: row.get('id'), status: 'open' } },
      )) as [number];
    if (!count) return false;
    await this.bpm.events.note('alert.resolved', {
      detail: { kind: row.get('kind'), key: row.get('key'), alert: row.get('id') },
    });
    return true;
  }

  /** The IDs of the users of the rule's roles. */
  private async receivers(rule: Row) {
    const roleNames: string[] = Array.isArray(rule.get('roleNames')) ? rule.get('roleNames') : DEFAULT_ROLES;
    if (!roleNames.length) return [];
    const users = await this.db
      .getRepository('users')
      .find({ filter: { 'roles.name': { $in: roleNames } }, fields: ['id'] });
    return [...new Set(users.map((user: Row) => user.get('id')))];
  }

  /** One notification for the alerts of a kind that opened (or closed) this round, through each channel of the rule. */
  private async notify(kind: AlertKind, rule: Row, alerts: Row[], resolved: boolean) {
    const manager = (this.bpm.app.pm.get('notification-manager') as unknown) as
      | { send(params: Row): Promise<{ status: string; reason?: string }> }
      | undefined;
    const channels: string[] = Array.isArray(rule.get('channels')) ? rule.get('channels') : [ALERT_CHANNEL];
    const detail = { kind, resolved, alerts: alerts.length };
    if (!manager || !channels.length) {
      await this.bpm.events.fail('alert.failed', { detail }, new BpmEngineError('No notification channel is set up'));
      return;
    }
    const userIds = await this.receivers(rule);
    if (!userIds.length) {
      await this.bpm.events.fail('alert.failed', { detail }, new BpmEngineError('No user has the roles of the rule'));
      return;
    }
    const lines = alerts.slice(0, LISTED_IN_NOTIFICATION).map((row) => `- ${row.get('title')}`);
    if (alerts.length > LISTED_IN_NOTIFICATION) {
      lines.push(await this.bpm.translate('and {{count}} more', { count: alerts.length - LISTED_IN_NOTIFICATION }));
    }
    const title = resolved
      ? await this.bpm.translate('Resolved: {{title}}', { title: alerts[0].get('title') })
      : alerts.length > 1
      ? await this.bpm.translate('{{count}} new process alerts', { count: alerts.length })
      : (alerts[0].get('title') as string);
    const content = resolved || alerts.length === 1 ? title : lines.join('\n');
    let sent = false;
    for (const channelName of channels) {
      try {
        // The manager would queue a message for a channel that does not exist and say it went out.
        if (!(await this.db.getRepository('notificationChannels').findOne({ filterByTk: channelName }))) {
          throw new BpmEngineError('There is no notification channel {{name}}', { name: channelName });
        }
        const result = await manager.send({
          channelName,
          message: { title, content, subject: title, text: content, contentType: 'text' },
          receivers: { type: 'userId', value: userIds },
          triggerFrom: 'bpm-monitor',
        });
        if (result?.status === 'failure') throw new Error(result.reason || 'failure');
        sent = true;
        await this.bpm.events.note('alert.sent', {
          detail: { ...detail, channel: channelName, users: userIds.length },
        });
      } catch (error) {
        await this.bpm.events.fail('alert.failed', { detail: { ...detail, channel: channelName } }, error);
      }
    }
    if (sent && !resolved) {
      await this.db
        .getModel(ALERTS_COLLECTION)
        .update({ notifiedAt: new Date() }, { where: { id: alerts.map((row) => row.get('id')) } });
    }
  }

  /** One round: the engine, then the rules in turn; a rule that fails does not stop the others. */
  async runOnce(now = new Date()) {
    await this.checkEngine();
    const rules = await this.rules();
    for (const kind of ALERT_KINDS) {
      const rule = rules.get(kind);
      if (!rule) continue;
      try {
        await this.apply(kind, rule, await this.conditions(kind, rule, now), now);
      } catch (error) {
        this.logger.warn(`bpm monitor: the ${kind} alerts failed: ${(error as Error).message}`, { module: 'bpm' });
      }
    }
  }

  // Metrics

  /** The plugin's counts in the Prometheus text format (bpm:metrics); Camunda has its own at /actuator/prometheus. */
  async metrics() {
    const [engine, outbox, instances, alerts, reconcile, database] = await Promise.all([
      this.engineStatus(),
      this.outboxState(),
      this.db.getModel(INSTANCES_COLLECTION).findAll({
        attributes: ['builder', 'status', [this.db.sequelize.fn('COUNT', this.db.sequelize.col('id')), 'count']],
        group: ['builder', 'status'],
        raw: true,
      }),
      this.db.getRepository(ALERTS_COLLECTION).find({ filter: { status: 'open' }, fields: ['kind'] }),
      this.lastReconcile(),
      this.databaseSize(),
    ]);
    const worker = this.bpm.worker.status();
    const lines: string[] = [];
    const metric = (name: string, help: string, samples: [Record<string, string>, number | null][]) => {
      const present = samples.filter(([, value]) => value !== null && Number.isFinite(value));
      if (!present.length) return;
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      for (const [labels, value] of present) {
        const text = Object.entries(labels)
          .map(([label, v]) => `${label}="${String(v).replace(/["\\\n]/g, (c) => (c === '\n' ? '\\n' : `\\${c}`))}"`)
          .join(',');
        lines.push(`${name}${text ? `{${text}}` : ''} ${value}`);
      }
    };
    const seconds = (date: Date | string | null | undefined) =>
      date ? Math.round((Date.now() - new Date(date).getTime()) / 1000) : null;
    metric('nocobase_bpm_engine_up', 'Whether the BPMN engine answers (1) or not (0).', [
      [{ engine: engine.engine || '' }, engine.configured ? Number(engine.up) : null],
    ]);
    metric('nocobase_bpm_engine_down_seconds', 'How long the BPMN engine has not answered.', [
      [{}, engine.downSince ? seconds(engine.downSince) : engine.configured ? 0 : null],
    ]);
    metric('nocobase_bpm_worker_last_fetch_age_seconds', 'Seconds since the service task worker last fetched.', [
      [
        { worker: worker.workerId },
        worker.running && worker.topics ? seconds(worker.lastFetchAt ?? this.startedAt) : null,
      ],
    ]);
    metric('nocobase_bpm_outbox_items', 'Outbox items that wait or ran out of attempts.', [
      [{ status: 'pending' }, outbox.pending],
      [{ status: 'failed' }, outbox.failed],
    ]);
    metric('nocobase_bpm_outbox_oldest_pending_age_seconds', 'Age of the oldest outbox item that waits.', [
      [{}, outbox.oldestPendingAt ? seconds(outbox.oldestPendingAt) : 0],
    ]);
    metric(
      'nocobase_bpm_instances',
      'Process instances in bpmInstances by builder and status.',
      ((instances as unknown) as Row[]).map((row) => [{ builder: row.builder, status: row.status }, Number(row.count)]),
    );
    metric('nocobase_bpm_incidents_open', 'Open incidents of the engine at the last monitoring round.', [
      [{}, this.counts?.incidents ?? null],
    ]);
    metric('nocobase_bpm_executions_failed', 'Failed NocoBase workflow executions of the failure window.', [
      [{ days: String(this.failureDays) }, this.counts?.executions ?? null],
    ]);
    const openAlerts = new Map<string, number>(ALERT_KINDS.map((kind) => [kind, 0]));
    for (const row of alerts) openAlerts.set(row.get('kind'), (openAlerts.get(row.get('kind')) || 0) + 1);
    metric(
      'nocobase_bpm_alerts_open',
      'Open alerts by kind.',
      [...openAlerts].map(([kind, count]) => [{ kind }, count]),
    );
    metric('nocobase_bpm_reconcile_last_timestamp_seconds', 'When the last nightly check of the instances ran.', [
      [{ status: reconcile?.status || '' }, reconcile ? Math.round(new Date(reconcile.at).getTime() / 1000) : null],
    ]);
    metric('nocobase_bpm_engine_database_bytes', "Size of the engine's database.", [
      [{ database: database?.name || '' }, database?.bytes ?? null],
    ]);
    return `${lines.join('\n')}\n`;
  }

  // Loop

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date();
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
        await this.runOnce();
      } catch (error) {
        this.logger.warn(`bpm monitor: ${(error as Error).message}`, { module: 'bpm' });
      }
      this.tick(this.options.interval);
    }, ms);
    this.timer.unref?.();
  }
}
