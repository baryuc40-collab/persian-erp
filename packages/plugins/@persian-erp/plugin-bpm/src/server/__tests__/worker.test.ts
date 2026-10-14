import { createMockServer, MockServer } from '@nocobase/test';
import { BpmEngine, ServiceTask } from '../engine';
import PluginBpmServer from '../plugin';
import { splitBusinessKey } from '../worker';

// The worker of the BPMN service tasks (STORY-081), with a stand-in engine.

describe('service task worker', () => {
  let app: MockServer;
  let bpm: PluginBpmServer;
  let queue: ServiceTask[];
  let completed: string[];
  let failed: { id: string; retries: number; message: string }[];
  let fetchedTopics: string[][];

  const task = (id: string, extra: Partial<ServiceTask> = {}): ServiceTask => ({
    id,
    topic: 'place-order',
    processKey: 'purchase_request',
    processInstanceId: `pi-${id}`,
    businessKey: 'purchase_requests:1',
    variables: { recordId: 1, approved: true },
    retries: null,
    ...extra,
  });

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
    });
    app.db.collection({
      name: 'purchase_requests',
      fields: [
        { type: 'string', name: 'title' },
        { type: 'string', name: 'status' },
      ],
    });
    await app.db.sync();
    await app.db.getRepository('purchase_requests').create({ values: { title: 'لپ‌تاپ', status: 'pending' } });

    queue = [];
    completed = [];
    failed = [];
    fetchedTopics = [];
    const engine: Partial<BpmEngine> = {
      fetchServiceTasks: async (workerId, topics, max) => {
        fetchedTopics.push(topics.map((t) => t.name));
        return queue.splice(0, max).filter((t) => topics.some((topic) => topic.name === t.topic));
      },
      completeServiceTask: async (workerId, id) => {
        completed.push(id);
      },
      failServiceTask: async (workerId, id, error) => {
        failed.push({ id, retries: error.retries, message: error.message });
      },
    };
    bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    bpm.createEngine = () => engine as BpmEngine;
    await app.db.getRepository('bpmSettings').create({ values: { id: 1, url: 'http://operaton:8080' } });
  });

  afterEach(async () => {
    delete process.env.BPM_WORKER;
    await app.destroy();
  });

  // A «BPMN service task» workflow that sets the status of the record of the task.
  async function serviceWorkflow(topic: string, status: string) {
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'bpm-service-task', config: { topic } },
    });
    await app.db.getRepository('flow_nodes').create({
      values: {
        workflowId: workflow.get('id'),
        type: 'update',
        config: {
          collection: 'purchase_requests',
          params: { filter: { id: '{{$context.recordId}}' }, values: { status } },
        },
      },
    });
    return workflow;
  }

  const status = async () => (await app.db.getRepository('purchase_requests').findOne({ filterByTk: 1 })).get('status');

  it('asks only for the topics that have a workflow, and does nothing without one', async () => {
    expect(await bpm.worker.runOnce()).toBe(0);
    expect(fetchedTopics).toEqual([]);
    await serviceWorkflow('place-order', 'ordered');
    await app.db.getRepository('workflows').create({
      values: { enabled: false, type: 'bpm-service-task', config: { topic: 'off-topic' } },
    });
    await bpm.worker.runOnce();
    expect(fetchedTopics).toEqual([['place-order']]);
  });

  it('runs the workflow of the topic with the task, then completes the task', async () => {
    await serviceWorkflow('place-order', 'ordered');
    queue.push(task('t1'));
    expect(await bpm.worker.runOnce()).toBe(1);
    expect(await status()).toBe('ordered');
    expect(completed).toEqual(['t1']);
    expect(failed).toEqual([]);
    const [execution] = await app.db.getRepository('executions').find();
    expect(execution.get('context')).toMatchObject({
      task: { id: 't1', topic: 'place-order', processKey: 'purchase_request', businessKey: 'purchase_requests:1' },
      collection: 'purchase_requests',
      recordId: 1,
      variables: { recordId: 1, approved: true },
    });
  });

  it('reports a failed workflow to the engine with the retries left', async () => {
    const workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'bpm-service-task', config: { topic: 'place-order' } },
    });
    // A query on a collection that does not exist fails the execution.
    await app.db.getRepository('flow_nodes').create({
      values: { workflowId: workflow.get('id'), type: 'query', config: { collection: 'missing_things' } },
    });
    queue.push(task('first'), task('again', { retries: 2 }));
    await bpm.worker.runOnce();
    expect(completed).toEqual([]);
    expect(failed.map(({ id, retries }) => [id, retries])).toEqual([
      ['first', 3],
      ['again', 1],
    ]);
    expect(failed[0].message).toMatch(/^NocoBase: workflow \w+ execution \d+ did not succeed$/);
  });

  it('splits business keys into collection and record ID', () => {
    expect(splitBusinessKey('purchase_requests:12')).toEqual(['purchase_requests', 12]);
    expect(splitBusinessKey('orders:PO-1')).toEqual(['orders', 'PO-1']);
    expect(splitBusinessKey('no-key')).toEqual([null, null]);
    expect(splitBusinessKey(null)).toEqual([null, null]);
  });
});
