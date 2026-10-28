import fs from 'fs';
import path from 'path';
import { Camunda8Engine } from '../camunda8';
import { BpmEngine, BpmEngineError } from '../engine';
import { EngineSettings, engineRequest } from '../http';
import { OperatonEngine } from '../operaton';

// The contract of BpmEngine (decision 0008, section 4) against real engines: each adapter whose engine is given runs
// the same purchase request. CI starts both; locally, for example:
//   docker run -d -p 18080:8080 -e OPERATON_BPM_RUN_AUTH_ENABLED=true -e OPERATON_BPM_RUN_EXAMPLE_ENABLED=false \
//     -e OPERATON_BPM_ADMIN_USER_ID=nocobase -e OPERATON_BPM_ADMIN_USER_PASSWORD=secret operaton/operaton:2.1.5
//   docker compose --profile bpm up -d camunda   (and publish its port 8080, e.g. with an override file)
//   OPERATON_URL=http://localhost:18080 CAMUNDA_URL=http://localhost:18088 CAMUNDA_PASSWORD=change-me \
//     yarn test --server packages/plugins/@persian-erp/plugin-bpm --run
const BPMN = path.resolve(__dirname, '../../../../../../../bpmn');
const read = (file: string) => ({ name: path.basename(file), content: fs.readFileSync(path.join(BPMN, file), 'utf8') });

interface EngineCase {
  name: string;
  settings: EngineSettings;
  create(settings: EngineSettings): BpmEngine;
  files: { name: string; content: string }[];
  /** Searches of Camunda 8 follow the commands by a moment. */
  eventual: boolean;
  /** Operaton lets only the worker that locked a service task report on it; Camunda 8 jobs take any client. */
  workerOwnsLock: boolean;
  incidentMessages(settings: EngineSettings, instanceId: string): Promise<string[]>;
}

const CASES: EngineCase[] = [
  {
    name: 'Operaton',
    settings: {
      url: process.env.OPERATON_URL,
      username: process.env.OPERATON_USER || 'nocobase',
      password: process.env.OPERATON_PASSWORD || 'secret',
    },
    create: (settings) => new OperatonEngine(settings),
    files: [read('operaton/purchase-request.bpmn')],
    eventual: false,
    workerOwnsLock: true,
    incidentMessages: async (settings, instanceId) =>
      (
        await engineRequest(settings, `${settings.url}/engine-rest/incident?processInstanceId=${instanceId}`, {
          method: 'GET',
        })
      ).map((row) => row.incidentMessage),
  },
  {
    name: 'Camunda 8',
    settings: {
      url: process.env.CAMUNDA_URL,
      username: process.env.CAMUNDA_USER || 'nocobase',
      password: process.env.CAMUNDA_PASSWORD || 'secret',
    },
    create: (settings) => new Camunda8Engine(settings),
    files: [read('purchase-request.bpmn'), read('purchase-approve.form')],
    eventual: true,
    workerOwnsLock: false,
    incidentMessages: async (settings, instanceId) =>
      (
        await engineRequest(settings, `${settings.url}/v2/incidents/search`, {
          method: 'POST',
          body: { filter: { processInstanceKey: instanceId } },
        })
      ).items.map((row) => row.errorMessage),
  },
];

/** Retries a check until it passes; at once for an engine whose searches are not eventual. */
async function eventually<T>(engineCase: EngineCase, check: () => Promise<T>, timeout = 30000): Promise<T> {
  const until = Date.now() + (engineCase.eventual ? timeout : 0);
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const GIVEN = CASES.filter((c) => c.settings.url);

describe.skipIf(GIVEN.length)('BpmEngine contract', () => {
  it.skip('needs OPERATON_URL or CAMUNDA_URL', () => undefined);
});

describe.each(GIVEN)('BpmEngine contract: $name', (engineCase) => {
  const engine = engineCase.create(engineCase.settings);
  // Each run uses its own business keys, so reruns against the same engine do not see each other.
  const run = Date.now().toString(36);
  const key = (id: number) => `purchase_requests:${run}-${id}`;
  const later = <T>(check: () => Promise<T>) => eventually(engineCase, check);

  const openTask = (businessKey: string) =>
    later(async () => {
      const [task] = await engine.listUserTasks({ businessKey });
      expect(task).toBeTruthy();
      return task;
    });

  beforeAll(async () => {
    for (const file of engineCase.files) await engine.deploy('purchase-request', [file]);
  }, 60000);

  it('reports its version, and a wrong password or address in words', async () => {
    expect(await engine.version()).toMatch(/^\d+\.\d+\.\d+/);
    // Another user: a wrong password for the service user would lock it for a while (Operaton's login delay).
    const wrong = engineCase.create({ ...engineCase.settings, username: 'nobody', password: 'wrong' });
    await expect(wrong.version()).rejects.toThrow('The BPMN engine did not accept the user name or password');
    const nowhere = engineCase.create({ url: 'http://127.0.0.1:9', timeout: 2000 });
    await expect(nowhere.version()).rejects.toBeInstanceOf(BpmEngineError);
  });

  it('deploys a model once: the same file again makes no new version', async () => {
    const before = await later(async () => {
      const found = (await engine.listProcesses()).find((p) => p.key === 'purchase_request');
      expect(found).toMatchObject({ name: 'درخواست خرید' });
      return found;
    });
    const again = await engine.deploy('purchase-request', [engineCase.files[0]]);
    for (const process of again.processes) expect(process.version).toBe(before.version);
    expect((await engine.listProcesses()).find((p) => p.key === 'purchase_request').version).toBe(before.version);
  });

  it('runs the purchase request: approval by the group, then the service task', async () => {
    const started = await engine.start('purchase_request', key(1), { recordId: 1 });
    expect(started).toMatchObject({ created: true, instanceId: expect.any(String) });
    // The same business key again gives the running instance back.
    expect(await engine.start('purchase_request', key(1), { recordId: 1 })).toEqual({
      instanceId: started.instanceId,
      created: false,
    });

    const task = await later(async () => {
      const [found] = await engine.listUserTasks({ candidateGroups: ['purchase_manager'], businessKey: key(1) });
      expect(found).toBeTruthy();
      return found;
    });
    expect(task).toMatchObject({
      name: 'تأیید مدیر',
      taskKey: 'approve',
      processKey: 'purchase_request',
      processName: 'درخواست خرید',
      processInstanceId: started.instanceId,
      businessKey: key(1),
      candidateGroups: ['purchase_manager'],
      assignee: null,
    });
    expect(await engine.listUserTasks({ candidateGroups: ['clerk'], businessKey: key(1) })).toEqual([]);
    expect(await engine.getUserTask(task.id)).toEqual(task);
    expect(await engine.getTaskForm(task)).toEqual([
      {
        id: 'approved',
        label: 'درخواست تأیید می‌شود؟',
        type: 'boolean',
        required: true,
        defaultValue: null,
        options: [],
      },
      { id: 'managerNote', label: 'یادداشت مدیر', type: 'string', required: false, defaultValue: null, options: [] },
    ]);
    await engine.completeUserTask(task.id, { approved: true });
    // Gone at once, also where the engine's search still has it for a moment.
    expect(await engine.getUserTask(task.id)).toBeNull();
    expect(await engine.listUserTasks({ businessKey: key(1) })).toEqual([]);

    const topics = [{ name: 'place-order', lockMs: 10000 }];
    const order = await later(async () => {
      const found = (await engine.fetchServiceTasks('test-worker', topics, 10)).find((t) => t.businessKey === key(1));
      expect(found).toBeTruthy();
      return found;
    });
    expect(order).toMatchObject({
      topic: 'place-order',
      processKey: 'purchase_request',
      processInstanceId: started.instanceId,
      variables: { recordId: 1, approved: true },
    });

    // A failure with retries left gives the task back after the retry time.
    await engine.failServiceTask('test-worker', order.id, { message: 'خطای آزمایشی', retries: 1, retryMs: 0 });
    const again = await later(async () => {
      const found = (await engine.fetchServiceTasks('test-worker', topics, 10)).find((t) => t.businessKey === key(1));
      expect(found).toBeTruthy();
      return found;
    });
    expect(again).toMatchObject({ id: order.id, retries: 1 });
    await engine.completeServiceTask('test-worker', again.id, { orderNumber: 'PO-1' });
    // The instance is done, so the key starts a new one.
    const next = await later(async () => {
      const result = await engine.start('purchase_request', key(1));
      expect(result.created).toBe(true);
      return result;
    });
    expect(next.instanceId).not.toBe(started.instanceId);
  }, 120000);

  it('sends a rejected request to the reject task, not to the order', async () => {
    await engine.start('purchase_request', key(2), { recordId: 2 });
    const task = await openTask(key(2));
    await engine.completeUserTask(task.id, { approved: false });
    const topics = [
      { name: 'place-order', lockMs: 1000 },
      { name: 'reject-request', lockMs: 1000 },
    ];
    const fetched = await later(async () => {
      const mine = (await engine.fetchServiceTasks('test-worker', topics, 10)).filter((t) => t.businessKey === key(2));
      expect(mine.length).toBeGreaterThan(0);
      return mine;
    });
    expect(fetched.map((t) => t.topic)).toEqual(['reject-request']);
  }, 120000);

  it('locks a service task to one worker, and makes an incident after the last retry', async () => {
    await engine.start('purchase_request', key(3), { recordId: 3 });
    const task = await openTask(key(3));
    await engine.completeUserTask(task.id, { approved: true });
    const topics = [{ name: 'place-order', lockMs: 60000 }];
    const mine = (tasks: { businessKey: string | null }[]) => tasks.filter((t) => t.businessKey === key(3));
    // Two app instances in a cluster: the second worker does not get the task the first one locked.
    const order = await later(async () => {
      const [found] = mine(await engine.fetchServiceTasks('worker-a', topics, 10));
      expect(found).toBeTruthy();
      return found;
    });
    expect(mine(await engine.fetchServiceTasks('worker-b', topics, 10))).toEqual([]);
    if (engineCase.workerOwnsLock) {
      // Only the worker that holds the lock can report on it.
      await expect(engine.completeServiceTask('worker-b', order.id)).rejects.toBeInstanceOf(BpmEngineError);
    }

    await engine.failServiceTask('worker-a', order.id, { message: 'خطای آخر', retries: 0, retryMs: 0 });
    expect(mine(await engine.fetchServiceTasks('worker-a', topics, 10))).toEqual([]);
    await later(async () => {
      expect(await engineCase.incidentMessages(engineCase.settings, order.processInstanceId)).toEqual(['خطای آخر']);
    });
  }, 120000);

  it('says when a message reaches no instance', async () => {
    expect(await engine.sendMessage(`nothing-waits-${run}`, key(4))).toEqual({ delivered: false });
  });
});
