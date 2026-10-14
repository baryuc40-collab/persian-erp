import type { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import bpmSettingsCollection from './bpm-settings-collection';
import { BpmEngine, BpmEngineError } from './engine';
import { OperatonEngine, OperatonSettings } from './operaton';
import { SERVICE_TASK_TRIGGER, ServiceTaskTrigger } from './service-task-trigger';
import { START_INSTRUCTION, StartProcessInstruction } from './start-instruction';
import { ServiceTaskWorker } from './worker';

export const BPM_RESOURCE = 'bpm';
export const BPM_SNIPPET = 'pm.bpm';
const NAMESPACE = '@persian-erp/plugin-bpm';
const SETTINGS_ID = 1;
const MAX_MODEL_BYTES = 2 * 1024 * 1024;

export class PluginBpmServer extends Plugin {
  /** Builds the engine of the saved settings; another adapter can take its place in tests. */
  createEngine: (settings: OperatonSettings) => BpmEngine = (settings) => new OperatonEngine(settings);

  /** Runs the service tasks of the engine (STORY-081); off with BPM_WORKER=off. */
  worker = new ServiceTaskWorker(this, { interval: Number(process.env.BPM_WORKER_INTERVAL) || undefined });

  async beforeLoad() {
    this.db.collection(bpmSettingsCollection);
    this.app.acl.registerSnippet({ name: BPM_SNIPPET, actions: [`${BPM_RESOURCE}:*`] });
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
      workflow.registerTrigger(SERVICE_TASK_TRIGGER, ServiceTaskTrigger);
      if (process.env.BPM_WORKER !== 'off') {
        this.app.on('afterStart', () => this.worker.start());
        this.app.on('beforeStop', () => this.worker.stop());
        this.app.on('beforeDestroy', () => this.worker.stop());
      }
    }

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
  }

  /**
   * The connection settings: what the administrator saved, else BPM_ENGINE_URL, BPM_ENGINE_USERNAME and
   * BPM_ENGINE_PASSWORD from the environment (docker-compose.yml sets them for the bpm profile).
   */
  async settings(): Promise<OperatonSettings & { fromEnv: boolean }> {
    const row = await this.db.getRepository('bpmSettings').findOne({ filterByTk: SETTINGS_ID });
    const url = (row?.get('url') as string) || '';
    if (url) {
      return {
        url,
        username: (row.get('username') as string) || '',
        password: (row.get('password') as string) || '',
        fromEnv: false,
      };
    }
    return {
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
    return this.app.i18n.t(message, { ns: NAMESPACE, lng, ...values });
  }

  private tr(ctx: Context, message: string, values: Record<string, unknown> = {}) {
    return ctx.t(message, { ns: NAMESPACE, ...values });
  }

  // Engine errors become a 400 with the translated message; anything else is a server error.
  private async withEngine<T>(ctx: Context, run: (engine: BpmEngine) => Promise<T>) {
    try {
      return await run(await this.getEngine());
    } catch (error) {
      if (error instanceof BpmEngineError) ctx.throw(400, this.tr(ctx, error.message, error.values));
      throw error;
    }
  }

  async getSettingsAction(ctx: Context, next: Next) {
    const { url, username, password, fromEnv } = await this.settings();
    ctx.body = { url, username, hasPassword: !!password, fromEnv };
    await next();
  }

  async saveSettingsAction(ctx: Context, next: Next) {
    const values = ctx.action.params.values || {};
    const url = typeof values.url === 'string' ? values.url.trim() : '';
    if (url && !/^https?:\/\/[^\s]+$/.test(url))
      ctx.throw(400, this.tr(ctx, 'The engine address must start with http:// or https://'));
    const repository = this.db.getRepository('bpmSettings');
    const update: Record<string, unknown> = {
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
    ctx.body = { version: await this.withEngine(ctx, (engine) => engine.version()) };
    await next();
  }

  async processesAction(ctx: Context, next: Next) {
    ctx.body = await this.withEngine(ctx, (engine) => engine.listProcesses());
    await next();
  }

  /** Deploys a .bpmn file given as text: values {name, content}. */
  async deployAction(ctx: Context, next: Next) {
    const { name, content } = ctx.action.params.values || {};
    const fileName = typeof name === 'string' ? name.trim() : '';
    if (!/\.bpmn$/i.test(fileName) || typeof content !== 'string' || !content.includes('definitions')) {
      ctx.throw(400, this.tr(ctx, 'This is not a BPMN file'));
    }
    if (Buffer.byteLength(content) > MAX_MODEL_BYTES) ctx.throw(400, this.tr(ctx, 'The BPMN file is too large'));
    ctx.body = await this.withEngine(ctx, (engine) =>
      engine.deploy(fileName.replace(/\.bpmn$/i, ''), [{ name: fileName, content }]),
    );
    await next();
  }
}

export default PluginBpmServer;
