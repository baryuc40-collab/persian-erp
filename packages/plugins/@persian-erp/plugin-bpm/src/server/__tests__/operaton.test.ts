import fs from 'fs';
import path from 'path';
import { BpmEngineError } from '../engine';
import { OperatonEngine } from '../operaton';

// OperatonEngine against a real engine (STORY-079). CI starts one as a service; locally:
//   docker run -d -p 18080:8080 -e OPERATON_BPM_RUN_AUTH_ENABLED=true -e OPERATON_BPM_RUN_EXAMPLE_ENABLED=false \
//     -e OPERATON_BPM_ADMIN_USER_ID=nocobase -e OPERATON_BPM_ADMIN_USER_PASSWORD=secret operaton/operaton:2.1.5
//   OPERATON_URL=http://localhost:18080 yarn test --server packages/plugins/@persian-erp/plugin-bpm --run
const url = process.env.OPERATON_URL;
const settings = {
  url,
  username: process.env.OPERATON_USER || 'nocobase',
  password: process.env.OPERATON_PASSWORD || 'secret',
};
const MODEL = path.resolve(__dirname, '../../../../../../../bpmn/purchase-request.bpmn');

describe.skipIf(!url)('OperatonEngine', () => {
  const engine = new OperatonEngine(settings);
  // Each run uses its own business keys, so reruns against the same engine do not see each other.
  const run = Date.now().toString(36);
  const key = (id: number) => `purchase_requests:${run}-${id}`;

  beforeAll(async () => {
    await engine.deploy('purchase-request', [
      { name: 'purchase-request.bpmn', content: fs.readFileSync(MODEL, 'utf8') },
    ]);
  });

  it('reports its version, and a wrong password or address in words', async () => {
    expect(await engine.version()).toMatch(/^\d+\.\d+\.\d+/);
    // Another user: a wrong password for the service user would lock it for a while (Operaton's login delay).
    const wrong = new OperatonEngine({ ...settings, username: 'nobody', password: 'wrong' });
    await expect(wrong.version()).rejects.toThrow('The BPMN engine did not accept the user name or password');
    const nowhere = new OperatonEngine({ url: 'http://127.0.0.1:9', timeout: 2000 });
    await expect(nowhere.version()).rejects.toBeInstanceOf(BpmEngineError);
  });

  it('deploys a model once: the same file again makes no new version', async () => {
    const again = await engine.deploy('purchase-request', [
      { name: 'purchase-request.bpmn', content: fs.readFileSync(MODEL, 'utf8') },
    ]);
    expect(again.processes).toEqual([]);
    const process = (await engine.listProcesses()).find((p) => p.key === 'purchase_request');
    expect(process).toMatchObject({ name: 'درخواست خرید' });
  });

  it('runs the purchase request: approval by the group, then the service task', async () => {
    const started = await engine.start('purchase_request', key(1), { recordId: 1 });
    expect(started.created).toBe(true);
    // The same business key again gives the running instance back.
    expect(await engine.start('purchase_request', key(1), { recordId: 1 })).toEqual({
      instanceId: started.instanceId,
      created: false,
    });

    const [task] = await engine.listUserTasks({ candidateGroups: ['purchase_manager'], businessKey: key(1) });
    expect(task).toMatchObject({
      name: 'تأیید مدیر',
      processKey: 'purchase_request',
      businessKey: key(1),
      candidateGroups: ['purchase_manager'],
      assignee: null,
    });
    expect(await engine.listUserTasks({ candidateGroups: ['clerk'], businessKey: key(1) })).toEqual([]);
    expect(await engine.getUserTask(task.id)).toEqual(task);
    expect(task).toMatchObject({ taskKey: 'approve', processName: 'درخواست خرید' });
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
    expect(await engine.getUserTask(task.id)).toBeNull();

    const fetched = await engine.fetchServiceTasks('test-worker', [{ name: 'place-order', lockMs: 10000 }], 10);
    const order = fetched.find((t) => t.businessKey === key(1));
    expect(order).toMatchObject({
      topic: 'place-order',
      processKey: 'purchase_request',
      variables: { recordId: 1, approved: true },
    });

    // A failure with retries left gives the task back after the retry time.
    await engine.failServiceTask('test-worker', order.id, { message: 'خطای آزمایشی', retries: 1, retryMs: 0 });
    const retried = await engine.fetchServiceTasks('test-worker', [{ name: 'place-order', lockMs: 10000 }], 10);
    const again = retried.find((t) => t.businessKey === key(1));
    expect(again).toMatchObject({ id: order.id, retries: 1 });
    await engine.completeServiceTask('test-worker', again.id, { orderNumber: 'PO-1' });
    expect(await engine.start('purchase_request', key(1))).toMatchObject({ created: true });
  });

  it('sends a rejected request to the reject task, not to the order', async () => {
    await engine.start('purchase_request', key(2), { recordId: 2 });
    const [task] = await engine.listUserTasks({ businessKey: key(2) });
    await engine.completeUserTask(task.id, { approved: false });
    const topics = [
      { name: 'place-order', lockMs: 1000 },
      { name: 'reject-request', lockMs: 1000 },
    ];
    const fetched = await engine.fetchServiceTasks('test-worker', topics, 10);
    expect(fetched.filter((t) => t.businessKey === key(2)).map((t) => t.topic)).toEqual(['reject-request']);
  });

  it('locks a service task to one worker, and makes an incident after the last retry', async () => {
    await engine.start('purchase_request', key(3), { recordId: 3 });
    const [task] = await engine.listUserTasks({ businessKey: key(3) });
    await engine.completeUserTask(task.id, { approved: true });
    const topics = [{ name: 'place-order', lockMs: 60000 }];
    const mine = (tasks: { businessKey: string | null }[]) => tasks.filter((t) => t.businessKey === key(3));
    // Two app instances in a cluster: the second worker does not get the task the first one locked.
    const [order] = mine(await engine.fetchServiceTasks('worker-a', topics, 10));
    expect(order).toBeTruthy();
    expect(mine(await engine.fetchServiceTasks('worker-b', topics, 10))).toEqual([]);
    // Only the worker that holds the lock can report on it.
    await expect(engine.completeServiceTask('worker-b', order.id)).rejects.toBeInstanceOf(BpmEngineError);

    await engine.failServiceTask('worker-a', order.id, { message: 'خطای آخر', retries: 0, retryMs: 0 });
    expect(mine(await engine.fetchServiceTasks('worker-a', topics, 10))).toEqual([]);
    const auth = Buffer.from(`${settings.username}:${settings.password}`).toString('base64');
    const response = await fetch(`${url}/engine-rest/incident?processInstanceId=${order.processInstanceId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    expect(await response.json()).toEqual([expect.objectContaining({ incidentMessage: 'خطای آخر' })]);
  });
});
