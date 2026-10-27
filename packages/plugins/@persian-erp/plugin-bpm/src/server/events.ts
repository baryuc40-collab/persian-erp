import { randomUUID } from 'crypto';
import { BpmEngineError } from './engine';
import type { PluginBpmServer } from './plugin';
import { currentCorrelationId, traces } from './trace';

export const EVENTS_COLLECTION = 'bpmEvents';
const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
// The nightly cleanup runs at this hour of the server's time.
const CLEANUP_HOUR = 3;

export interface EventFields {
  processKey?: string | null;
  businessKey?: string | null;
  instanceId?: string | null;
  taskId?: string | null;
  userId?: string | number | null;
  /** Names and counts only; never form values, variables or passwords. */
  detail?: Record<string, unknown> | null;
}

export interface TrackOptions<T> {
  /** out (the default): NocoBase asks the engine; in: the engine hands NocoBase work. */
  direction?: 'out' | 'in';
  /** A read: logged only when it fails. */
  readOnly?: boolean;
  /** What the result adds to the row, such as the instance a start made. */
  after?: (result: T) => EventFields;
}

type Row = EventFields & {
  direction: 'out' | 'in';
  event: string;
  correlationId: string;
  durationMs?: number | null;
  status: 'ok' | 'error';
  httpStatus?: number | null;
  error?: string | null;
};

const text = (value: unknown) => (value === undefined || value === null || value === '' ? null : String(value));

/**
 * The connection log (STORY-093): times each exchange with the engine under a correlation ID, writes it to bpmEvents
 * and to the server log, and removes old rows every night. Writing the log never breaks the exchange itself.
 */
export class BpmEvents {
  private timer: NodeJS.Timeout | null = null;

  constructor(private bpm: PluginBpmServer) {}

  private get logger() {
    return this.bpm.app.logger;
  }

  get retentionDays() {
    const days = Number(process.env.BPM_EVENTS_RETENTION_DAYS);
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
  }

  /**
   * Runs one exchange with the engine: under the correlation ID of the exchange around it, or a new one. Its requests
   * carry the ID; the row is written when it ends, with the error when it failed, which is then thrown on.
   */
  async track<T>(event: string, fields: EventFields, run: () => Promise<T>, options: TrackOptions<T> = {}) {
    const correlationId = currentCorrelationId() || randomUUID();
    const started = Date.now();
    const base = { ...fields, event, correlationId, direction: options.direction || 'out' } as const;
    let result: T;
    try {
      result = await traces.run({ correlationId }, run);
    } catch (error) {
      await this.write({ ...base, durationMs: Date.now() - started, ...(await this.failure(error)) });
      throw error;
    }
    if (!options.readOnly) {
      const more = options.after ? options.after(result) : {};
      await this.write({
        ...base,
        ...more,
        detail: { ...fields.detail, ...more.detail },
        durationMs: Date.now() - started,
        status: 'ok',
      });
    }
    return result;
  }

  /** Runs work under a correlation ID of its own, such as a service task from receiving it to reporting on it. */
  trace<T>(run: (correlationId: string) => Promise<T>) {
    const correlationId = currentCorrelationId() || randomUUID();
    return traces.run({ correlationId }, () => run(correlationId));
  }

  /** A row for something that is not a request, such as a service task the engine handed over. */
  async note(event: string, fields: EventFields, direction: 'out' | 'in' = 'out') {
    await this.write({
      ...fields,
      event,
      direction,
      correlationId: currentCorrelationId() || randomUUID(),
      status: 'ok',
    });
  }

  /** A failure not inside track, such as the worker finding the engine down. */
  async fail(event: string, fields: EventFields, error: unknown) {
    await this.write({
      ...fields,
      event,
      direction: 'out',
      correlationId: currentCorrelationId() || randomUUID(),
      ...(await this.failure(error)),
    });
  }

  private async failure(error: unknown) {
    const message =
      error instanceof BpmEngineError
        ? await this.bpm.translate(error.message, error.values)
        : (error as Error)?.message || String(error);
    return {
      status: 'error' as const,
      httpStatus: error instanceof BpmEngineError ? error.status ?? null : null,
      error: message,
    };
  }

  private async write(row: Row) {
    const values = {
      direction: row.direction,
      event: row.event,
      engine: await this.engineKind(),
      processKey: text(row.processKey),
      businessKey: text(row.businessKey),
      instanceId: text(row.instanceId),
      taskId: text(row.taskId),
      userId: text(row.userId),
      correlationId: row.correlationId,
      durationMs: row.durationMs ?? null,
      status: row.status,
      httpStatus: row.httpStatus ?? null,
      error: row.error ?? null,
      detail: row.detail && Object.keys(row.detail).length ? row.detail : null,
    };
    // The same exchange in the server log, findable by its correlation ID.
    const line = `bpm ${values.event} ${values.status} [${values.correlationId}]`;
    const meta = {
      module: 'bpm',
      correlationId: values.correlationId,
      event: values.event,
      processKey: values.processKey,
      businessKey: values.businessKey,
      instanceId: values.instanceId,
      taskId: values.taskId,
      userId: values.userId,
      durationMs: values.durationMs,
      httpStatus: values.httpStatus,
    };
    if (values.status === 'error') this.logger.warn(`${line}: ${values.error}`, meta);
    else this.logger.info(line, meta);
    try {
      await this.bpm.db.getRepository(EVENTS_COLLECTION).create({ values });
    } catch (error) {
      this.logger.warn(`bpm: the event ${values.correlationId} was not saved: ${(error as Error).message}`, meta);
    }
  }

  private async engineKind() {
    try {
      return (await this.bpm.settings()).engine;
    } catch {
      return null;
    }
  }

  /** Removes the rows older than the retention; returns how many. */
  async cleanup(now = new Date()) {
    const before = new Date(now.getTime() - this.retentionDays * DAY_MS);
    const removed = await this.bpm.db
      .getRepository(EVENTS_COLLECTION)
      .destroy({ filter: { createdAt: { $lt: before } } });
    this.logger.info(`bpm: removed ${removed} connection events older than ${this.retentionDays} days`, {
      module: 'bpm',
    });
    return removed;
  }

  /** Every night at CLEANUP_HOUR; each app instance runs it, and a second run in a cluster finds nothing left. */
  startCleanup() {
    this.stopCleanup();
    const next = new Date();
    next.setHours(CLEANUP_HOUR, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setTime(next.getTime() + DAY_MS);
    this.timer = setTimeout(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        this.logger.warn(`bpm: the cleanup of connection events failed: ${(error as Error).message}`, {
          module: 'bpm',
        });
      }
      this.startCleanup();
    }, next.getTime() - Date.now());
    this.timer.unref?.();
  }

  stopCleanup() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
