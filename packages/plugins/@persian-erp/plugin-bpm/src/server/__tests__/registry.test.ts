import { createMockServer, MockServer } from '@nocobase/test';
import { BpmEngine, InstanceState } from '../engine';
import PluginBpmServer from '../plugin';

// The process list and the instance table (STORY-095), with NocoBase workflows and a stand-in engine.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorOf = (res) => res.body.errors?.[0]?.message as string;
const JOB_RESOLVED = 1;

const engineState = (instanceId: string, more: Partial<InstanceState> = {}): InstanceState => ({
  instanceId,
  processKey: 'purchase_request',
  version: 2,
  businessKey: 'purchase_requests:1',
  status: 'active',
  startedAt: '2026-10-27T08:00:00.000Z',
  endedAt: null,
  steps: [{ id: 'approve', name: 'تأیید مدیر' }],
  tasks: [
    {
      id: 't-1',
      name: 'تأیید مدیر',
      assignee: null,
      candidateGroups: ['purchase_manager'],
      dueAt: '2026-10-30T08:00:00.000Z',
    },
  ],
  ...more,
});

describe('bpm process registry', () => {
  let app: MockServer;
  let bpm: PluginBpmServer;
  let states: Map<string, InstanceState>;
  let changed: string[];
  let looks: Date[];
  let user;
  let manager;

  const instances = async (filter = {}) =>
    (await app.db.getRepository('bpmInstances').find({ filter, sort: ['id'] })).map((row) => row.toJSON());
  const events = async (event: string) =>
    (await app.db.getRepository('bpmEvents').find({ filter: { event }, sort: ['id'] })).map((row) => row.toJSON());
  const root = async () => {
    const admin = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
    return app.agent().login(admin, 'root');
  };
  const mark = (builder: string, key: string, values = {}) =>
    app.db.getRepository('bpmProcesses').create({ values: { builder, key, title: key, ...values } });
  const settle = async () => {
    await sleep(300);
    await bpm.registry.idle();
  };
  const request = async (title: string, creator = user) => {
    const record = await app.db
      .getRepository('purchase_requests')
      .create({ values: { title }, context: { state: { currentUser: creator } } });
    await sleep(500);
    await bpm.registry.idle();
    return record;
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
        'workflow-manual',
        PluginBpmServer,
      ],
      acl: true,
    });
    app.db.collection({
      name: 'purchase_requests',
      createdBy: true,
      fields: [{ type: 'string', name: 'title' }],
    });
    await app.db.sync();
    bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;

    states = new Map();
    changed = [];
    looks = [];
    let started = 0;
    const engine: Partial<BpmEngine> = {
      start: async (processKey, businessKey) => {
        const id = `pi-${++started}`;
        states.set(id, engineState(id, { processKey, businessKey }));
        return { instanceId: id, created: true };
      },
      getInstance: async (id) => states.get(id) ?? null,
      changedInstances: async (keys, since) => {
        looks.push(since);
        return changed.splice(0);
      },
      activeInstances: async (keys) =>
        [...states.values()]
          .filter((s) => keys.includes(s.processKey) && s.status === 'active')
          .map((s) => s.instanceId),
    };
    bpm.createEngine = () => engine as BpmEngine;
    await app.db
      .getRepository('bpmSettings')
      .create({ values: { id: 1, engine: 'camunda8', url: 'http://camunda:8080' } });

    user = await app.db.getRepository('users').create({ values: { nickname: 'درخواست‌دهنده', roles: ['member'] } });
    manager = await app.db.getRepository('users').create({ values: { nickname: 'مدیر', roles: ['member'] } });
  });

  afterEach(async () => {
    delete process.env.BPM_WORKER;
    await app.destroy();
  });

  const manualWorkflow = async (title = 'درخواست خرید') => {
    const workflow = await app.db.getRepository('workflows').create({
      values: { title, enabled: true, type: 'collection', config: { mode: 1, collection: 'purchase_requests' } },
    });
    await app.db.getRepository('flow_nodes').create({
      values: {
        workflowId: workflow.get('id'),
        type: 'manual',
        title: 'تأیید مدیر',
        config: { assignees: [manager.get('id')], forms: {}, mode: 0 },
      },
    });
    return workflow;
  };

  it('checks a process before it is listed, and names it after its workflow', async () => {
    const workflow = await manualWorkflow();
    const agent = await root();
    const cases: [Record<string, unknown>, string][] = [
      [{ builder: 'excel', key: 'x' }, 'Choose NocoBase or BPMN as the builder'],
      [{ builder: 'nocobase', key: ' ' }, 'Choose the workflow or the BPMN process'],
      [{ builder: 'nocobase', key: 'nothing' }, 'There is no workflow with the key nothing'],
    ];
    for (const [values, message] of cases) {
      const res = await agent.resource('bpmProcesses').create({ values });
      expect(res.status).toBe(400);
      expect(errorOf(res)).toBe(message);
    }
    const res = await agent
      .resource('bpmProcesses')
      .create({ values: { builder: 'nocobase', key: workflow.get('key') } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ builder: 'nocobase', title: 'درخواست خرید', enabled: true });
    const twin = await agent
      .resource('bpmProcesses')
      .create({ values: { builder: 'nocobase', key: workflow.get('key') } });
    expect(errorOf(twin)).toBe('This process is in the list already');
    const camunda = await agent
      .resource('bpmProcesses')
      .create({ values: { builder: 'camunda', key: 'purchase_request' } });
    expect(camunda.body.data).toMatchObject({ builder: 'camunda', key: 'purchase_request', title: 'purchase_request' });
  });

  it('keeps the row of a NocoBase workflow up to date while it runs', async () => {
    const workflow = await manualWorkflow();
    // Not a process: its executions stay out of the table.
    await manualWorkflow('یادداشت');
    const process = await mark('nocobase', workflow.get('key'));
    const record = await request('لپ‌تاپ');
    const [row] = await instances();
    expect(await instances()).toHaveLength(1);
    const [execution] = await app.db.getRepository('executions').find({ filter: { workflowId: workflow.get('id') } });
    expect(row).toMatchObject({
      builder: 'nocobase',
      processId: process.get('id'),
      processKey: workflow.get('key'),
      version: 1,
      instanceId: String(execution.get('id')),
      businessKey: `purchase_requests:${record.get('id')}`,
      recordCollection: 'purchase_requests',
      recordId: String(record.get('id')),
      requesterId: user.get('id'),
      status: 'active',
      currentStep: 'تأیید مدیر',
      assigneeId: manager.get('id'),
      endedAt: null,
    });
    expect(row.startedAt).toBeInstanceOf(Date);

    // The manager approves: the task and its job are done and the execution goes on to its end.
    const [task] = await app.db.getRepository('workflowManualTasks').find();
    await task.update({ status: JOB_RESOLVED });
    const job = await app.db.getRepository('jobs').findOne({ filterByTk: task.get('jobId') });
    job.set({ status: JOB_RESOLVED, result: {} });
    await ((app.pm.get('workflow') as unknown) as { resume(job: unknown): Promise<void> }).resume(job);
    await settle();
    expect((await instances())[0]).toMatchObject({
      status: 'completed',
      currentStep: null,
      currentStepId: null,
      assigneeId: null,
      endedAt: expect.any(Date),
    });
  });

  it('follows the end of an execution that is canceled', async () => {
    const workflow = await manualWorkflow();
    await mark('nocobase', workflow.get('key'));
    await request('میز');
    const [execution] = await app.db.getRepository('executions').find();
    await execution.update({ status: -4 });
    await settle();
    expect((await instances())[0]).toMatchObject({ status: 'canceled', endedAt: expect.any(Date) });
  });

  it('notes an engine instance the plugin starts, with its requester, and follows the engine', async () => {
    await mark('camunda', 'purchase_request');
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'collection', config: { mode: 1, collection: 'purchase_requests' } },
    });
    await app.db.getRepository('flow_nodes').create({
      values: {
        workflowId: workflow.get('id'),
        type: 'bpm-start',
        config: { processKey: 'purchase_request', businessKey: 'purchase_requests:{{$context.data.id}}' },
      },
    });
    const record = await request('لپ‌تاپ');
    const businessKey = `purchase_requests:${record.get('id')}`;
    expect(await instances()).toEqual([
      expect.objectContaining({
        builder: 'camunda',
        instanceId: 'pi-1',
        processKey: 'purchase_request',
        businessKey,
        requesterId: user.get('id'),
        status: 'active',
        currentStep: null,
      }),
    ]);

    // The look a few seconds later finds where it waits.
    changed = ['pi-1'];
    const first = new Date();
    expect(await bpm.registry.syncOnce(first)).toBe(1);
    expect((await instances())[0]).toMatchObject({
      version: 2,
      currentStep: 'تأیید مدیر',
      currentStepId: 'approve',
      candidateGroups: ['purchase_manager'],
      dueAt: new Date('2026-10-30T08:00:00.000Z'),
      requesterId: user.get('id'),
    });

    // Canceled in Operate: the next look brings the row in line and logs what changed.
    states.set('pi-1', {
      ...states.get('pi-1'),
      status: 'canceled',
      endedAt: '2026-10-27T09:00:00.000Z',
      steps: [],
      tasks: [],
    });
    changed = ['pi-1'];
    await bpm.registry.syncOnce(new Date(first.getTime() + 5000));
    expect((await instances())[0]).toMatchObject({
      status: 'canceled',
      endedAt: new Date('2026-10-27T09:00:00.000Z'),
      currentStep: null,
      candidateGroups: null,
    });
    const [, logged] = await events('instance.sync');
    expect(logged).toMatchObject({
      direction: 'in',
      status: 'ok',
      instanceId: 'pi-1',
      businessKey,
      detail: {
        changed: expect.arrayContaining(['status', 'endedAt', 'currentStep']),
        before: expect.objectContaining({ status: 'active', currentStep: 'تأیید مدیر' }),
        status: 'canceled',
      },
    });
    // Each look starts a little before the end of the one before it.
    expect(first.getTime() - looks[1].getTime()).toBe(bpm.registry.options.overlapMs);
  });

  it('leaves out the instances of processes nobody marked', async () => {
    await mark('camunda', 'purchase_request');
    states.set('pi-9', engineState('pi-9', { processKey: 'leave_request' }));
    changed = ['pi-9'];
    await bpm.registry.syncOnce();
    expect(await instances()).toEqual([]);
  });

  it('reads the running instances of a process when it is marked', async () => {
    states.set('pi-1', engineState('pi-1', { processKey: 'leave_request', businessKey: 'leaves:1' }));
    states.set('pi-2', engineState('pi-2', { processKey: 'leave_request', businessKey: 'leaves:2' }));
    states.set('pi-3', engineState('pi-3', { processKey: 'leave_request', status: 'completed' }));
    await mark('camunda', 'leave_request');
    await settle();
    // The instances are read side by side, so their rows are made in any order.
    const rows = (await instances()).map((row) => [row.instanceId, row.recordCollection, row.recordId]);
    expect(rows.sort()).toEqual([
      ['pi-1', 'leaves', '1'],
      ['pi-2', 'leaves', '2'],
    ]);
  });

  it('fixes at night what the looks missed, and keeps finished instances whose history is gone', async () => {
    await mark('camunda', 'purchase_request');
    for (const id of ['pi-1', 'pi-2', 'pi-3']) {
      states.set(id, engineState(id, { businessKey: `purchase_requests:${id}` }));
      await bpm.registry.refreshEngineInstance(id);
    }
    // pi-1 ended unseen, the engine forgot the open pi-2, and pi-3 ended and its history was removed.
    states.set('pi-1', {
      ...states.get('pi-1'),
      status: 'completed',
      endedAt: '2026-10-28T08:00:00.000Z',
      steps: [],
      tasks: [],
    });
    states.set('pi-3', {
      ...states.get('pi-3'),
      status: 'completed',
      endedAt: '2026-10-28T08:00:00.000Z',
      steps: [],
      tasks: [],
    });
    await bpm.registry.refreshEngineInstance('pi-3');
    states.delete('pi-2');
    states.delete('pi-3');
    await bpm.cleanup();
    expect((await instances()).map((row) => [row.instanceId, row.status])).toEqual([
      ['pi-1', 'completed'],
      ['pi-2', 'active'],
      ['pi-3', 'completed'],
    ]);
    const [reconciled] = await events('instance.reconcile');
    expect(reconciled).toMatchObject({ instanceId: 'pi-1', detail: { changed: expect.arrayContaining(['status']) } });
    const [missing] = await events('instance.missing');
    expect(missing).toMatchObject({
      instanceId: 'pi-2',
      status: 'error',
      error: 'The engine does not know this open instance',
    });
  });

  it('shows a user without permission only the instances they started', async () => {
    await mark('camunda', 'purchase_request');
    states.set('pi-1', engineState('pi-1'));
    states.set('pi-2', engineState('pi-2', { businessKey: 'purchase_requests:2' }));
    await bpm.registry.noteStarted({
      processKey: 'purchase_request',
      businessKey: 'purchase_requests:1',
      instanceId: 'pi-1',
      created: true,
      userId: user.get('id'),
    });
    await bpm.registry.noteStarted({
      processKey: 'purchase_request',
      businessKey: 'purchase_requests:2',
      instanceId: 'pi-2',
      created: true,
      userId: manager.get('id'),
    });
    const [mine, theirs] = await instances();

    const member = await app.agent().login(user, 'member');
    const list = await member.resource('bpmInstances').list();
    expect(list.status).toBe(200);
    expect(list.body.data.map((row) => row.instanceId)).toEqual(['pi-1']);
    expect((await member.resource('bpmInstances').get({ filterByTk: mine.id })).body.data.instanceId).toBe('pi-1');
    expect((await member.resource('bpmInstances').get({ filterByTk: theirs.id })).body.data).toBeFalsy();
    expect(
      (await member.resource('bpmInstances').list({ filter: { requesterId: manager.get('id') } })).body.data,
    ).toEqual([]);

    await app.db.getRepository('roles').create({ values: { name: 'process_admin', snippets: ['pm.bpm'] } });
    const admin = await app.db.getRepository('users').create({ values: { nickname: 'pm', roles: ['process_admin'] } });
    const pm = await app.agent().login(admin, 'process_admin');
    expect((await pm.resource('bpmInstances').list()).body.data).toHaveLength(2);

    const agent = await root();
    for (const res of [
      await agent.resource('bpmInstances').create({ values: { builder: 'camunda', instanceId: 'x' } }),
      await agent.resource('bpmInstances').update({ filterByTk: mine.id, values: { status: 'completed' } }),
      await agent.resource('bpmInstances').destroy({ filterByTk: mine.id }),
      await member.resource('bpmInstances').update({ filterByTk: mine.id, values: { status: 'completed' } }),
    ]) {
      expect(res.status).toBe(403);
      expect(errorOf(res)).toBe('The process instances are kept by the plugin and are read-only');
    }

    // «Read again» compares one row with the engine now.
    const refreshed = await agent.resource('bpmInstances').refresh({ filterByTk: mine.id });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data).toMatchObject({ currentStep: 'تأیید مدیر', status: 'active' });
    expect((await member.resource('bpmInstances').refresh({ filterByTk: mine.id })).status).toBe(403);
  });
});
