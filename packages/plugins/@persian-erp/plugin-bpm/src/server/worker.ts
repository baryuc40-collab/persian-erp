import os from 'os';
import { BpmEngine, BpmEngineError, ServiceTask } from './engine';
import { SERVICE_TASK_TRIGGER } from './service-task-trigger';
import type PluginBpmServer from './plugin';

// EXECUTION_STATUS.RESOLVED of plugin-workflow.
const RESOLVED = 1;

type WorkflowRow = { id: number; key: string; config: { topic?: string }; get(name: string): unknown };
interface WorkflowPlugin {
  trigger(workflow: unknown, context: object): Promise<{ execution: { id: number; status: number } } | null> | void;
}

export interface WorkerOptions {
  /** Milliseconds between two polls when there was nothing to do. */
  interval: number;
  /** How long a fetched task stays locked to this worker. */
  lockMs: number;
  maxTasks: number;
  /** Retries a task gets when its first run fails, and the wait before the next one. */
  retries: number;
  retryMs: number;
}

const DEFAULTS: WorkerOptions = { interval: 2000, lockMs: 60000, maxTasks: 10, retries: 3, retryMs: 10000 };

/**
 * Takes the service tasks of the engine (Camunda 8 jobs, Operaton external tasks) whose topic has an enabled «BPMN
 * service task» workflow, runs that workflow with the task, and completes the task or reports the failure (decision
 * 0007, section 6). Each app instance has its own worker ID, so in a cluster the engine gives each task to one of them.
 */
export class ServiceTaskWorker {
  readonly workerId = `nocobase-${os.hostname()}-${process.pid}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastError: string | null = null;
  options: WorkerOptions;

  constructor(private bpm: PluginBpmServer, options: Partial<WorkerOptions> = {}) {
    const given = Object.entries(options).filter(([, value]) => value !== undefined);
    this.options = { ...DEFAULTS, ...Object.fromEntries(given) };
  }

  private get logger() {
    return this.bpm.app.logger;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => this.loop(), ms);
  }

  private async loop() {
    let handled = 0;
    try {
      handled = await this.runOnce();
      if (this.lastError) this.logger.info('bpm worker: the engine answers again');
      this.lastError = null;
    } catch (error) {
      const message =
        error instanceof BpmEngineError
          ? await this.bpm.translate(error.message, error.values)
          : (error as Error).message;
      // Once per outage, not on every poll while the engine is down.
      if (message !== this.lastError) {
        this.logger.warn(`bpm worker: ${message}`);
        await this.bpm.events.fail('serviceTask.fetch', {}, error);
      }
      this.lastError = message;
    }
    // Right away when there may be more tasks, else after the interval.
    this.schedule(handled >= this.options.maxTasks ? 0 : this.options.interval);
  }

  /** The current, enabled workflows of each topic. */
  private async workflowsByTopic() {
    const rows = ((await this.bpm.db.getRepository('workflows').find({
      filter: { type: SERVICE_TASK_TRIGGER, enabled: true, current: true },
    })) as unknown) as WorkflowRow[];
    const byTopic = new Map<string, WorkflowRow[]>();
    for (const row of rows) {
      const topic = String((row.get('config') as { topic?: string })?.topic || '').trim();
      if (!topic) continue;
      byTopic.set(topic, [...(byTopic.get(topic) || []), row]);
    }
    return byTopic;
  }

  /** Fetches and handles one batch of tasks; returns how many it handled. */
  async runOnce() {
    const byTopic = await this.workflowsByTopic();
    if (!byTopic.size) return 0;
    const settings = await this.bpm.settings();
    if (!settings.url) return 0;
    const engine = await this.bpm.getEngine();
    const tasks = await engine.fetchServiceTasks(
      this.workerId,
      [...byTopic.keys()].map((name) => ({ name, lockMs: this.options.lockMs })),
      this.options.maxTasks,
    );
    for (const task of tasks) {
      await this.handle(engine, task, byTopic.get(task.topic) || []);
    }
    return tasks.length;
  }

  // One correlation ID from receiving the task to reporting on it; the workflows get it in their context too.
  private handle(engine: BpmEngine, task: ServiceTask, workflows: WorkflowRow[]) {
    return this.bpm.events.trace((correlationId) => this.run(engine, task, workflows, correlationId));
  }

  private async run(engine: BpmEngine, task: ServiceTask, workflows: WorkflowRow[], correlationId: string) {
    const fields = {
      processKey: task.processKey,
      businessKey: task.businessKey,
      instanceId: task.processInstanceId,
      taskId: task.id,
    };
    await this.bpm.events.note('serviceTask.received', { ...fields, detail: { topic: task.topic } }, 'in');
    const workflowPlugin = (this.bpm.app.pm.get('workflow') as unknown) as WorkflowPlugin;
    const [collection, recordId] = splitBusinessKey(task.businessKey);
    const context = {
      task: {
        id: task.id,
        topic: task.topic,
        processKey: task.processKey,
        businessKey: task.businessKey,
        correlationId,
      },
      collection,
      recordId,
      variables: task.variables,
    };
    const failures: string[] = [];
    for (const workflow of workflows) {
      const processor = await workflowPlugin.trigger(workflow, context);
      if (!processor || processor.execution.status !== RESOLVED) {
        // The engine shows this as the incident's message: short, in the app's language, with the execution to look up.
        failures.push(
          await this.bpm.translate('The workflow "{{title}}" did not succeed (execution {{execution}}).', {
            title: workflow.get('title') || workflow.get('key'),
            execution: processor ? processor.execution.id : '-',
          }),
        );
      }
    }
    if (!failures.length) {
      await this.bpm.events.track('serviceTask.complete', fields, () =>
        engine.completeServiceTask(this.workerId, task.id),
      );
      return;
    }
    // The first failure sets the number of retries; after that the engine counts them down.
    const retries = Math.max((task.retries ?? this.options.retries) - (task.retries === null ? 0 : 1), 0);
    const message = failures.join(' ');
    await this.bpm.events.track('serviceTask.fail', { ...fields, detail: { retries, message } }, () =>
      engine.failServiceTask(this.workerId, task.id, { message, retries, retryMs: this.options.retryMs }),
    );
  }
}

/** "<collection>:<id>" (decision 0007, section 4); a number when the ID is one. */
export function splitBusinessKey(businessKey: string | null): [string | null, string | number | null] {
  const match = /^([^:]+):(.+)$/.exec(businessKey || '');
  if (!match) return [null, null];
  return [match[1], /^\d+$/.test(match[2]) ? Number(match[2]) : match[2]];
}

export default ServiceTaskWorker;
