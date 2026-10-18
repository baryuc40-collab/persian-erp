import { createMockServer, MockServer } from '@nocobase/test';
import { BpmEngine, BpmEngineError, Variables } from '../engine';
import PluginBpmServer from '../plugin';
import { StartProcessInstruction } from '../start-instruction';

// The workflow node «Start a BPMN process» (STORY-080), with a stand-in engine.

const JOB_RESOLVED = 1;
const JOB_FAILED = -1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('workflow node bpm-start', () => {
  let app: MockServer;
  let started: { processKey: string; businessKey: string; variables: Variables }[];
  let engine: Partial<BpmEngine>;
  let workflow;

  beforeEach(async () => {
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
        { type: 'double', name: 'amount' },
      ],
    });
    await app.db.sync();
    started = [];
    engine = {
      start: async (processKey, businessKey, variables = {}) => {
        const created = !started.some((s) => s.businessKey === businessKey);
        started.push({ processKey, businessKey, variables });
        return { instanceId: `pi-${started.length}`, created };
      },
    };
    const bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    bpm.createEngine = () => engine as BpmEngine;
    await app.db.getRepository('bpmSettings').create({ values: { id: 1, url: 'http://operaton:8080' } });

    workflow = await app.db.getRepository('workflows').create({
      values: { enabled: true, type: 'collection', config: { mode: 1, collection: 'purchase_requests' } },
    });
    await app.db.getRepository('flow_nodes').create({
      values: {
        workflowId: workflow.get('id'),
        type: 'bpm-start',
        config: {
          processKey: 'purchase_request',
          businessKey: 'purchase_requests:{{$context.data.id}}',
          variables: [
            { name: 'recordId', value: '{{$context.data.id}}' },
            { name: 'amount', value: '{{$context.data.amount}}' },
            { name: 'title', value: '{{$context.data.title}}' },
          ],
        },
      },
    });
  });

  afterEach(async () => {
    await app.destroy();
  });

  const lastJob = async () => {
    const [execution] = await app.db.getRepository('executions').find({ sort: ['-id'], limit: 1 });
    const [job] = await app.db.getRepository('jobs').find({ filter: { executionId: execution.get('id') } });
    return job.toJSON();
  };

  it('starts the process for the new record, with its key and variables', async () => {
    const record = await app.db
      .getRepository('purchase_requests')
      .create({ values: { title: 'لپ‌تاپ', amount: 120.5 } });
    await sleep(500);
    expect(started).toEqual([
      {
        processKey: 'purchase_request',
        businessKey: `purchase_requests:${record.get('id')}`,
        variables: { recordId: record.get('id'), amount: 120.5, title: 'لپ‌تاپ' },
      },
    ]);
    const job = await lastJob();
    expect(job.status).toBe(JOB_RESOLVED);
    expect(job.result).toEqual({
      instanceId: 'pi-1',
      created: true,
      processKey: 'purchase_request',
      businessKey: `purchase_requests:${record.get('id')}`,
    });
  });

  it('fails the node with the engine message and keeps the record', async () => {
    engine.start = async () => {
      throw new BpmEngineError('The BPMN engine cannot be reached: {{reason}}', { reason: 'connect ECONNREFUSED' });
    };
    await app.db.getRepository('purchase_requests').create({ values: { title: 'میز' } });
    await sleep(500);
    const job = await lastJob();
    expect(job.status).toBe(JOB_FAILED);
    expect(job.result).toEqual({ error: 'The BPMN engine cannot be reached: connect ECONNREFUSED' });
    expect(await app.db.getRepository('purchase_requests').count()).toBe(1);
  });

  it('fails without a business key, before calling the engine', async () => {
    await app.db.getRepository('flow_nodes').update({
      filter: { workflowId: workflow.get('id') },
      values: { config: { processKey: 'purchase_request', businessKey: '' } },
    });
    await app.db.getRepository('purchase_requests').create({ values: { title: 'میز' } });
    await sleep(500);
    expect((await lastJob()).result).toEqual({ error: 'Choose a process and a business key' });
    expect(started).toEqual([]);
  });

  it('starts one instance when two nodes start the same business key at once', async () => {
    // Like the engine: a look for a running instance, then the start, with time between them.
    engine.start = async (processKey, businessKey, variables = {}) => {
      const running = started.some((s) => s.businessKey === businessKey);
      await sleep(100);
      if (running) return { instanceId: 'pi-1', created: false };
      started.push({ processKey, businessKey, variables });
      return { instanceId: `pi-${started.length}`, created: true };
    };
    const bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    const instruction = new StartProcessInstruction(app.pm.get('workflow') as never, bpm);
    const node = { id: 1, config: { processKey: 'purchase_request', businessKey: 'purchase_requests:7' } };
    const processor = { getParsedValue: (config) => config, logger: console };
    const results = await Promise.all([
      instruction.run(node as never, null, processor as never),
      instruction.run(node as never, null, processor as never),
    ]);
    expect(results.map((r) => (r.result as { created: boolean }).created).sort()).toEqual([false, true]);
    expect(started).toHaveLength(1);
  });
});
