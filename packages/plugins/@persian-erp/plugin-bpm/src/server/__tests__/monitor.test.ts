import { createMockServer, MockServer } from '@nocobase/test';
import fs from 'fs';
import path from 'path';
import { Camunda8Engine } from '../camunda8';
import { BpmEngine, BpmEngineError, EngineIncident } from '../engine';
import { ALERT_CHANNEL } from '../monitor';
import PluginBpmServer from '../plugin';

// The monitoring, the failure list and the alerts (STORY-099), with a stand-in engine; at the end the failure list and
// «try again» against a real Camunda 8 when CAMUNDA_URL is given (see engines.test.ts, which also covers Operaton).

const MINUTE = 60 * 1000;
const errorOf = (res) => res.body.errors?.[0]?.message as string;

const incidentOf = (id: string, more: Partial<EngineIncident> = {}): EngineIncident => ({
  id,
  processKey: 'purchase_request',
  instanceId: `pi-${id}`,
  elementId: 'order',
  elementName: 'ثبت سفارش',
  jobId: `job-${id}`,
  type: 'JOB_NO_RETRIES',
  message: 'خطای آخر',
  createdAt: '2026-10-27T08:00:00.000Z',
  ...more,
});

describe('bpm monitoring and alerts', () => {
  let app: MockServer;
  let bpm: PluginBpmServer;
  let down: boolean;
  let health: string | null;
  let incidents: EngineIncident[] | Error;
  let retried: { incident: EngineIncident; retries: number }[];
  let admin;
  let member;

  const rows = async (collection: string, filter = {}, sort = ['id']) =>
    (await app.db.getRepository(collection).find({ filter, sort })).map((row) => row.toJSON());
  const events = (event: string) => rows('bpmEvents', { event });
  const alerts = (filter = {}) => rows('bpmAlerts', filter);
  const inbox = (userId) =>
    rows('notificationInAppMessages', { userId, channelName: ALERT_CHANNEL }, ['receiveTimestamp']);
  const rule = (kind: string, values: Record<string, unknown>) =>
    app.db.getRepository('bpmAlertRules').update({ filter: { kind }, values });
  const root = async () => {
    const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
    return app.agent().login(user, 'root');
  };

  beforeEach(async () => {
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
        'notification-manager',
        'notification-in-app-message',
        PluginBpmServer,
      ],
      acl: true,
    });
    bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    await bpm.monitor.ensureRules();
    await bpm.monitor.ensureChannel();

    down = false;
    health = 'UP';
    incidents = [];
    retried = [];
    const engine: Partial<BpmEngine> = {
      version: async () => {
        if (down) throw new BpmEngineError('The BPMN engine cannot be reached: {{reason}}', { reason: 'refused' });
        return '8.10.7';
      },
      health: async () => health,
      listIncidents: async () => {
        if (incidents instanceof Error) throw incidents;
        return incidents;
      },
      getIncident: async (id) => (incidents instanceof Error ? null : incidents.find((i) => i.id === id) ?? null),
      retryIncident: async (incident, retries) => {
        retried.push({ incident, retries });
      },
    };
    bpm.createEngine = () => engine as BpmEngine;
    await app.db
      .getRepository('bpmSettings')
      .create({ values: { id: 1, engine: 'camunda8', url: 'http://camunda:8080' } });
    admin = await app.db.getRepository('users').create({ values: { nickname: 'مدیر فنی', roles: ['admin'] } });
    member = await app.db.getRepository('users').create({ values: { nickname: 'کارمند', roles: ['member'] } });
  });

  afterEach(async () => {
    delete process.env.BPM_WORKER;
    delete process.env.BPM_METRICS_KEY;
    delete process.env.BPM_ENGINE_DATABASE;
    await app.destroy();
  });

  it('makes one rule for each kind and the in-app channel of the alerts', async () => {
    // Again on the next start, as in a cluster: nothing twice.
    await bpm.monitor.ensureRules();
    await bpm.monitor.ensureChannel();
    expect(await rows('bpmAlertRules')).toEqual([
      expect.objectContaining({ kind: 'engineDown', enabled: true, minutes: 2, roleNames: ['admin'] }),
      expect.objectContaining({ kind: 'worker', minutes: 5 }),
      expect.objectContaining({ kind: 'outbox', minutes: 10, count: 10 }),
      expect.objectContaining({ kind: 'incident', channels: [ALERT_CHANNEL] }),
      expect.objectContaining({ kind: 'overdue' }),
    ]);
    expect(await rows('notificationChannels', { name: ALERT_CHANNEL }, ['name'])).toEqual([
      expect.objectContaining({ notificationType: 'in-app-message' }),
    ]);
  });

  it('alerts the role of the rule when the engine has not answered for its minutes, and when it is back', async () => {
    const start = Date.now();
    down = true;
    await bpm.monitor.runOnce(new Date(start));
    // Down, but not for two minutes yet: logged once, no alert.
    expect(await events('engine.down')).toEqual([
      expect.objectContaining({ status: 'error', error: 'The BPMN engine cannot be reached: refused' }),
    ]);
    expect(await alerts()).toEqual([]);

    await bpm.monitor.runOnce(new Date(start + 3 * MINUTE));
    await bpm.monitor.runOnce(new Date(start + 4 * MINUTE));
    expect(await events('engine.down')).toHaveLength(1);
    expect(await alerts()).toEqual([
      expect.objectContaining({
        kind: 'engineDown',
        key: 'engineDown',
        status: 'open',
        title: 'The BPMN engine has not answered for 2 minutes',
        notifiedAt: expect.any(Date),
      }),
    ]);
    expect(await inbox(admin.get('id'))).toEqual([
      expect.objectContaining({ title: 'The BPMN engine has not answered for 2 minutes' }),
    ]);
    expect(await inbox(member.get('id'))).toEqual([]);
    expect(await events('alert.sent')).toEqual([
      expect.objectContaining({ detail: expect.objectContaining({ kind: 'engineDown', channel: ALERT_CHANNEL }) }),
    ]);

    down = false;
    await bpm.monitor.runOnce(new Date(start + 5 * MINUTE));
    expect(await alerts()).toEqual([expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) })]);
    expect(await events('engine.up')).toEqual([
      expect.objectContaining({ detail: expect.objectContaining({ version: '8.10.7', downMs: expect.any(Number) }) }),
    ]);
    expect((await inbox(admin.get('id'))).map((m) => m.title)).toEqual([
      'The BPMN engine has not answered for 2 minutes',
      'Resolved: The BPMN engine has not answered for 2 minutes',
    ]);
    expect(await events('alert.resolved')).toHaveLength(1);
  });

  it('counts an engine whose health check is not UP as down', async () => {
    health = 'DOWN';
    const status = await bpm.monitor.checkEngine();
    expect(status).toMatchObject({ up: false, version: '8.10.7', health: 'DOWN' });
    expect(await events('engine.down')).toEqual([
      expect.objectContaining({ error: 'The health check of the engine says DOWN' }),
    ]);
  });

  it('lists the failures of both builders, and tries an incident again', async () => {
    incidents = [incidentOf('11')];
    await app.db.getRepository('bpmInstances').create({
      values: { builder: 'camunda', instanceId: 'pi-11', processKey: 'purchase_request', businessKey: 'pr:7' },
    });
    await app.db.getRepository('bpmProcesses').create({
      values: { builder: 'camunda', key: 'purchase_request', title: 'درخواست خرید' },
    });
    for (let i = 0; i < 2; i++) {
      await app.db.getRepository('bpmEvents').create({
        values: { event: 'serviceTask.fail', taskId: 'job-11', status: 'ok', correlationId: `c-${i}` },
      });
    }
    const workflow = await app.db.getRepository('workflows').create({
      values: { title: 'ارسال صورتحساب', key: 'invoice', enabled: false, type: 'collection', config: {} },
    });
    const node = await app.db
      .getRepository('flow_nodes')
      .create({ values: { workflowId: workflow.get('id'), type: 'request', title: 'فراخوانی سامانه', key: 'n1' } });
    const execution = await app.db
      .getRepository('executions')
      .create({ values: { workflowId: workflow.get('id'), key: 'invoice', status: -2, eventKey: 'e1' } });
    await app.db.getRepository('jobs').create({
      values: {
        id: 900001,
        executionId: execution.get('id'),
        nodeId: node.get('id'),
        nodeKey: 'n1',
        status: -2,
        result: { message: 'connect ECONNREFUSED' },
      },
    });
    // A failure older than the window (7 days) is not on the list.
    const old = await app.db
      .getRepository('executions')
      .create({ values: { workflowId: workflow.get('id'), key: 'invoice', status: -1, eventKey: 'e2' } });
    await app.db
      .getModel('executions')
      .update(
        { createdAt: new Date(Date.now() - 8 * 24 * 60 * MINUTE) },
        { where: { id: old.get('id') }, silent: true },
      );
    await app.db.getRepository('bpmOutbox').create({
      values: { kind: 'start', status: 'failed', processKey: 'purchase_request', businessKey: 'pr:8', attempts: 10 },
    });

    const agent = await root();
    const res = await agent.resource('bpm').failures();
    expect(res.status).toBe(200);
    expect(res.body.data.engineError).toBeNull();
    const items = res.body.data.items;
    expect(items).toHaveLength(3);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'incident',
          id: '11',
          processTitle: 'درخواست خرید',
          instanceId: 'pi-11',
          businessKey: 'pr:7',
          step: 'ثبت سفارش',
          message: 'خطای آخر',
          attempts: 2,
        }),
        expect.objectContaining({
          kind: 'execution',
          id: String(execution.get('id')),
          processTitle: 'ارسال صورتحساب',
          step: 'فراخوانی سامانه',
          message: 'connect ECONNREFUSED',
          link: `/admin/workflow/executions/${execution.get('id')}`,
        }),
        expect.objectContaining({ kind: 'outbox', businessKey: 'pr:8', attempts: 10 }),
      ]),
    );

    // The engine down: its incidents are left out and the reason is given; the rest still shows.
    incidents = new BpmEngineError('The BPMN engine cannot be reached: {{reason}}', { reason: 'refused' });
    const without = await agent.resource('bpm').failures();
    expect(without.body.data.engineError).toBe('The BPMN engine cannot be reached: refused');
    expect(without.body.data.items.map((i) => i.kind).sort()).toEqual(['execution', 'outbox']);
    incidents = [incidentOf('11')];

    // «Try again»: one more try by default, logged with the incident's process, instance and job.
    const retry = await agent.resource('bpm').retryIncident({ values: { id: '11' } });
    expect(retry.status).toBe(200);
    expect(retried).toEqual([{ incident: expect.objectContaining({ id: '11' }), retries: 1 }]);
    expect(await events('incident.retry')).toEqual([
      expect.objectContaining({
        status: 'ok',
        processKey: 'purchase_request',
        instanceId: 'pi-11',
        taskId: 'job-11',
        detail: expect.objectContaining({ incidentId: '11', retries: 1, element: 'order' }),
      }),
    ]);
    expect((await agent.resource('bpm').retryIncident({ values: { id: '11', retries: 3 } })).status).toBe(200);
    expect(retried[1].retries).toBe(3);
    const tooMany = await agent.resource('bpm').retryIncident({ values: { id: '11', retries: 11 } });
    expect(tooMany.status).toBe(400);
    expect(errorOf(tooMany)).toBe('The tries must be a whole number from 1 to 10');
    const unknown = await agent.resource('bpm').retryIncident({ values: { id: '99' } });
    expect(unknown.status).toBe(400);
    expect(errorOf(unknown)).toBe('There is no open incident 99');
    expect(await events('incident.retry')).toHaveLength(3);

    // Only with the permission of the process engine (pm.bpm).
    const memberAgent = await app.agent().login(member);
    expect((await memberAgent.resource('bpm').failures()).status).toBe(403);
    expect((await memberAgent.resource('bpm').retryIncident({ values: { id: '11' } })).status).toBe(403);
  });

  it('sends one notification for the new incidents of a round and keeps them while the engine cannot be read', async () => {
    incidents = [incidentOf('1'), incidentOf('2', { elementName: 'ثبت رد', message: 'خطای دوم' })];
    await bpm.monitor.runOnce();
    expect((await alerts({ kind: 'incident' })).map((a) => [a.key, a.status])).toEqual([
      ['incident:camunda:1', 'open'],
      ['incident:camunda:2', 'open'],
    ]);
    const [message] = await inbox(admin.get('id'));
    expect(message.title).toBe('2 new process alerts');
    expect(message.content).toBe(
      '- purchase_request stopped at ثبت سفارش: خطای آخر\n- purchase_request stopped at ثبت رد: خطای دوم',
    );

    // Nothing new: no second notification.
    await bpm.monitor.runOnce();
    expect(await inbox(admin.get('id'))).toHaveLength(1);

    // The engine cannot be read: the alerts stay open.
    incidents = new Error('timeout');
    await bpm.monitor.runOnce();
    expect((await alerts({ status: 'open' })).map((a) => a.key)).toEqual(['incident:camunda:1', 'incident:camunda:2']);

    // One is resolved: its alert closes without a notification.
    incidents = [incidentOf('1')];
    await bpm.monitor.runOnce();
    expect((await alerts({ status: 'open' })).map((a) => a.key)).toEqual(['incident:camunda:1']);
    expect(await inbox(admin.get('id'))).toHaveLength(1);
  });

  it('alerts on a full or old outbox and on overdue tasks, and not for a rule that is off', async () => {
    const now = new Date();
    await app.db.getRepository('bpmOutbox').create({
      values: { kind: 'start', status: 'pending', businessKey: 'pr:1', nextAttemptAt: now },
    });
    await app.db
      .getModel('bpmOutbox')
      .update({ createdAt: new Date(now.getTime() - 15 * MINUTE) }, { where: {}, silent: true });
    await app.db.getRepository('bpmInstances').create({
      values: {
        builder: 'nocobase',
        instanceId: '501',
        processKey: 'leave',
        status: 'active',
        currentStep: 'تأیید مدیر',
        dueAt: new Date(now.getTime() - MINUTE),
      },
    });
    await rule('overdue', { enabled: false });
    await bpm.monitor.runOnce(now);
    expect(await alerts()).toEqual([
      expect.objectContaining({
        kind: 'outbox',
        title: '1 items wait in the outbox; the oldest has waited 15 minutes',
        detail: expect.objectContaining({ pending: 1 }),
      }),
    ]);

    await rule('overdue', { enabled: true });
    await bpm.monitor.runOnce(now);
    expect((await alerts({ kind: 'overdue' })).map((a) => [a.key, a.title])).toEqual([
      ['overdue:nocobase:501', 'leave is overdue at تأیید مدیر'],
    ]);

    // Sent: the outbox alert closes and says so.
    await app.db.getRepository('bpmOutbox').update({ filter: { status: 'pending' }, values: { status: 'sent' } });
    await bpm.monitor.runOnce(now);
    expect(await alerts({ kind: 'outbox' })).toEqual([expect.objectContaining({ status: 'resolved' })]);
    expect((await inbox(admin.get('id'))).map((m) => m.title)).toContain(
      'Resolved: 1 items wait in the outbox; the oldest has waited 15 minutes',
    );
  });

  it("alerts when this instance's worker has not fetched for the rule's minutes", async () => {
    const worker = (bpm.worker as unknown) as { running: boolean; topics: number; lastFetchAt: Date | null };
    worker.running = true;
    worker.topics = 1;
    worker.lastFetchAt = new Date(Date.now() - 6 * MINUTE);
    await bpm.monitor.runOnce();
    expect(await alerts({ kind: 'worker' })).toEqual([
      expect.objectContaining({ key: `worker:${bpm.worker.workerId}`, status: 'open' }),
    ]);
    worker.lastFetchAt = new Date();
    await bpm.monitor.runOnce();
    expect(await alerts({ kind: 'worker' })).toEqual([expect.objectContaining({ status: 'resolved' })]);
    worker.running = false;
  });

  it('notes a failed notification in the log', async () => {
    await rule('incident', { channels: ['no-such-channel'] });
    incidents = [incidentOf('5')];
    await bpm.monitor.runOnce();
    expect(await events('alert.failed')).toEqual([
      expect.objectContaining({
        status: 'error',
        error: 'There is no notification channel no-such-channel',
        detail: expect.objectContaining({ kind: 'incident', channel: 'no-such-channel' }),
      }),
    ]);
    expect(await alerts()).toEqual([expect.objectContaining({ status: 'open', notifiedAt: null })]);
  });

  it('shows the state for the monitoring page', async () => {
    process.env.BPM_ENGINE_DATABASE = app.db.options.database as string;
    await app.db.getRepository('bpmProcesses').create({ values: { builder: 'nocobase', key: 'none', title: 'x' } });
    await bpm.registry.reconcile();
    const res = await (await root()).resource('bpm').monitor();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      engine: { configured: true, up: true, version: '8.10.7', health: 'UP', engine: 'camunda8' },
      worker: { running: false, enabled: false, topics: 0 },
      outbox: { pending: 0, failed: 0, oldestPendingAt: null },
      reconcile: { status: 'ok', read: 0, missing: 0 },
      instances: { open: 0, incident: 0, failed: 0, overdue: 0 },
      alerts: [],
    });
    if (app.db.sequelize.getDialect() === 'postgres') {
      expect(res.body.data.database.bytes).toBeGreaterThan(0);
    }
  });

  it('changes a rule only within its limits, and keeps the alerts read-only', async () => {
    const agent = await root();
    const [engineDown] = await rows('bpmAlertRules', { kind: 'engineDown' });
    const ok = await agent
      .resource('bpmAlertRules')
      .update({ filterByTk: engineDown.id, values: { kind: 'other', minutes: 5, roleNames: [' admin ', 'ops'] } });
    expect(ok.status).toBe(200);
    expect((await rows('bpmAlertRules', { id: engineDown.id }))[0]).toMatchObject({
      kind: 'engineDown',
      minutes: 5,
      roleNames: ['admin', 'ops'],
    });
    const bad = await agent.resource('bpmAlertRules').update({ filterByTk: engineDown.id, values: { minutes: -1 } });
    expect(bad.status).toBe(400);
    expect(errorOf(bad)).toBe('The limits of a rule must be whole numbers, 0 or more');
    const names = await agent
      .resource('bpmAlertRules')
      .update({ filterByTk: engineDown.id, values: { channels: 'x' } });
    expect(errorOf(names)).toBe('The roles and channels of a rule must be lists of names');
    expect((await agent.resource('bpmAlertRules').create({ values: { kind: 'x' } })).status).toBe(403);
    expect((await agent.resource('bpmAlertRules').destroy({ filterByTk: engineDown.id })).status).toBe(403);
    expect((await agent.resource('bpmAlerts').create({ values: { kind: 'x' } })).status).toBe(403);
    expect((await agent.resource('bpmAlerts').list()).status).toBe(200);
  });

  it('serves the metrics with the key only, and not at all without one', async () => {
    const metrics = (headers: Record<string, string> = {}, query = '') => {
      const prefix = (app.resourcer.options as { prefix?: string }).prefix || '';
      const request = app.agent().get(`${prefix}/bpm:metrics${query}`);
      for (const [name, value] of Object.entries(headers)) request.set(name, value);
      return request;
    };
    expect((await metrics()).status).toBe(404);

    process.env.BPM_METRICS_KEY = 'secret-metrics-key';
    expect((await metrics()).status).toBe(401);
    expect((await metrics({ Authorization: 'Bearer wrong' })).status).toBe(401);
    await app.db.getRepository('bpmOutbox').create({ values: { kind: 'start', status: 'pending', businessKey: 'p' } });
    await app.db
      .getRepository('bpmInstances')
      .create({ values: { builder: 'camunda', instanceId: 'pi-1', processKey: 'k', status: 'active' } });
    const res = await metrics({ Authorization: 'Bearer secret-metrics-key' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('# TYPE nocobase_bpm_engine_up gauge');
    expect(res.text).toContain('nocobase_bpm_engine_up{engine="camunda8"} 1');
    expect(res.text).toContain('nocobase_bpm_outbox_items{status="pending"} 1');
    expect(res.text).toContain('nocobase_bpm_instances{builder="camunda",status="active"} 1');
    expect(res.text).toContain('nocobase_bpm_alerts_open{kind="engineDown"} 0');
    expect((await metrics({}, '?key=secret-metrics-key')).status).toBe(200);
  });
});

const CAMUNDA = {
  url: process.env.CAMUNDA_URL,
  username: process.env.CAMUNDA_USER || 'nocobase',
  password: process.env.CAMUNDA_PASSWORD || 'secret',
};

describe.skipIf(!CAMUNDA.url)('bpm failures and «try again» with Camunda 8', () => {
  let app: MockServer;
  const engine = new Camunda8Engine(CAMUNDA);
  const businessKey = `purchase_requests:monitor-${Date.now().toString(36)}`;

  // Searches of Camunda 8 follow the commands by a moment.
  const eventually = async <T>(check: () => Promise<T>) => {
    const until = Date.now() + 30000;
    for (;;) {
      try {
        return await check();
      } catch (error) {
        if (Date.now() > until) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  beforeAll(async () => {
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
    await app.db.getRepository('bpmSettings').create({ values: { id: 1, engine: 'camunda8', ...CAMUNDA } });
    const bpmn = path.resolve(__dirname, '../../../../../../../bpmn');
    for (const file of ['purchase-request.bpmn', 'purchase-approve.form']) {
      await engine.deploy('purchase-request', [
        { name: file, content: fs.readFileSync(path.join(bpmn, file), 'utf8') },
      ]);
    }
  }, 60000);

  afterAll(async () => {
    delete process.env.BPM_WORKER;
    await app.destroy();
  });

  it('lists a service task that ran out of retries, and runs it again', async () => {
    const { instanceId } = await engine.start('purchase_request', businessKey, { recordId: 1 });
    const task = await eventually(async () => {
      const [found] = await engine.listUserTasks({ businessKey });
      expect(found).toBeTruthy();
      return found;
    });
    await engine.completeUserTask(task.id, { approved: true });
    const topics = [{ name: 'place-order', lockMs: 60000 }];
    const mine = async () =>
      (await engine.fetchServiceTasks('monitor-test', topics, 10)).filter((t) => t.businessKey === businessKey);
    const order = await eventually(async () => {
      const [found] = await mine();
      expect(found).toBeTruthy();
      return found;
    });
    await engine.failServiceTask('monitor-test', order.id, {
      message: 'سامانه‌ی سفارش پاسخ نداد',
      retries: 0,
      retryMs: 0,
    });

    const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
    const agent = await app.agent().login(user, 'root');
    const failure = await eventually(async () => {
      const res = await agent.resource('bpm').failures();
      const found = res.body.data.items.find((item) => item.instanceId === instanceId);
      expect(found).toBeTruthy();
      return found;
    });
    expect(failure).toMatchObject({
      kind: 'incident',
      builder: 'camunda',
      processKey: 'purchase_request',
      step: 'ثبت سفارش',
      message: 'سامانه‌ی سفارش پاسخ نداد',
      jobId: order.id,
    });

    const retry = await agent.resource('bpm').retryIncident({ values: { id: failure.id } });
    expect(retry.status).toBe(200);
    const again = await eventually(async () => {
      const [found] = await mine();
      expect(found).toBeTruthy();
      return found;
    });
    expect(again.id).toBe(order.id);
    await engine.completeServiceTask('monitor-test', again.id);
    await eventually(async () => {
      const res = await agent.resource('bpm').failures();
      expect(res.body.data.items.map((item) => item.id)).not.toContain(failure.id);
    });
    const [logged] = (
      await app.db.getRepository('bpmEvents').find({ filter: { event: 'incident.retry' } })
    ).map((row) => row.toJSON());
    expect(logged).toMatchObject({ status: 'ok', instanceId, taskId: order.id, engine: 'camunda8' });
  }, 120000);
});
