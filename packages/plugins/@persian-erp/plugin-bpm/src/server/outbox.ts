import { randomUUID } from 'crypto';
import { EXECUTION_STATUS, JOB_STATUS } from '@nocobase/plugin-workflow';
import type { FlowNodeModel, Processor } from '@nocobase/plugin-workflow';
import type { Transaction } from 'sequelize';
import { BpmEngineError, Variables } from './engine';
import type { PluginBpmServer } from './plugin';
import { traces } from './trace';

export const OUTBOX_COLLECTION = 'bpmOutbox';
const DAY_MS = 24 * 60 * 60 * 1000;
// A message no instance waits for yet; Operaton keeps none for later, so the outbox does until its time to live ends.
const NOT_WAITING = 'NOT_WAITING';

export interface StartItem {
  kind: 'start';
  processKey: string;
  businessKey: string;
  variables: Variables;
}

export interface MessageItem {
  kind: 'message';
  name: string;
  businessKey: string;
  variables: Variables;
  /** How long the engine keeps a message no instance waits for yet; also how long the outbox keeps trying. */
  ttlMs: number;
  /** The same for every attempt, so the engine takes the message once. */
  messageId: string;
}

export type OutboxItem = StartItem | MessageItem;

export interface OutboxOptions {
  /** Milliseconds between two looks at the outbox. */
  interval: number;
  /** Rows sent in one look. */
  batch: number;
  /** Attempts before a row waits for a person; with the defaults about eleven hours of the engine away. */
  maxAttempts: number;
  /** The wait after the first failed attempt; it doubles up to maxDelayMs. */
  firstDelayMs: number;
  maxDelayMs: number;
  /** How long a row stays with the worker that took it; after a crash another one takes it then. */
  leaseMs: number;
}

const DEFAULTS: OutboxOptions = {
  interval: 2000,
  batch: 20,
  maxAttempts: 50,
  firstDelayMs: 5000,
  maxDelayMs: 15 * 60 * 1000,
  leaseMs: 5 * 60 * 1000,
};

type Attempt =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; retry: boolean; error: unknown; message: string };

/**
 * Failures worth waiting out: the engine away, slow or busy, its service user refused (fixed in the settings), no
 * engine set up yet, or a message no instance waits for yet. Anything else, such as a process that is not deployed,
 * needs a person; the row then waits on the monitoring page to be sent again.
 */
export function retryable(error: unknown) {
  if (!(error instanceof BpmEngineError)) return false;
  if (error.code === NOT_WAITING) return true;
  const { status } = error;
  return unreachable(error) || [401, 403, 408, 429].includes(status);
}

/** No answer, or the engine's own failure: the other rows would fail the same way now. */
function unreachable(error: unknown) {
  if (!(error instanceof BpmEngineError) || error.code === NOT_WAITING) return false;
  return error.status === undefined || error.status === null || error.status >= 500;
}

type Row = { get(name: string): any; toJSON(): Record<string, any> };

/** What the result of a workflow node says about the item it sent. */
const subject = (item: OutboxItem) =>
  item.kind === 'start'
    ? { processKey: item.processKey, businessKey: item.businessKey }
    : { name: item.name, businessKey: item.businessKey };

/**
 * The outbox of STORY-094: a start or message is sent at once; when the engine cannot take it, a row keeps it and
 * the worker sends it again, waiting longer each time, until it goes through or needs a person. The workflow job that
 * sent it waits for the row and goes on with the engine's answer. Sending twice is harmless: Camunda 8 keeps business
 * keys unique and takes a message ID once, and the Operaton adapter looks for the running instance first.
 */
export class BpmOutbox {
  options: OutboxOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastError: string | null = null;

  constructor(private bpm: PluginBpmServer, options: Partial<OutboxOptions> = {}) {
    const given = Object.entries(options).filter(([, value]) => value !== undefined && !Number.isNaN(value));
    this.options = { ...DEFAULTS, ...Object.fromEntries(given) };
  }

  private get repository() {
    return this.bpm.db.getRepository(OUTBOX_COLLECTION);
  }

  private get logger() {
    return this.bpm.app.logger;
  }

  /** The wait before the next attempt, after `attempts` failed ones; a little random, so rows do not move together. */
  delay(attempts: number) {
    const ms = Math.min(this.options.firstDelayMs * 2 ** Math.max(attempts - 1, 0), this.options.maxDelayMs);
    return Math.round(ms * (0.9 + Math.random() * 0.2));
  }

  private fields(item: OutboxItem) {
    return {
      processKey: item.kind === 'start' ? item.processKey : null,
      businessKey: item.businessKey,
    };
  }

  private async deliver(item: OutboxItem): Promise<Record<string, unknown>> {
    const engine = await this.bpm.getEngine();
    if (item.kind === 'start') {
      // Operaton does not keep business keys unique, so two starts for one key at once would make two instances
      // (decision 0007, section 6); Camunda 8 refuses the second, which then has to find the first by search. The
      // app's lock manager makes them wait for each other; across a cluster it needs the shared lock adapter of
      // NocoBase's cluster mode.
      return this.bpm.app.lockManager.runExclusive(
        `bpm-start:${item.processKey}:${item.businessKey}`,
        () => engine.start(item.processKey, item.businessKey, item.variables),
        30 * 1000,
      );
    }
    const { delivered } = await engine.publishMessage(item.name, item.businessKey, item.variables, {
      ttlMs: item.ttlMs,
      messageId: item.messageId,
    });
    if (!delivered) {
      const error = new BpmEngineError('No instance waits for the message {{name}} of {{businessKey}} yet', {
        name: item.name,
        businessKey: item.businessKey,
      });
      error.code = NOT_WAITING;
      throw error;
    }
    return { delivered };
  }

  /** One attempt to send an item, logged in bpmEvents; engine errors come back as the answer, not thrown. */
  async attempt(item: OutboxItem, extra: { userId?: unknown; outboxId?: unknown; attempt?: number } = {}) {
    const detail: Record<string, unknown> = {
      variables: Object.keys(item.variables || {}),
      ...(item.kind === 'message' ? { message: item.name } : {}),
      ...(extra.outboxId ? { outboxId: extra.outboxId, attempt: extra.attempt } : {}),
    };
    try {
      const result = await this.bpm.events.track(
        item.kind,
        { ...this.fields(item), userId: (extra.userId as string) ?? null, detail },
        () => this.deliver(item),
        {
          after: (result) => ({
            instanceId: (result.instanceId as string) ?? null,
            detail: 'created' in result ? { created: result.created } : {},
          }),
        },
      );
      return { ok: true, result } as Attempt;
    } catch (error) {
      const message =
        error instanceof BpmEngineError
          ? await this.bpm.translate(error.message, error.values)
          : (error as Error)?.message || String(error);
      return { ok: false, retry: retryable(error), error, message } as Attempt;
    }
  }

  /** Keeps an item that was not sent: pending for the worker, or failed for a person. */
  async enqueue(
    item: OutboxItem,
    values: {
      status: 'pending' | 'failed';
      attempts: number;
      lastError: string;
      jobId?: unknown;
      userId?: unknown;
      correlationId: string;
      transaction?: Transaction;
    },
  ) {
    const row = (await this.repository.create({
      values: {
        kind: item.kind,
        status: values.status,
        ...this.fields(item),
        messageName: item.kind === 'message' ? item.name : null,
        payload:
          item.kind === 'message'
            ? { variables: item.variables, ttlMs: item.ttlMs, messageId: item.messageId }
            : { variables: item.variables },
        attempts: values.attempts,
        nextAttemptAt: new Date(Date.now() + this.delay(values.attempts)),
        lastError: values.lastError,
        jobId: values.jobId ?? null,
        userId: values.userId ?? null,
        correlationId: values.correlationId,
      },
      transaction: values.transaction,
    })) as Row;
    const event = values.status === 'pending' ? 'outbox.queued' : 'outbox.failed';
    await this.bpm.events.note(event, {
      ...this.fields(item),
      userId: values.userId as string,
      detail: { outboxId: row.get('id'), kind: item.kind, error: values.lastError },
    });
    return row;
  }

  private itemOf(row: Row): OutboxItem {
    const payload = row.get('payload') || {};
    if (row.get('kind') === 'message') {
      return {
        kind: 'message',
        name: row.get('messageName'),
        businessKey: row.get('businessKey'),
        variables: payload.variables || {},
        ttlMs: payload.ttlMs,
        messageId: payload.messageId,
      };
    }
    return {
      kind: 'start',
      processKey: row.get('processKey'),
      businessKey: row.get('businessKey'),
      variables: payload.variables || {},
    };
  }

  /**
   * Takes a row for this worker: one update that only one worker can make, which also moves its next attempt past
   * the lease, so a crash in the middle leaves the row to be tried again later.
   */
  private async claim(row: Row) {
    const [count] = await this.bpm.db
      .getModel(OUTBOX_COLLECTION)
      .update(
        { attempts: row.get('attempts') + 1, nextAttemptAt: new Date(Date.now() + this.options.leaseMs) },
        { where: { id: row.get('id'), status: 'pending', attempts: row.get('attempts') }, hooks: false },
      );
    return count === 1;
  }

  /** Sends the rows that are due; returns how many it tried. */
  async runOnce() {
    const due = (await this.repository.find({
      filter: { status: 'pending', nextAttemptAt: { $lte: new Date() } },
      sort: ['id'],
      limit: this.options.batch,
    })) as Row[];
    let tried = 0;
    for (const row of due) {
      if (!(await this.claim(row))) continue;
      tried++;
      // While the engine cannot be reached the other rows wait too, rather than each failing the same way.
      if ((await this.send(row)) === 'unreachable') break;
    }
    return tried;
  }

  private async send(row: Row) {
    const id = row.get('id');
    const attempts = row.get('attempts') + 1;
    const item = this.itemOf(row);
    if (await this.jobNotSavedYet(row)) {
      await this.repository.update({
        filterByTk: id,
        values: { attempts: row.get('attempts'), nextAttemptAt: new Date(Date.now() + this.options.firstDelayMs) },
      });
      return 'later';
    }
    const correlationId = row.get('correlationId') || randomUUID();
    const sent = await traces.run({ correlationId }, () =>
      this.attempt(item, { userId: row.get('userId'), outboxId: id, attempt: attempts }),
    );
    const base = { ...subject(item), correlationId, outboxId: id };
    if (sent.ok) {
      await this.repository.update({
        filterByTk: id,
        values: { status: 'sent', sentAt: new Date(), result: sent.result, lastError: null, attempts },
      });
      await this.finishJob(row, JOB_STATUS.RESOLVED, { ...sent.result, ...base });
      return 'sent';
    }
    const expired = item.kind === 'message' && Date.now() > new Date(row.get('createdAt')).getTime() + item.ttlMs;
    if (sent.retry && !expired && attempts < this.options.maxAttempts) {
      await this.repository.update({
        filterByTk: id,
        values: { attempts, nextAttemptAt: new Date(Date.now() + this.delay(attempts)), lastError: sent.message },
      });
      return unreachable(sent.error) ? 'unreachable' : 'retry';
    }
    const error = expired
      ? await this.bpm.translate('No instance waited for the message {{name}} of {{businessKey}} in time', {
          name: (item as MessageItem).name,
          businessKey: item.businessKey,
        })
      : sent.message;
    await this.repository.update({ filterByTk: id, values: { status: 'failed', attempts, lastError: error } });
    await this.bpm.events.note('outbox.failed', { ...this.fields(item), detail: { outboxId: id, attempts, error } });
    await this.finishJob(row, JOB_STATUS.FAILED, { ...base, error });
    return 'failed';
  }

  /**
   * The workflow saves the job waiting for a row when its node has written the row; a row that is sent before that
   * would leave the job waiting. A job still missing after the lease belongs to an execution that stopped there, and
   * the row is sent all the same.
   */
  private async jobNotSavedYet(row: Row) {
    const jobId = row.get('jobId');
    if (!jobId || Date.now() - new Date(row.get('createdAt')).getTime() > this.options.leaseMs) return false;
    return !(await this.bpm.db.getRepository('jobs').findOne({ filterByTk: jobId }));
  }

  /** The workflow job waiting for the row goes on with the result, if its execution still runs. */
  private async finishJob(row: Row, status: number, result: Record<string, unknown>) {
    const jobId = row.get('jobId');
    if (!jobId) return;
    const workflow = (this.bpm.app.pm.get('workflow') as unknown) as
      | { resume(job: unknown): Promise<void> }
      | undefined;
    const job = await this.bpm.db.getRepository('jobs').findOne({ filterByTk: jobId });
    if (!workflow || !job || job.get('status') !== JOB_STATUS.PENDING) return;
    const execution = await job.getExecution();
    if (!execution || execution.get('status') !== EXECUTION_STATUS.STARTED) return;
    job.set({ status, result });
    await workflow.resume(job);
  }

  /** «Send again» on the monitoring page: a failed or put-aside row is tried again soon, with its attempts anew. */
  async resend(id: unknown, userId: unknown) {
    const row = (await this.repository.findOne({ filterByTk: id as string })) as Row;
    if (!row) return null;
    if (!['failed', 'discarded', 'pending'].includes(row.get('status'))) {
      throw new BpmEngineError('Only an item that was not sent can be sent again');
    }
    await this.repository.update({
      filterByTk: id as string,
      values: { status: 'pending', attempts: 0, nextAttemptAt: new Date() },
    });
    await this.bpm.events.note('outbox.resent', {
      ...this.fields(this.itemOf(row)),
      userId: userId as string,
      detail: { outboxId: row.get('id') },
    });
    return this.repository.findOne({ filterByTk: id as string });
  }

  /** «Put aside»: the row is not sent; a workflow waiting for it fails with the reason. */
  async discard(id: unknown, userId: unknown) {
    const row = (await this.repository.findOne({ filterByTk: id as string })) as Row;
    if (!row) return null;
    if (!['failed', 'pending'].includes(row.get('status'))) {
      throw new BpmEngineError('Only an item that was not sent can be put aside');
    }
    const error = await this.bpm.translate('Put aside in the outbox');
    await this.repository.update({ filterByTk: id as string, values: { status: 'discarded', lastError: error } });
    await this.bpm.events.note('outbox.discarded', {
      ...this.fields(this.itemOf(row)),
      userId: userId as string,
      detail: { outboxId: row.get('id') },
    });
    await this.finishJob(row, JOB_STATUS.FAILED, {
      ...subject(this.itemOf(row)),
      correlationId: row.get('correlationId'),
      outboxId: row.get('id'),
      error,
    });
    return this.repository.findOne({ filterByTk: id as string });
  }

  /** Removes sent and put-aside rows older than the retention of the connection log; pending and failed ones stay. */
  async cleanup(now = new Date()) {
    const before = new Date(now.getTime() - this.bpm.events.retentionDays * DAY_MS);
    return this.repository.destroy({
      filter: { status: { $in: ['sent', 'discarded'] }, updatedAt: { $lt: before } },
    });
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
    let tried = 0;
    try {
      tried = await this.runOnce();
      this.lastError = null;
    } catch (error) {
      const message = (error as Error).message;
      // Once until it changes, not on every look.
      if (message !== this.lastError) this.logger.warn(`bpm outbox: ${message}`, { module: 'bpm' });
      this.lastError = message;
    }
    this.schedule(tried >= this.options.batch ? 0 : this.options.interval);
  }
}

/**
 * Sends an item from a workflow node (STORY-094). Sent at once: the node resolves with the engine's answer. Engine
 * away: a pending row keeps it and the node waits for it, or, in a workflow that runs synchronously and cannot wait,
 * resolves as queued. Refused by the engine: the node fails, and a failed row keeps the item to be sent again.
 */
export async function sendFromNode(
  bpm: PluginBpmServer,
  item: OutboxItem,
  node: FlowNodeModel,
  prevJob: { id?: unknown } | null,
  processor: Processor,
  userId: unknown,
) {
  return bpm.events.trace(async (correlationId) => {
    const base = { ...subject(item), correlationId };
    const sent = await bpm.outbox.attempt(item, { userId });
    if (sent.ok) return { status: JOB_STATUS.RESOLVED, result: { ...sent.result, ...base } };
    if (!(sent.error instanceof BpmEngineError)) throw sent.error;
    const transaction = processor.transaction as Transaction | undefined;
    const queue = (status: 'pending' | 'failed', jobId?: unknown) =>
      bpm.outbox.enqueue(item, {
        status,
        attempts: 1,
        lastError: sent.message,
        jobId,
        userId,
        correlationId,
        transaction,
      });
    if (!sent.retry) {
      const row = await queue('failed');
      processor.logger.warn(`${node.type} (#${node.id}) failed [${correlationId}]: ${sent.message}`);
      return { status: JOB_STATUS.FAILED, result: { ...base, error: sent.message, outboxId: row.get('id') } };
    }
    processor.logger.warn(`${node.type} (#${node.id}) queued [${correlationId}]: ${sent.message}`);
    if (processor.isInstructionSync(node)) {
      const row = await queue('pending');
      return { status: JOB_STATUS.RESOLVED, result: { ...base, queued: true, outboxId: row.get('id') } };
    }
    const job = processor.saveJob({
      status: JOB_STATUS.PENDING,
      nodeId: node.id,
      nodeKey: node.key,
      upstreamId: prevJob?.id ?? null,
      result: { ...base, queued: true },
    });
    await queue('pending', job.id);
    await processor.exit();
    return undefined;
  });
}
