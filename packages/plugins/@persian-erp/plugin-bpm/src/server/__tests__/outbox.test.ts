import { createMockServer, MockServer } from '@nocobase/test';
import { BpmEngine, BpmEngineError, Variables } from '../engine';
import PluginBpmServer from '../plugin';

// The outbox (STORY-094), with a stand-in engine: a start or message the engine cannot take waits in bpmOutbox and is
// sent later, the workflow node waits for it, and nothing is lost or sent twice.

const JOB_PENDING = 0;
const JOB_RESOLVED = 1;
const JOB_FAILED = -1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorOf = (res) => res.body.errors?.[0]?.message as string;
const away = () =>
  new BpmEngineError('The BPMN engine cannot be reached: {{reason}}', { reason: 'connect ECONNREFUSED' });

describe('bpm outbox', () => {
  let app: MockServer;
  let bpm: PluginBpmServer;
  let engine: Partial<BpmEngine>;
  let started: { processKey: string; businessKey: string; variables: Variables }[];
  let published: { name: string; businessKey: string; variables: Variables; ttlMs: number; messageId: string }[];
  let engineAway: boolean;

  const outbox = async () => (await app.db.getRepository('bpmOutbox').find({ sort: ['id'] })).map((r) => r.toJSON());
  const due = () =>
    app.db.getRepository('bpmOutbox').update({ filter: { status: 'pending' }, values: { nextAttemptAt: new Date() } });
  const jobs = async () => (await app.db.getRepository('jobs').find({ sort: ['id'] })).map((r) => r.toJSON());
  const executions = async () =>
    (await app.db.getRepository('executions').find({ sort: ['id'] })).map((r) => r.get('status'));

  const workflowWith = async (type: string, config: Record<string, unknown>, sync = false) => {
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, sync, type: 'collection', config: { mode: 1, collection: 'purchase_requests' } },
    });
    await app.db.getRepository('flow_nodes').create({ values: { workflowId: workflow.get('id'), type, config } });
    return workflow;
  };
  const startWorkflow = (sync = false) =>
    workflowWith(
      'bpm-start',
      {
        processKey: 'purchase_request',
        businessKey: 'purchase_requests:{{$context.data.id}}',
        variables: [{ name: 'title', value: '{{$context.data.title}}' }],
      },
      sync,
    );
  const messageWorkflow = (ttlMinutes?: number) =>
    workflowWith('bpm-message', {
      messageName: 'payment-received',
      businessKey: 'purchase_requests:{{$context.data.id}}',
      variables: [{ name: 'paid', value: true }],
      ttlMinutes,
    });
  const request = async (title = 'لپ‌تاپ') => {
    const record = await app.db.getRepository('purchase_requests').create({ values: { title } });
    await sleep(500);
    return record;
  };
  const root = async () => {
    const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
    return app.agent().login(user, 'root');
  };

  beforeEach(async () => {
    // The tests run the outbox themselves.
    process.env.BPM_WORKER = 'off';
    app = await createMockServer({
      plugins: [
        'error-handler',
        'field-sort',
        'users',
        'auth',
        'acl',
        'data-source-main',
        'data-source-manager',
        'system-settings',
        'workflow',
        PluginBpmServer,
      ],
      acl: true,
    });
    app.db.collection({ name: 'purchase_requests', fields: [{ type: 'string', name: 'title' }] });
    await app.db.sync();

    started = [];
    published = [];
    engineAway = false;
    engine = {
      start: async (processKey, businessKey, variables = {}) => {
        if (engineAway) throw away();
        const created = !started.some((s) => s.businessKey === businessKey);
        started.push({ processKey, businessKey, variables });
        return { instanceId: `pi-${started.length}`, created };
      },
      publishMessage: async (name, businessKey, variables, { ttlMs, messageId }) => {
        if (engineAway) throw away();
        published.push({ name, businessKey, variables, ttlMs, messageId });
        return { delivered: true };
      },
    };
    bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    bpm.createEngine = () => engine as BpmEngine;
    await app.db
      .getRepository('bpmSettings')
      .create({ values: { id: 1, engine: 'camunda8', url: 'http://camunda:8080' } });
  });

  afterEach(async () => {
    delete process.env.BPM_WORKER;
    await app.destroy();
  });

  it('keeps trying while the engine is away, waiting longer each time, and logs each attempt under one ID', async () => {
    await startWorkflow();
    engineAway = true;
    const record = await request();
    const [queued] = await outbox();
    expect(queued).toMatchObject({
      kind: 'start',
      status: 'pending',
      processKey: 'purchase_request',
      businessKey: `purchase_requests:${record.get('id')}`,
      payload: { variables: { title: 'لپ‌تاپ' } },
      attempts: 1,
      lastError: 'The BPMN engine cannot be reached: connect ECONNREFUSED',
    });
    const [job] = await jobs();
    expect(job.status).toBe(JOB_PENDING);
    expect(String(queued.jobId)).toBe(String(job.id));

    await due();
    expect(await bpm.outbox.runOnce()).toBe(1);
    const [second] = await outbox();
    expect(second.attempts).toBe(2);
    // 10 seconds after the second attempt, give or take a tenth.
    expect(new Date(second.nextAttemptAt).getTime() - Date.now()).toBeGreaterThan(8500);

    engineAway = false;
    await due();
    expect(await bpm.outbox.runOnce()).toBe(1);
    await sleep(500);
    const [sent] = await outbox();
    expect(sent).toMatchObject({ status: 'sent', attempts: 3, lastError: null, result: { instanceId: 'pi-1' } });
    expect(started).toHaveLength(1);
    const [resumed] = await jobs();
    expect(resumed.status).toBe(JOB_RESOLVED);
    expect(resumed.result).toMatchObject({ instanceId: 'pi-1', created: true, outboxId: sent.id });
    expect(await executions()).toEqual([1]);

    const events = (await app.db.getRepository('bpmEvents').find({ sort: ['id'] })).map((r) => r.toJSON());
    expect(events.map((e) => `${e.event} ${e.status}`)).toEqual([
      'start error',
      'outbox.queued ok',
      'start error',
      'start ok',
    ]);
    expect(new Set(events.map((e) => e.correlationId))).toEqual(new Set([queued.correlationId]));
    expect(events[3].detail).toMatchObject({ outboxId: sent.id, attempt: 3 });
  });

  it('waits for a person after the last attempt, and «send again» sends it', async () => {
    bpm.outbox.options.maxAttempts = 2;
    await startWorkflow();
    engineAway = true;
    await request();
    await due();
    await bpm.outbox.runOnce();
    await sleep(500);
    const [failed] = await outbox();
    expect(failed).toMatchObject({ status: 'failed', attempts: 2 });
    const [job] = await jobs();
    expect(job.status).toBe(JOB_FAILED);
    expect(job.result).toMatchObject({ error: 'The BPMN engine cannot be reached: connect ECONNREFUSED' });
    expect(await executions()).toEqual([-1]);

    engineAway = false;
    const agent = await root();
    const res = await agent.resource('bpmOutbox').resend({ filterByTk: failed.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await bpm.outbox.runOnce()).toBe(1);
    expect((await outbox())[0].status).toBe('sent');
    expect(started).toHaveLength(1);
    const events = (await app.db.getRepository('bpmEvents').find({ sort: ['id'] })).map((r) => r.get('event'));
    expect(events).toContain('outbox.failed');
    expect(events).toContain('outbox.resent');

    const again = await agent.resource('bpmOutbox').resend({ filterByTk: failed.id });
    expect(again.status).toBe(400);
    expect(errorOf(again)).toBe('Only an item that was not sent can be sent again');
  });

  it('fails the waiting node with the reason when a person puts the item aside', async () => {
    await startWorkflow();
    engineAway = true;
    await request();
    const [queued] = await outbox();
    const agent = await root();
    const res = await agent.resource('bpmOutbox').discard({ filterByTk: queued.id });
    expect(res.status).toBe(200);
    await sleep(500);
    expect((await outbox())[0]).toMatchObject({ status: 'discarded', lastError: 'Put aside in the outbox' });
    const [job] = await jobs();
    expect(job.status).toBe(JOB_FAILED);
    expect(job.result).toMatchObject({ error: 'Put aside in the outbox', outboxId: queued.id });

    engineAway = false;
    await due();
    expect(await bpm.outbox.runOnce()).toBe(0);
    expect(started).toEqual([]);
    const again = await agent.resource('bpmOutbox').discard({ filterByTk: queued.id });
    expect(again.status).toBe(400);
    expect(errorOf(again)).toBe('Only an item that was not sent can be put aside');
    expect((await agent.resource('bpmOutbox').discard({ filterByTk: 999 })).status).toBe(404);
  });

  it('can only be read through the API, apart from «send again» and «put aside»', async () => {
    await startWorkflow();
    engineAway = true;
    await request();
    const [queued] = await outbox();
    const agent = await root();
    const list = await agent.resource('bpmOutbox').list();
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    for (const res of [
      await agent.resource('bpmOutbox').create({ values: { kind: 'start', status: 'pending' } }),
      await agent.resource('bpmOutbox').update({ filterByTk: queued.id, values: { status: 'sent' } }),
      await agent.resource('bpmOutbox').destroy({ filterByTk: queued.id }),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res)).toBe('An outbox item can only be sent again or put aside');
    }
    expect((await outbox())[0].status).toBe('pending');

    await app.db.getRepository('roles').create({ values: { name: 'clerk', title: 'clerk' } });
    const user = await app.db.getRepository('users').create({ values: { nickname: 'clerk', roles: ['clerk'] } });
    const clerk = await app.agent().login(user, 'clerk');
    expect((await clerk.resource('bpmOutbox').list()).status).toBe(403);
    expect((await clerk.resource('bpmOutbox').resend({ filterByTk: queued.id })).status).toBe(403);
  });

  it('resolves a node of a synchronous workflow as queued, and sends the start later', async () => {
    await startWorkflow(true);
    engineAway = true;
    const record = await request();
    const [job] = await jobs();
    const [queued] = await outbox();
    expect(job.status).toBe(JOB_RESOLVED);
    expect(job.result).toMatchObject({ queued: true, outboxId: queued.id });
    expect(queued).toMatchObject({ status: 'pending', jobId: null });
    expect(await app.db.getRepository('purchase_requests').count()).toBe(1);

    engineAway = false;
    await due();
    await bpm.outbox.runOnce();
    expect((await outbox())[0].status).toBe('sent');
    expect(started).toEqual([
      {
        processKey: 'purchase_request',
        businessKey: `purchase_requests:${record.get('id')}`,
        variables: { title: 'لپ‌تاپ' },
      },
    ]);
  });

  it('sends a row once when two workers look at the same time', async () => {
    await startWorkflow();
    engineAway = true;
    await request();
    engineAway = false;
    const start = engine.start;
    engine.start = async (...args) => {
      await sleep(100);
      return start(...args);
    };
    await due();
    const tried = await Promise.all([bpm.outbox.runOnce(), bpm.outbox.runOnce()]);
    expect(tried.sort()).toEqual([0, 1]);
    expect(started).toHaveLength(1);
  });

  it('leaves a row alone until the workflow has saved the job that waits for it', async () => {
    const row = await bpm.outbox.enqueue(
      { kind: 'start', processKey: 'purchase_request', businessKey: 'purchase_requests:7', variables: {} },
      { status: 'pending', attempts: 1, lastError: 'away', jobId: '424242', correlationId: 'c-1' },
    );
    await due();
    expect(await bpm.outbox.runOnce()).toBe(1);
    expect(started).toEqual([]);
    const [waiting] = await outbox();
    expect(waiting.attempts).toBe(1);
    expect(new Date(waiting.nextAttemptAt).getTime()).toBeGreaterThan(Date.now());

    // A job still missing after the lease: its execution stopped there, and the start is sent all the same.
    bpm.outbox.options.leaseMs = 0;
    await due();
    await bpm.outbox.runOnce();
    expect(started).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ id: row.get('id'), status: 'sent' });
  });

  it('sends a message with its time to live and the same ID on every attempt', async () => {
    await messageWorkflow();
    engineAway = true;
    const record = await request();
    const [queued] = await outbox();
    expect(queued).toMatchObject({
      kind: 'message',
      status: 'pending',
      messageName: 'payment-received',
      businessKey: `purchase_requests:${record.get('id')}`,
      payload: { variables: { paid: true }, ttlMs: 60 * 60 * 1000, messageId: expect.stringMatching(/^nocobase-/) },
    });
    engineAway = false;
    await due();
    await bpm.outbox.runOnce();
    await sleep(500);
    expect(published).toEqual([
      {
        name: 'payment-received',
        businessKey: `purchase_requests:${record.get('id')}`,
        variables: { paid: true },
        ttlMs: 60 * 60 * 1000,
        messageId: queued.payload.messageId,
      },
    ]);
    const [job] = await jobs();
    expect(job.status).toBe(JOB_RESOLVED);
    expect(job.result).toMatchObject({ delivered: true, name: 'payment-received', outboxId: queued.id });
  });

  it('keeps a message no instance waits for yet, without holding up the other rows', async () => {
    await messageWorkflow();
    // Like Operaton: delivered only to an instance waiting now.
    let waiting = false;
    engine.publishMessage = async (name, businessKey, variables, { ttlMs, messageId }) => {
      published.push({ name, businessKey, variables, ttlMs, messageId });
      return { delivered: waiting };
    };
    await request('میز');
    await request('صندلی');
    const rows = await outbox();
    expect(rows.map((r) => [r.status, r.lastError])).toEqual([
      [
        'pending',
        expect.stringMatching(/^No instance waits for the message payment-received of purchase_requests:\d+ yet$/),
      ],
      ['pending', expect.stringMatching(/^No instance waits for the message payment-received/)],
    ]);
    await due();
    // Both are tried: a message that is not awaited yet does not mean the engine is away.
    expect(await bpm.outbox.runOnce()).toBe(2);
    waiting = true;
    await due();
    expect(await bpm.outbox.runOnce()).toBe(2);
    await sleep(500);
    expect((await outbox()).map((r) => r.status)).toEqual(['sent', 'sent']);
    expect((await jobs()).map((j) => j.status)).toEqual([JOB_RESOLVED, JOB_RESOLVED]);
  });

  it('fails the node when no instance took the message in its time to live', async () => {
    // 60 milliseconds.
    await messageWorkflow(0.001);
    engine.publishMessage = async () => ({ delivered: false });
    await request();
    await sleep(100);
    await due();
    await bpm.outbox.runOnce();
    await sleep(500);
    const [row] = await outbox();
    expect(row.status).toBe('failed');
    expect(row.lastError).toMatch(
      /^No instance waited for the message payment-received of purchase_requests:\d+ in time$/,
    );
    const [job] = await jobs();
    expect(job.status).toBe(JOB_FAILED);
    expect(job.result.error).toBe(row.lastError);
  });

  it('fails a message node without a message name, before calling the engine', async () => {
    await workflowWith('bpm-message', { businessKey: 'purchase_requests:{{$context.data.id}}' });
    await request();
    const [job] = await jobs();
    expect(job.status).toBe(JOB_FAILED);
    expect(job.result).toEqual({ error: 'Choose a message and a business key' });
    expect(published).toEqual([]);
    expect(await outbox()).toEqual([]);
  });

  it('removes old sent and put-aside rows every night and keeps the ones waiting', async () => {
    const item = { kind: 'start' as const, processKey: 'purchase_request', variables: {} };
    const rows = [];
    for (const [n, status] of ['pending', 'failed', 'pending', 'pending'].entries()) {
      rows.push(
        await bpm.outbox.enqueue(
          { ...item, businessKey: `purchase_requests:${n}` },
          { status: status as 'pending' | 'failed', attempts: 1, lastError: 'away', correlationId: `c-${n}` },
        ),
      );
    }
    await bpm.outbox.discard(rows[2].get('id'), null);
    await due();
    // Only the last pending row is due now; sending it leaves it sent.
    await app.db
      .getRepository('bpmOutbox')
      .update({ filterByTk: rows[0].get('id'), values: { nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) } });
    await bpm.outbox.runOnce();
    expect((await outbox()).map((r) => r.status)).toEqual(['pending', 'failed', 'discarded', 'sent']);

    await bpm.cleanup(new Date(Date.now() + 89 * 24 * 60 * 60 * 1000));
    expect(await outbox()).toHaveLength(4);
    await bpm.cleanup(new Date(Date.now() + 91 * 24 * 60 * 60 * 1000));
    expect((await outbox()).map((r) => r.status)).toEqual(['pending', 'failed']);
  });
});
