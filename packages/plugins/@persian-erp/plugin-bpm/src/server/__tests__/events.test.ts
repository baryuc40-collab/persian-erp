import { createMockServer, MockServer } from '@nocobase/test';
import { BpmEngine, BpmEngineError, FormField, ServiceTask, UserTask } from '../engine';
import PluginBpmServer from '../plugin';

// The connection log bpmEvents (STORY-093), with a stand-in engine: a row for each exchange that changes something
// and for each failure, with the NocoBase user and one correlation ID, and never the values of a form.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorOf = (res) => res.body.errors?.[0]?.message as string;

const userTask: UserTask = {
  id: 't1',
  name: 'تأیید مدیر',
  taskKey: 'approve',
  processKey: 'purchase_request',
  processName: 'درخواست خرید',
  processDefinitionId: 'purchase_request:1',
  processInstanceId: 'pi-1',
  businessKey: 'purchase_requests:1',
  assignee: null,
  candidateGroups: ['purchase_manager'],
  created: '2026-10-27T08:00:00.000Z',
};

const form: FormField[] = [
  { id: 'approved', label: 'تأیید', type: 'boolean', required: true, defaultValue: null, options: [] },
  { id: 'managerNote', label: 'یادداشت', type: 'string', required: false, defaultValue: null, options: [] },
];

const serviceTask: ServiceTask = {
  id: 'job-1',
  topic: 'place-order',
  processKey: 'purchase_request',
  processInstanceId: 'pi-1',
  businessKey: 'purchase_requests:1',
  variables: {},
  retries: null,
};

describe('bpm connection log', () => {
  let app: MockServer;
  let bpm: PluginBpmServer;
  let engine: Partial<BpmEngine>;
  let jobs: ServiceTask[];
  let logged: string[];

  const events = async (filter = {}) =>
    (await app.db.getRepository('bpmEvents').find({ filter, sort: ['id'] })).map((row) => row.toJSON());

  const login = async (roles: string[]) => {
    if (roles[0] === 'root') {
      const root = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
      return { agent: await app.agent().login(root, 'root'), id: root.get('id') };
    }
    for (const name of roles) {
      if (!(await app.db.getRepository('roles').findOne({ filterByTk: name }))) {
        await app.db.getRepository('roles').create({ values: { name, title: name } });
      }
    }
    const user = await app.db.getRepository('users').create({ values: { nickname: roles.join('-'), roles } });
    return { agent: await app.agent().login(user, roles[0]), id: user.get('id') };
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
        PluginBpmServer,
      ],
      acl: true,
    });
    app.db.collection({
      name: 'purchase_requests',
      createdBy: true,
      updatedBy: true,
      fields: [
        { type: 'string', name: 'title' },
        { type: 'string', name: 'status' },
      ],
    });
    await app.db.sync();
    await app.db.getRepository('purchase_requests').create({ values: { title: 'لپ‌تاپ' } });

    jobs = [];
    engine = {
      deploy: async (name) => ({
        id: 'd-1',
        processes: [{ id: 'p:1', key: 'purchase_request', name, version: 2, deploymentId: 'd-1' }],
      }),
      listUserTasks: async () => [userTask],
      getUserTask: async (id) => (id === userTask.id ? userTask : null),
      getTaskForm: async () => form,
      completeUserTask: async () => undefined,
      start: async () => ({ instanceId: 'pi-9', created: true }),
      fetchServiceTasks: async () => jobs.splice(0),
      completeServiceTask: async () => undefined,
      failServiceTask: async () => undefined,
    };
    bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    bpm.createEngine = () => engine as BpmEngine;
    await app.db
      .getRepository('bpmSettings')
      .create({ values: { id: 1, engine: 'camunda8', url: 'http://camunda:8080' } });

    logged = [];
    for (const level of ['info', 'warn'] as const) {
      const original = app.logger[level].bind(app.logger);
      app.logger[level] = ((message: string, ...rest: unknown[]) => {
        logged.push(String(message));
        return original(message, ...rest);
      }) as never;
    }
  });

  afterEach(async () => {
    delete process.env.BPM_WORKER;
    delete process.env.BPM_EVENTS_RETENTION_DAYS;
    await app.destroy();
  });

  it('logs a deploy with the user and the correlation ID the answer carries, also in the server log', async () => {
    const { agent, id } = await login(['root']);
    const res = await agent.resource('bpm').deploy({
      values: { name: 'purchase-request.bpmn', content: '<definitions></definitions>' },
    });
    expect(res.status).toBe(200);
    const correlationId = res.headers['x-correlation-id'];
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await events()).toEqual([
      expect.objectContaining({
        direction: 'out',
        event: 'deploy',
        engine: 'camunda8',
        processKey: 'purchase_request',
        userId: id,
        correlationId,
        status: 'ok',
        durationMs: expect.any(Number),
        detail: { file: 'purchase-request.bpmn', deploymentId: 'd-1', processes: ['purchase_request:2'] },
      }),
    ]);
    expect(logged).toContain(`bpm deploy ok [${correlationId}]`);
  });

  it('logs a completed task with its process and the names of the form fields, never their values', async () => {
    const { agent, id } = await login(['purchase_manager']);
    expect((await agent.resource('bpmTasks').list()).status).toBe(200);
    expect((await agent.resource('bpmTasks').get({ filterByTk: 't1' })).status).toBe(200);
    const res = await agent
      .resource('bpmTasks')
      .complete({ filterByTk: 't1', values: { approved: true, managerNote: 'محرمانه: تأمین‌کننده‌ی ب' } });
    expect(res.status).toBe(200);
    // Reads that went well are not logged; the completion is, once.
    const rows = await events();
    expect(rows).toEqual([
      expect.objectContaining({
        event: 'task.complete',
        processKey: 'purchase_request',
        businessKey: 'purchase_requests:1',
        instanceId: 'pi-1',
        taskId: 't1',
        userId: id,
        correlationId: res.headers['x-correlation-id'],
        status: 'ok',
        detail: { task: 'approve', fields: ['approved', 'managerNote'] },
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain('محرمانه');
    expect(logged.join('\n')).not.toContain('محرمانه');
  });

  it('logs a failed exchange with the status and translated message, and still answers with the error', async () => {
    engine.listUserTasks = async () => {
      throw new BpmEngineError('The user of the BPMN engine may not do this: {{message}}', { message: 'no READ' }, 403);
    };
    const { agent, id } = await login(['purchase_manager']);
    const res = await agent.resource('bpmTasks').list();
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('The user of the BPMN engine may not do this: no READ');
    const correlationId = res.headers['x-correlation-id'];
    expect(await events()).toEqual([
      expect.objectContaining({
        event: 'task.list',
        userId: id,
        correlationId,
        status: 'error',
        httpStatus: 403,
        error: 'The user of the BPMN engine may not do this: no READ',
      }),
    ]);
    expect(logged).toContain(
      `bpm task.list error [${correlationId}]: The user of the BPMN engine may not do this: no READ`,
    );
  });

  it('logs a start with the user who wrote the record, under the correlation ID of the execution', async () => {
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'collection', config: { mode: 1, collection: 'purchase_requests' } },
    });
    await app.db.getRepository('flow_nodes').create({
      values: {
        workflowId: workflow.get('id'),
        type: 'bpm-start',
        config: {
          processKey: 'purchase_request',
          businessKey: 'purchase_requests:{{$context.data.id}}',
          variables: [{ name: 'title', value: '{{$context.data.title}}' }],
        },
      },
    });
    const { agent, id } = await login(['root']);
    const created = await agent.resource('purchase_requests').create({ values: { title: 'میز محرمانه' } });
    const recordId = created.body.data.id;
    await sleep(500);
    const [job] = await app.db.getRepository('jobs').find({ sort: ['-id'], limit: 1 });
    const rows = await events({ event: 'start' });
    expect(rows).toEqual([
      expect.objectContaining({
        processKey: 'purchase_request',
        businessKey: `purchase_requests:${recordId}`,
        instanceId: 'pi-9',
        userId: id,
        correlationId: job.get('result').correlationId,
        status: 'ok',
        detail: { variables: ['title'], created: true },
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain('محرمانه');
  });

  it('logs a service task from receiving it to completing it under one correlation ID, also in the workflow', async () => {
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'bpm-service-task', config: { topic: 'place-order' } },
    });
    await app.db.getRepository('flow_nodes').create({
      values: {
        workflowId: workflow.get('id'),
        type: 'update',
        config: {
          collection: 'purchase_requests',
          params: { filter: { id: '{{$context.recordId}}' }, values: { status: 'ordered' } },
        },
      },
    });
    jobs.push(serviceTask);
    await bpm.worker.runOnce();
    const rows = await events();
    expect(rows.map((row) => [row.direction, row.event, row.status])).toEqual([
      ['in', 'serviceTask.received', 'ok'],
      ['out', 'serviceTask.complete', 'ok'],
    ]);
    expect(rows[0]).toMatchObject({
      taskId: 'job-1',
      instanceId: 'pi-1',
      userId: null,
      detail: { topic: 'place-order' },
    });
    expect(rows[1].correlationId).toBe(rows[0].correlationId);
    const [execution] = await app.db.getRepository('executions').find();
    expect(execution.get('context').task.correlationId).toBe(rows[0].correlationId);
  });

  it('logs a failed service task with the retries and the message the engine shows', async () => {
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'bpm-service-task', config: { topic: 'place-order' }, title: 'ثبت سفارش' },
    });
    await app.db.getRepository('flow_nodes').create({
      values: { workflowId: workflow.get('id'), type: 'query', config: { collection: 'missing_things' } },
    });
    jobs.push(serviceTask);
    await bpm.worker.runOnce();
    const [, fail] = await events();
    expect(fail).toMatchObject({
      event: 'serviceTask.fail',
      status: 'ok',
      detail: {
        retries: 3,
        message: expect.stringMatching(/^The workflow "ثبت سفارش" did not succeed \(execution \d+\)\.$/),
      },
    });
  });

  it('keeps the exchange working when the log cannot be written', async () => {
    const repository = app.db.getRepository('bpmEvents');
    repository.create = (async () => {
      throw new Error('disk full');
    }) as never;
    const { agent } = await login(['root']);
    const res = await agent.resource('bpm').deploy({
      values: { name: 'purchase-request.bpmn', content: '<definitions></definitions>' },
    });
    expect(res.status).toBe(200);
    expect(logged.some((line) => line.includes('was not saved: disk full'))).toBe(true);
  });

  it('can be read with the process management snippet and never changed through the API', async () => {
    await bpm.events.note('deploy', {});
    const { agent: root } = await login(['root']);
    expect((await root.resource('bpmEvents').list()).body.data).toHaveLength(1);
    expect((await root.resource('bpmEvents').create({ values: { event: 'fake' } })).status).toBe(403);
    expect((await root.resource('bpmEvents').destroy({ filter: { event: 'deploy' } })).status).toBe(403);
    expect(
      (await root.resource('bpmEvents').update({ filter: { event: 'deploy' }, values: { event: 'x' } })).status,
    ).toBe(403);

    const { agent: member } = await login(['member']);
    expect((await member.resource('bpmEvents').list()).status).toBe(403);
    await app.db.getRepository('roles').update({ filterByTk: 'member', values: { snippets: ['pm.bpm'] } });
    expect((await member.resource('bpmEvents').list()).status).toBe(200);
    expect(await app.db.getRepository('bpmEvents').count()).toBe(1);
  });

  it('removes rows older than the retention, 90 days unless set', async () => {
    await bpm.events.note('deploy', {});
    await bpm.events.note('start', {});
    const [old] = await events({ event: 'deploy' });
    const now = new Date();
    await app.db
      .getModel('bpmEvents')
      .update({ createdAt: new Date(now.getTime() - 91 * 24 * 3600 * 1000) }, { where: { id: old.id }, silent: true });
    expect(await bpm.events.cleanup(now)).toBe(1);
    expect((await events()).map((row) => row.event)).toEqual(['start']);

    process.env.BPM_EVENTS_RETENTION_DAYS = '1';
    expect(await bpm.events.cleanup(new Date(now.getTime() + 2 * 24 * 3600 * 1000))).toBe(1);
    expect(await events()).toEqual([]);
  });
});
