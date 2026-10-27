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

// A process that waits for the message contract-paid of its business key, then for a person (STORY-094).
const messageModel = (camunda8: boolean) => ({
  name: 'message-contract.bpmn',
  content: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" xmlns:operaton="http://operaton.org/schema/1.0/bpmn" targetNamespace="https://persian-erp.example/bpmn" id="defs">
  <bpmn:message id="paid" name="contract-paid">${
    camunda8
      ? '<bpmn:extensionElements><zeebe:subscription correlationKey="=businessKey" /></bpmn:extensionElements>'
      : ''
  }</bpmn:message>
  <bpmn:process id="bpm_message_contract" name="پیام" isExecutable="true"${
    camunda8 ? '' : ' operaton:historyTimeToLive="1"'
  }>
    <bpmn:startEvent id="start" />
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="wait" />
    <bpmn:intermediateCatchEvent id="wait"><bpmn:messageEventDefinition messageRef="paid" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="f2" sourceRef="wait" targetRef="check" />
    <bpmn:userTask id="check" name="بررسی پرداخت">${
      camunda8 ? '<bpmn:extensionElements><zeebe:userTask /></bpmn:extensionElements>' : ''
    }</bpmn:userTask>
    <bpmn:sequenceFlow id="f3" sourceRef="check" targetRef="end" />
    <bpmn:endEvent id="end" />
  </bpmn:process>
</bpmn:definitions>`,
});

interface EngineCase {
  name: string;
  settings: EngineSettings;
  create(settings: EngineSettings): BpmEngine;
  files: { name: string; content: string }[];
  /** Searches of Camunda 8 follow the commands by a moment. */
  eventual: boolean;
  /** Operaton lets only the worker that locked a service task report on it; Camunda 8 jobs take any client. */
  workerOwnsLock: boolean;
  /** Camunda 8 keeps a message no instance waits for yet; Operaton does not. */
  keepsMessages: boolean;
  /** An instance ID of the engine's form that no instance has. */
  unknownInstance: string;
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
    keepsMessages: false,
    unknownInstance: '00000000-0000-0000-0000-000000000000',
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
    keepsMessages: true,
    unknownInstance: '2251799813000001',
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
    await engine.deploy('message-contract', [messageModel(engineCase.keepsMessages)]);
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

  it('reads an instance: where it waits, its tasks, and whether the searches have it (STORY-095)', async () => {
    const since = new Date(Date.now() - 60000);
    const { instanceId } = await engine.start('purchase_request', key(6), { recordId: 6, amount: 10 });
    const state = await later(async () => {
      const found = await engine.getInstance(instanceId);
      expect(found).toMatchObject({
        instanceId,
        status: 'active',
        processKey: 'purchase_request',
        businessKey: key(6),
      });
      expect(found.steps).toEqual([{ id: 'approve', name: 'تأیید مدیر' }]);
      expect(found.tasks).toEqual([
        expect.objectContaining({ name: 'تأیید مدیر', assignee: null, candidateGroups: ['purchase_manager'] }),
      ]);
      return found;
    });
    expect(state.version).toBeGreaterThan(0);
    expect(new Date(state.startedAt).getTime()).toBeGreaterThan(since.getTime());
    expect(state.endedAt).toBeNull();
    await later(async () => {
      expect(await engine.changedInstances(['purchase_request'], since)).toContain(instanceId);
      expect(await engine.activeInstances(['purchase_request'])).toContain(instanceId);
    });
    expect(await engine.changedInstances(['nothing_like_it'], since)).toEqual([]);
    expect(await engine.getInstance(engineCase.unknownInstance)).toBeNull();

    // Approved: it waits at the order, a service task, with no user task.
    await engine.completeUserTask(state.tasks[0].id, { approved: true });
    await later(async () => {
      const found = await engine.getInstance(instanceId);
      expect(found.steps.map((step) => step.id)).toEqual(['order']);
      expect(found.tasks).toEqual([]);
    });
  }, 60000);

  it('sends a message that may come before its instance waits, once for one message ID', async () => {
    const options = { ttlMs: 60000, messageId: `contract-${run}` };
    // Camunda 8 keeps it for the instance; Operaton says nobody took it, and the outbox sends it again later.
    const early = await engine.publishMessage('contract-paid', key(5), { paid: true }, options);
    expect(early).toEqual({ delivered: engineCase.keepsMessages });
    await engine.start('bpm_message_contract', key(5));
    // The same ID again, as after a lost answer: no error, and Camunda 8 does not take it a second time.
    expect(await engine.publishMessage('contract-paid', key(5), { paid: true }, options)).toEqual({ delivered: true });
    const task = await openTask(key(5));
    expect(task).toMatchObject({ taskKey: 'check', processKey: 'bpm_message_contract' });
    await engine.completeUserTask(task.id, {});
  }, 60000);
});
