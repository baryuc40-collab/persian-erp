import type { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import { randomUUID } from 'crypto';
import bpmEventsCollection from './bpm-events-collection';
import bpmOutboxCollection from './bpm-outbox-collection';
import bpmSettingsCollection from './bpm-settings-collection';
import { Camunda8Engine } from './camunda8';
import { BpmEngine, BpmEngineError, EngineKind, ENGINES } from './engine';
import { BpmEvents, EventFields, EVENTS_COLLECTION, TrackOptions } from './events';
import { EngineSettings } from './http';
import { MESSAGE_INSTRUCTION, SendMessageInstruction } from './message-instruction';
import { OperatonEngine } from './operaton';
import { BpmOutbox, OUTBOX_COLLECTION } from './outbox';
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
};

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
    settings.engine === 'operaton' ? new OperatonEngine(settings) : new Camunda8Engine(settings);

  /** Runs the service tasks of the engine (STORY-081); off with BPM_WORKER=off. */
  worker = new ServiceTaskWorker(this, { interval: Number(process.env.BPM_WORKER_INTERVAL) || undefined });

  /** The connection log bpmEvents (STORY-093). */
  events = new BpmEvents(this);

  /** The outbox bpmOutbox for starts and messages the engine could not take (STORY-094). */
  outbox = new BpmOutbox(this, {
    interval: Number(process.env.BPM_OUTBOX_INTERVAL) || undefined,
    maxAttempts: Number(process.env.BPM_OUTBOX_MAX_ATTEMPTS) || undefined,
  });

  async beforeLoad() {
    this.db.collection(bpmSettingsCollection);
    this.db.collection(bpmEventsCollection);
    this.db.collection(bpmOutboxCollection);
    this.app.acl.registerSnippet({
      name: BPM_SNIPPET,
      actions: [
        `${BPM_RESOURCE}:*`,
        ...Object.entries(API_ACTIONS).flatMap(([name, actions]) => actions.map((action) => `${name}:${action}`)),
      ],
    });
    // Open to every signed-in user; the actions return and accept only the user's own tasks (STORY-082).
    this.app.acl.allow(TASKS_RESOURCE, ['list', 'get', 'complete'], 'loggedIn');
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
      if (process.env.BPM_WORKER !== 'off') {
        for (const runner of [this.worker, this.outbox]) {
          this.app.on('afterStart', () => runner.start());
          this.app.on('beforeStop', () => runner.stop());
          this.app.on('beforeDestroy', () => runner.stop());
        }
      }
    }

    this.app.on('afterStart', () => this.events.startCleanup());
    this.app.on('beforeStop', () => this.events.stopCleanup());
    this.app.on('beforeDestroy', () => this.events.stopCleanup());
    // Rows are written by the plugin alone, also for the root role.
    this.app.resourceManager.use(
      async (ctx: Context, next: Next) => {
        const { resourceName, actionName } = ctx.action || {};
        if (API_ACTIONS[resourceName] && !API_ACTIONS[resourceName].includes(actionName)) {
          ctx.throw(
            403,
            this.tr(
              ctx,
              resourceName === OUTBOX_COLLECTION
                ? 'An outbox item can only be sent again or put aside'
                : 'The connection log is read-only',
            ),
          );
        }
        await next();
      },
      { tag: 'bpm-read-only', before: 'acl' },
    );
    this.app.resourceManager.registerActionHandlers({
      [`${OUTBOX_COLLECTION}:resend`]: (ctx: Context, next: Next) => this.outboxAction(ctx, next, 'resend'),
      [`${OUTBOX_COLLECTION}:discard`]: (ctx: Context, next: Next) => this.outboxAction(ctx, next, 'discard'),
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

  /** Every night: the old rows of the connection log and the outbox. */
  async cleanup(now = new Date()) {
    await this.events.cleanup(now);
    await this.outbox.cleanup(now);
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
