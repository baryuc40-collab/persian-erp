import type { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import { randomUUID, timingSafeEqual } from 'crypto';
import bpmAlertRulesCollection from './bpm-alert-rules-collection';
import bpmAlertsCollection from './bpm-alerts-collection';
import bpmEventsCollection from './bpm-events-collection';
import bpmInstancesCollection from './bpm-instances-collection';
import bpmOutboxCollection from './bpm-outbox-collection';
import bpmProcessesCollection from './bpm-processes-collection';
import bpmSettingsCollection from './bpm-settings-collection';
import { Camunda8Engine } from './camunda8';
import { BpmEngine, BpmEngineError, EngineKind, ENGINES } from './engine';
import { BpmEvents, EventFields, EVENTS_COLLECTION, TrackOptions } from './events';
import { EngineSettings } from './http';
import { MESSAGE_INSTRUCTION, SendMessageInstruction } from './message-instruction';
import { ALERT_RULES_COLLECTION, ALERTS_COLLECTION, BpmMonitor } from './monitor';
import { OperatonEngine } from './operaton';
import { BpmOutbox, OUTBOX_COLLECTION } from './outbox';
import { BpmRegistry, BUILDERS, INSTANCES_COLLECTION, PROCESSES_COLLECTION } from './registry';
import { SERVICE_TASK_TRIGGER, ServiceTaskTrigger } from './service-task-trigger';
import { START_INSTRUCTION, StartProcessInstruction } from './start-instruction';
import { traces } from './trace';
import { TaskInbox, TASKS_RESOURCE } from './tasks';
import { ServiceTaskWorker } from './worker';

export const BPM_RESOURCE = 'bpm';
export const BPM_SNIPPET = 'pm.bpm';
const NAMESPACE = '@persian-erp/plugin-bpm';
const SETTINGS_ID = 1;
const MAX_MODEL_BYTES = 2 * 1024 * 1024;
// The connection log and the outbox can be read, never changed through the API; outbox rows only by «send again» and
// «put aside».
const READ_ACTIONS = ['list', 'get', 'count', 'export'];
const API_ACTIONS: Record<string, string[]> = {
  [EVENTS_COLLECTION]: READ_ACTIONS,
  [OUTBOX_COLLECTION]: [...READ_ACTIONS, 'resend', 'discard'],
  // Kept by the plugin from the engine and the executions; «read again» compares one with its source now.
  [INSTANCES_COLLECTION]: [...READ_ACTIONS, 'refresh'],
  // Opened and resolved by the monitor (STORY-099).
  [ALERTS_COLLECTION]: READ_ACTIONS,
  // One rule for each kind of alert, made by the plugin; an administrator changes them.
  [ALERT_RULES_COLLECTION]: [...READ_ACTIONS, 'update'],
};
const READ_ONLY_MESSAGES: Record<string, string> = {
  [EVENTS_COLLECTION]: 'The connection log is read-only',
  [OUTBOX_COLLECTION]: 'An outbox item can only be sent again or put aside',
  [INSTANCES_COLLECTION]: 'The process instances are kept by the plugin and are read-only',
  [ALERTS_COLLECTION]: 'The alerts are kept by the monitor and are read-only',
  [ALERT_RULES_COLLECTION]: 'There is one alert rule for each kind; a rule can only be changed',
};
// «Try again» of an incident gives the service task this many tries at most.
const MAX_RETRIES = 10;

export interface BpmConnection extends EngineSettings {
  engine: EngineKind;
}

const engineOf = (value: unknown): EngineKind | null =>
  ENGINES.includes(value as EngineKind) ? (value as EngineKind) : null;

/** A Camunda form (form-js schema): a JSON object with a list of components. */
function isFormSchema(text: string) {
  try {
    const schema = JSON.parse(text);
    return !!schema && typeof schema === 'object' && Array.isArray(schema.components);
  } catch {
    return false;
  }
}

export class PluginBpmServer extends Plugin {
  /** Builds the engine of the saved settings; another adapter can take its place in tests. */
  createEngine: (settings: BpmConnection) => BpmEngine = (settings) =>
    settings.engine === 'operaton'
      ? new OperatonEngine(settings)
      : new Camunda8Engine({ ...settings, healthUrl: process.env.BPM_ENGINE_HEALTH_URL || undefined });

  /** Runs the service tasks of the engine (STORY-081); off with BPM_WORKER=off. */
  worker = new ServiceTaskWorker(this, { interval: Number(process.env.BPM_WORKER_INTERVAL) || undefined });

  /** The connection log bpmEvents (STORY-093). */
  events = new BpmEvents(this);

  /** The outbox bpmOutbox for starts and messages the engine could not take (STORY-094). */
  outbox = new BpmOutbox(this, {
    interval: Number(process.env.BPM_OUTBOX_INTERVAL) || undefined,
    maxAttempts: Number(process.env.BPM_OUTBOX_MAX_ATTEMPTS) || undefined,
  });

  /** The processes and their instances, bpmProcesses and bpmInstances (STORY-095). */
  registry = new BpmRegistry(this, { interval: Number(process.env.BPM_SYNC_INTERVAL) || undefined });

  /** The monitoring, the alerts and the metrics (STORY-099); off with BPM_MONITOR=off. */
  monitor = new BpmMonitor(this, { interval: Number(process.env.BPM_MONITOR_INTERVAL) || undefined });

  async beforeLoad() {
    this.db.collection(bpmSettingsCollection);
    this.db.collection(bpmEventsCollection);
    this.db.collection(bpmOutboxCollection);
    this.db.collection(bpmProcessesCollection);
    this.db.collection(bpmInstancesCollection);
    this.db.collection(bpmAlertRulesCollection);
    this.db.collection(bpmAlertsCollection);
    this.app.acl.registerSnippet({
      name: BPM_SNIPPET,
      actions: [
        `${BPM_RESOURCE}:*`,
        `${PROCESSES_COLLECTION}:*`,
        ...Object.entries(API_ACTIONS).flatMap(([name, actions]) => actions.map((action) => `${name}:${action}`)),
      ],
    });
    // Open to every signed-in user; the actions return and accept only the user's own tasks (STORY-082).
    this.app.acl.allow(TASKS_RESOURCE, ['list', 'get', 'complete'], 'loggedIn');
    // For Prometheus, with the key of BPM_METRICS_KEY instead of a user; off while it is not set.
    this.app.acl.allow(BPM_RESOURCE, 'metrics', 'public');
    // A user whose roles may not read bpmInstances still reads the instances they started (STORY-095).
    this.app.acl.use(
      async (ctx: Context, next: Next) => {
        const { resourceName, actionName } = ctx.permission || {};
        const userId = ctx.state.currentUser?.id;
        if (
          resourceName === INSTANCES_COLLECTION &&
          ['list', 'get', 'count'].includes(actionName) &&
          !ctx.permission.can &&
          userId !== undefined &&
          userId !== null
        ) {
          ctx.permission.skip = true;
          ctx.action.mergeParams({ filter: { requesterId: userId } }, { filter: 'andMerge' });
        }
        await next();
      },
      { tag: 'bpm-own-instances', before: 'core' },
    );
  }

  async load() {
    // The workflow node of STORY-080 and the event of STORY-081, when the workflow plugin is on.
    const workflow = (this.app.pm.get('workflow') as unknown) as
      | {
          registerInstruction(type: string, instruction: unknown): void;
          registerTrigger(type: string, trigger: unknown): void;
        }
      | undefined;
    if (workflow) {
      workflow.registerInstruction(START_INSTRUCTION, new StartProcessInstruction(workflow as never, this));
      workflow.registerInstruction(MESSAGE_INSTRUCTION, new SendMessageInstruction(workflow as never, this));
      workflow.registerTrigger(SERVICE_TASK_TRIGGER, ServiceTaskTrigger);
      this.registry.listen();
      if (process.env.BPM_WORKER !== 'off') {
        for (const runner of [this.worker, this.outbox, this.registry]) {
          this.app.on('afterStart', () => runner.start());
          this.app.on('beforeStop', () => runner.stop());
          this.app.on('beforeDestroy', () => runner.stop());
        }
      }
    }

    // The rules and the in-app channel of the alerts on every start, then the monitoring round, which needs no workflow.
    this.app.on('afterStart', async () => {
      try {
        await this.monitor.ensureRules();
        await this.monitor.ensureChannel();
      } catch (error) {
        this.app.logger.warn(`bpm: the alert rules could not be set up: ${(error as Error).message}`, {
          module: 'bpm',
        });
      }
    });
    if (process.env.BPM_WORKER !== 'off' && process.env.BPM_MONITOR !== 'off') {
      this.app.on('afterStart', () => this.monitor.start());
      this.app.on('beforeStop', () => this.monitor.stop());
      this.app.on('beforeDestroy', () => this.monitor.stop());
    }

    this.app.on('afterStart', () => this.events.startCleanup());
    this.app.on('beforeStop', () => this.events.stopCleanup());
    this.app.on('beforeDestroy', () => this.events.stopCleanup());
    // Rows are written by the plugin alone, also for the root role.
    this.app.resourceManager.use(
      async (ctx: Context, next: Next) => {
        const { resourceName, actionName } = ctx.action || {};
        if (API_ACTIONS[resourceName] && !API_ACTIONS[resourceName].includes(actionName)) {
          ctx.throw(403, this.tr(ctx, READ_ONLY_MESSAGES[resourceName]));
        }
        if (resourceName === PROCESSES_COLLECTION && ['create', 'update'].includes(actionName)) {
          await this.checkProcess(ctx);
        }
        if (resourceName === ALERT_RULES_COLLECTION && actionName === 'update') this.checkAlertRule(ctx);
        await next();
      },
      { tag: 'bpm-read-only', before: 'acl' },
    );
    this.app.resourceManager.registerActionHandlers({
      [`${OUTBOX_COLLECTION}:resend`]: (ctx: Context, next: Next) => this.outboxAction(ctx, next, 'resend'),
      [`${OUTBOX_COLLECTION}:discard`]: (ctx: Context, next: Next) => this.outboxAction(ctx, next, 'discard'),
      [`${INSTANCES_COLLECTION}:refresh`]: (ctx: Context, next: Next) => this.refreshInstanceAction(ctx, next),
    });

    // Not a collection, so the resource is defined here with its actions.
    this.app.resourceManager.define({
      name: BPM_RESOURCE,
      actions: {
        getSettings: (ctx: Context, next: Next) => this.getSettingsAction(ctx, next),
        saveSettings: (ctx: Context, next: Next) => this.saveSettingsAction(ctx, next),
        test: (ctx: Context, next: Next) => this.testAction(ctx, next),
        processes: (ctx: Context, next: Next) => this.processesAction(ctx, next),
        deploy: (ctx: Context, next: Next) => this.deployAction(ctx, next),
        monitor: (ctx: Context, next: Next) => this.monitorAction(ctx, next),
        failures: (ctx: Context, next: Next) => this.failuresAction(ctx, next),
        retryIncident: (ctx: Context, next: Next) => this.retryIncidentAction(ctx, next),
        metrics: (ctx: Context, next: Next) => this.metricsAction(ctx, next),
      },
    });
    this.app.resourceManager.define({ name: TASKS_RESOURCE, actions: new TaskInbox(this).actions });
  }

  /**
   * The connection settings: what the administrator saved, else BPM_ENGINE, BPM_ENGINE_URL, BPM_ENGINE_USERNAME and
   * BPM_ENGINE_PASSWORD from the environment (docker-compose.yml sets them for the bpm profile). The engine is Camunda 8
   * unless set otherwise; a connection saved before there was a choice (no engine in the row) is Operaton's.
   */
  async settings(): Promise<BpmConnection & { fromEnv: boolean }> {
    const row = await this.db.getRepository('bpmSettings').findOne({ filterByTk: SETTINGS_ID });
    const url = (row?.get('url') as string) || '';
    if (url) {
      return {
        engine: engineOf(row.get('engine')) || 'operaton',
        url,
        username: (row.get('username') as string) || '',
        password: (row.get('password') as string) || '',
        fromEnv: false,
      };
    }
    return {
      engine: engineOf(process.env.BPM_ENGINE) || 'camunda8',
      url: process.env.BPM_ENGINE_URL || '',
      username: process.env.BPM_ENGINE_USERNAME || '',
      password: process.env.BPM_ENGINE_PASSWORD || '',
      fromEnv: true,
    };
  }

  /** The engine to use, for this plugin and the ones built on it (STORY-080 and after). */
  async getEngine(): Promise<BpmEngine> {
    const settings = await this.settings();
    if (!settings.url) throw new BpmEngineError('The BPMN engine is not set up');
    return this.createEngine(settings);
  }

  /** A message in the language of the install (system settings), for results that are stored, not answered. */
  async translate(message: string, values: Record<string, unknown> = {}) {
    const settings = await this.db.getRepository('systemSettings')?.findOne();
    const lng = (settings?.get('appLang') as string) || (settings?.get('enabledLanguages') as string[])?.[0] || 'en-US';
    return this.app.i18n.t(message, { ns: NAMESPACE, lng, ...values, interpolation: { escapeValue: false } });
  }

  // The messages go to the page as text and to logs, never into HTML, so values such as the engine's own message are
  // not escaped («'CREATE'», not «&#39;CREATE&#39;»).
  tr(ctx: Context, message: string, values: Record<string, unknown> = {}) {
    return ctx.t(message, { ns: NAMESPACE, ...values, interpolation: { escapeValue: false } });
  }

  /**
   * An exchange with the engine for a request: logged in bpmEvents with the user and a correlation ID, which the
   * answer carries as X-Correlation-Id (STORY-093). Engine errors become a 400 with the translated message; anything
   * else is a server error.
   */
  async withEngine<T>(
    ctx: Context,
    event: string,
    run: (engine: BpmEngine) => Promise<T>,
    fields: EventFields = {},
    options: TrackOptions<T> = {},
  ) {
    // One correlation ID for all the exchanges of a request.
    const correlationId: string = (ctx.state.bpmCorrelationId ||= randomUUID());
    ctx.set('X-Correlation-Id', correlationId);
    const userId = ctx.state.currentUser?.id ?? null;
    try {
      return await traces.run({ correlationId }, () =>
        this.events.track(event, { ...fields, userId }, async () => run(await this.getEngine()), options),
      );
    } catch (error) {
      if (error instanceof BpmEngineError) ctx.throw(400, this.tr(ctx, error.message, error.values));
      throw error;
    }
  }

  /** Every night: the old rows of the connection log and the outbox, and the check of the open instances. */
  async cleanup(now = new Date()) {
    await this.events.cleanup(now);
    await this.outbox.cleanup(now);
    try {
      await this.registry.reconcile();
    } catch (error) {
      this.app.logger.warn(`bpm: the nightly check of the instances failed: ${(error as Error).message}`, {
        module: 'bpm',
      });
    }
  }

  /**
   * A process is a workflow of NocoBase, by the key all its versions share, or a process of the engine, by its ID in
   * the model; each one once. The title is the workflow's when none is given.
   */
  private async checkProcess(ctx: Context) {
    const values = (ctx.action.params.values || {}) as Record<string, unknown>;
    const current =
      ctx.action.actionName === 'update' && ctx.action.params.filterByTk
        ? await this.db.getRepository(PROCESSES_COLLECTION).findOne({ filterByTk: ctx.action.params.filterByTk })
        : null;
    const builder = (values.builder ?? current?.get('builder')) as string;
    const key = String(values.key ?? current?.get('key') ?? '').trim();
    if (!BUILDERS.includes(builder as never)) ctx.throw(400, this.tr(ctx, 'Choose NocoBase or BPMN as the builder'));
    if (!key) ctx.throw(400, this.tr(ctx, 'Choose the workflow or the BPMN process'));
    if (builder === 'nocobase') {
      const [workflow] = await this.db
        .getRepository('workflows')
        .find({ filter: { key }, sort: ['-current', '-id'], limit: 1 });
      if (!workflow) ctx.throw(400, this.tr(ctx, 'There is no workflow with the key {{key}}', { key }));
      if (!values.title && !current?.get('title')) values.title = workflow.get('title');
    } else if (!values.title && !current?.get('title')) {
      values.title = key;
    }
    const twin = await this.db.getRepository(PROCESSES_COLLECTION).findOne({ filter: { builder, key } });
    if (twin && String(twin.get('id')) !== String(current?.get('id'))) {
      ctx.throw(400, this.tr(ctx, 'This process is in the list already'));
    }
    values.key = key;
    ctx.action.params.values = values;
  }

  /** A rule keeps its kind; its limits are whole numbers, its roles and channels lists of names. */
  private checkAlertRule(ctx: Context) {
    const values = { ...(ctx.action.params.values || {}) } as Record<string, unknown>;
    delete values.kind;
    for (const name of ['minutes', 'count']) {
      const value = values[name];
      if (value === undefined || value === null) continue;
      if (!Number.isInteger(Number(value)) || Number(value) < 0) {
        ctx.throw(400, this.tr(ctx, 'The limits of a rule must be whole numbers, 0 or more'));
      }
      values[name] = Number(value);
    }
    for (const name of ['roleNames', 'channels']) {
      const value = values[name];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
        ctx.throw(400, this.tr(ctx, 'The roles and channels of a rule must be lists of names'));
      }
      values[name] = [...new Set((value as string[]).map((item) => item.trim()))];
    }
    ctx.action.params.values = values;
  }

  // The monitoring page (STORY-099): the engine, the worker, the outbox, the nightly check and the open alerts.
  async monitorAction(ctx: Context, next: Next) {
    ctx.body = await this.monitor.snapshot();
    await next();
  }

  // The failures of both builders: incidents of the engine, failed executions and outbox items that ran out.
  async failuresAction(ctx: Context, next: Next) {
    ctx.body = await this.monitor.failures();
    await next();
  }

  /**
   * «Try again» of an incident: values {id, retries}, one more try by default. The service task gets the tries, the
   * incident is resolved and the instance goes on; the incident leaves the list when its task succeeds.
   */
  async retryIncidentAction(ctx: Context, next: Next) {
    const values = (ctx.action.params.values || {}) as Record<string, unknown>;
    const id = String(ctx.action.params.filterByTk ?? values.id ?? '').trim();
    if (!id) ctx.throw(400, this.tr(ctx, 'Choose the incident'));
    const retries = values.retries === undefined || values.retries === null ? 1 : Number(values.retries);
    if (!Number.isInteger(retries) || retries < 1 || retries > MAX_RETRIES) {
      ctx.throw(400, this.tr(ctx, 'The tries must be a whole number from 1 to {{max}}', { max: MAX_RETRIES }));
    }
    const incident = await this.withEngine(
      ctx,
      'incident.retry',
      async (engine) => {
        const found = await engine.getIncident(id);
        if (!found) throw new BpmEngineError('There is no open incident {{id}}', { id }, 404);
        await engine.retryIncident(found, retries);
        return found;
      },
      { detail: { incidentId: id, retries } },
      {
        after: (found) => ({
          processKey: found.processKey,
          instanceId: found.instanceId,
          taskId: found.jobId,
          detail: { element: found.elementId, type: found.type },
        }),
      },
    );
    this.registry.later('camunda', incident.instanceId);
    ctx.body = incident;
    await next();
  }

  /** The plugin's counts for Prometheus, with the key of BPM_METRICS_KEY as a bearer token or ?key=. */
  async metricsAction(ctx: Context, next: Next) {
    const key = process.env.BPM_METRICS_KEY || '';
    if (!key) ctx.throw(404);
    const given = String(
      (ctx.get('Authorization') || '').replace(/^Bearer\s+/i, '') || ctx.action.params.key || ctx.query?.key || '',
    );
    const same =
      Buffer.byteLength(given) === Buffer.byteLength(key) && timingSafeEqual(Buffer.from(given), Buffer.from(key));
    if (!same) ctx.throw(401);
    ctx.withoutDataWrapping = true;
    ctx.type = 'text/plain; version=0.0.4; charset=utf-8';
    ctx.body = await this.monitor.metrics();
    await next();
  }

  // «Read again» of an instance on its page: compared with the engine or the execution now (STORY-095, STORY-098).
  async refreshInstanceAction(ctx: Context, next: Next) {
    const row = await this.db.getRepository(INSTANCES_COLLECTION).findOne({ filterByTk: ctx.action.params.filterByTk });
    if (!row) ctx.throw(404);
    const instanceId = row.get('instanceId');
    if (row.get('builder') === 'nocobase') {
      await this.registry.refreshExecution(instanceId);
    } else {
      await this.withEngine(
        ctx,
        'instance.refresh',
        () => this.registry.refreshEngineInstance(instanceId, 'instance.sync'),
        { processKey: row.get('processKey'), businessKey: row.get('businessKey'), instanceId },
        { readOnly: true },
      );
    }
    ctx.body = await this.db.getRepository(INSTANCES_COLLECTION).findOne({ filterByTk: row.get('id') });
    await next();
  }

  // «Send again» and «put aside» of an outbox row, on the monitoring page (STORY-094, STORY-099).
  async outboxAction(ctx: Context, next: Next, action: 'resend' | 'discard') {
    let row: unknown;
    try {
      row = await this.outbox[action](ctx.action.params.filterByTk, ctx.state.currentUser?.id ?? null);
    } catch (error) {
      if (error instanceof BpmEngineError) ctx.throw(400, this.tr(ctx, error.message, error.values));
      throw error;
    }
    if (!row) ctx.throw(404);
    ctx.body = row;
    await next();
  }

  async getSettingsAction(ctx: Context, next: Next) {
    const { engine, url, username, password, fromEnv } = await this.settings();
    ctx.body = { engine, url, username, hasPassword: !!password, fromEnv };
    await next();
  }

  async saveSettingsAction(ctx: Context, next: Next) {
    const values = ctx.action.params.values || {};
    const url = typeof values.url === 'string' ? values.url.trim() : '';
    if (url && !/^https?:\/\/[^\s]+$/.test(url))
      ctx.throw(400, this.tr(ctx, 'The engine address must start with http:// or https://'));
    const engine = values.engine === undefined ? 'camunda8' : engineOf(values.engine);
    if (!engine) ctx.throw(400, this.tr(ctx, 'Choose Camunda 8 or Operaton as the engine'));
    const repository = this.db.getRepository('bpmSettings');
    const update: Record<string, unknown> = {
      engine,
      url,
      username: typeof values.username === 'string' ? values.username.trim() : '',
    };
    // An empty password keeps the saved one, since the page never sees it.
    if (typeof values.password === 'string' && values.password) update.password = values.password;
    if (await repository.findOne({ filterByTk: SETTINGS_ID })) {
      await repository.update({ filterByTk: SETTINGS_ID, values: update });
    } else {
      await repository.create({ values: { id: SETTINGS_ID, ...update } });
    }
    return this.getSettingsAction(ctx, next);
  }

  async testAction(ctx: Context, next: Next) {
    ctx.body = { version: await this.withEngine(ctx, 'version', (engine) => engine.version(), {}, { readOnly: true }) };
    await next();
  }

  async processesAction(ctx: Context, next: Next) {
    ctx.body = await this.withEngine(ctx, 'processes', (engine) => engine.listProcesses(), {}, { readOnly: true });
    await next();
  }

  /**
   * Deploys a .bpmn file, or a .form file of a Camunda form that user tasks link to (Camunda 8 only), given as text:
   * values {name, content}. The file name stays the same across versions, so the same file again makes no new one.
   */
  async deployAction(ctx: Context, next: Next) {
    const { name, content } = ctx.action.params.values || {};
    const fileName = typeof name === 'string' ? name.trim() : '';
    const text = typeof content === 'string' ? content : '';
    const isModel = /\.bpmn$/i.test(fileName) && text.includes('definitions');
    const isForm = /\.form$/i.test(fileName) && isFormSchema(text);
    if (!isModel && !isForm) ctx.throw(400, this.tr(ctx, 'This is not a BPMN or form file'));
    if (Buffer.byteLength(text) > MAX_MODEL_BYTES) ctx.throw(400, this.tr(ctx, 'The BPMN file is too large'));
    if (isForm && (await this.settings()).engine !== 'camunda8') {
      ctx.throw(400, this.tr(ctx, 'Only Camunda 8 takes form files'));
    }
    ctx.body = await this.withEngine(
      ctx,
      'deploy',
      (engine) => engine.deploy(fileName.replace(/\.(bpmn|form)$/i, ''), [{ name: fileName, content: text }]),
      { detail: { file: fileName } },
      {
        after: (deployment) => ({
          processKey: deployment.processes.length === 1 ? deployment.processes[0].key : null,
          detail: {
            deploymentId: deployment.id,
            processes: deployment.processes.map((process) => `${process.key}:${process.version}`),
          },
        }),
      },
    );
    await next();
  }
}

export default PluginBpmServer;
