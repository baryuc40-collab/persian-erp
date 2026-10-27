import { createMockServer, MockServer } from '@nocobase/test';
import { Camunda8Engine } from '../camunda8';
import { BpmEngine, BpmEngineError } from '../engine';
import { OperatonEngine } from '../operaton';
import PluginBpmServer from '../plugin';

// Settings > BPMN engine on the server (STORY-079), with a stand-in engine; operaton.test.ts uses the real one.

async function rootAgent(app: MockServer) {
  const user = await app.db.getRepository('users').findOne({ filter: { 'roles.name': 'root' } });
  return app.agent().login(user, 'root');
}

const errorOf = (res) => res.body.errors?.[0]?.message as string;

describe('bpm settings', () => {
  let app: MockServer;
  let seen: { url: string; username?: string; password?: string }[];
  let engine: Partial<BpmEngine>;

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
        PluginBpmServer,
      ],
      acl: true,
    });
    seen = [];
    engine = {
      version: async () => '2.1.5',
      listProcesses: async () => [
        { id: 'p:1', key: 'purchase_request', name: 'درخواست خرید', version: 1, deploymentId: 'd' },
      ],
      deploy: async (name, files) => ({
        id: 'd',
        processes: [{ id: 'p:1', key: name, name: files[0].name, version: 1, deploymentId: 'd' }],
      }),
    };
    (app.pm.get(PluginBpmServer) as PluginBpmServer).createEngine = (settings) => {
      seen.push(settings);
      return engine as BpmEngine;
    };
  });

  afterEach(async () => {
    delete process.env.BPM_ENGINE;
    delete process.env.BPM_ENGINE_URL;
    delete process.env.BPM_ENGINE_USERNAME;
    delete process.env.BPM_ENGINE_PASSWORD;
    await app.destroy();
  });

  it('saves the connection and never sends the password back', async () => {
    const agent = await rootAgent(app);
    expect((await agent.resource('bpm').getSettings()).body.data).toEqual({
      engine: 'camunda8',
      url: '',
      username: '',
      hasPassword: false,
      fromEnv: true,
    });
    const saved = await agent.resource('bpm').saveSettings({
      values: { engine: 'operaton', url: 'http://operaton:8080/', username: 'nocobase', password: 'secret' },
    });
    expect(saved.body.data).toEqual({
      engine: 'operaton',
      url: 'http://operaton:8080/',
      username: 'nocobase',
      hasPassword: true,
      fromEnv: false,
    });
    expect(JSON.stringify(saved.body)).not.toContain('secret');

    // An empty password keeps the saved one.
    await agent.resource('bpm').saveSettings({
      values: { engine: 'operaton', url: 'http://operaton:8080', username: 'nocobase', password: '' },
    });
    expect((await agent.resource('bpm').test()).body.data).toEqual({ version: '2.1.5' });
    expect(seen.at(-1)).toMatchObject({
      engine: 'operaton',
      url: 'http://operaton:8080',
      username: 'nocobase',
      password: 'secret',
    });

    const bad = await agent.resource('bpm').saveSettings({ values: { url: 'operaton:8080' } });
    expect(bad.status).toBe(400);
    expect(errorOf(bad)).toBe('The engine address must start with http:// or https://');
    const unknown = await agent.resource('bpm').saveSettings({ values: { engine: 'jbpm', url: 'http://x:8080' } });
    expect(errorOf(unknown)).toBe('Choose Camunda 8 or Operaton as the engine');
  });

  it('takes a connection saved before the engine choice as Operaton', async () => {
    await app.db.getRepository('bpmSettings').create({ values: { id: 1, url: 'http://operaton:8080' } });
    const agent = await rootAgent(app);
    expect((await agent.resource('bpm').getSettings()).body.data).toMatchObject({ engine: 'operaton' });
  });

  it('builds the adapter of the chosen engine', async () => {
    // A plugin of its own: the one of the app has the stand-in engine of beforeEach.
    const { createEngine } = new PluginBpmServer(app, {});
    expect(createEngine({ engine: 'camunda8', url: 'http://camunda:8080' })).toBeInstanceOf(Camunda8Engine);
    expect(createEngine({ engine: 'operaton', url: 'http://operaton:8080' })).toBeInstanceOf(OperatonEngine);
  });

  it('uses the server environment until a connection is saved', async () => {
    process.env.BPM_ENGINE = 'operaton';
    process.env.BPM_ENGINE_URL = 'http://operaton:8080';
    process.env.BPM_ENGINE_USERNAME = 'svc';
    process.env.BPM_ENGINE_PASSWORD = 'from-env';
    const agent = await rootAgent(app);
    expect((await agent.resource('bpm').getSettings()).body.data).toEqual({
      engine: 'operaton',
      url: 'http://operaton:8080',
      username: 'svc',
      hasPassword: true,
      fromEnv: true,
    });
    await agent.resource('bpm').test();
    expect(seen.at(-1)).toMatchObject({ password: 'from-env' });
  });

  it('turns engine errors into a 400 with the message, and says when nothing is set up', async () => {
    const agent = await rootAgent(app);
    let res = await agent.resource('bpm').test();
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('The BPMN engine is not set up');

    await agent.resource('bpm').saveSettings({ values: { url: 'http://operaton:8080' } });
    engine.version = async () => {
      throw new BpmEngineError('The BPMN engine did not accept the user name or password');
    };
    res = await agent.resource('bpm').test();
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('The BPMN engine did not accept the user name or password');

    // The engine's own message stays as it is.
    engine.version = async () => {
      throw new BpmEngineError('The user of the BPMN engine may not do this: {{message}}', {
        message: "Insufficient permissions to perform operation 'CREATE'",
      });
    };
    res = await agent.resource('bpm').test();
    expect(errorOf(res)).toBe(
      "The user of the BPMN engine may not do this: Insufficient permissions to perform operation 'CREATE'",
    );
  });

  it('lists and deploys process models and forms, and refuses what is neither', async () => {
    const agent = await rootAgent(app);
    await agent.resource('bpm').saveSettings({ values: { url: 'http://camunda:8080' } });
    expect((await agent.resource('bpm').processes()).body.data).toEqual([
      expect.objectContaining({ key: 'purchase_request', version: 1 }),
    ]);
    const content = '<?xml version="1.0"?><bpmn:definitions></bpmn:definitions>';
    const res = await agent.resource('bpm').deploy({ values: { name: 'purchase-request.bpmn', content } });
    expect(res.body.data.processes[0]).toMatchObject({ key: 'purchase-request', name: 'purchase-request.bpmn' });
    const notBpmn = await agent.resource('bpm').deploy({ values: { name: 'notes.txt', content } });
    expect(errorOf(notBpmn)).toBe('This is not a BPMN or form file');

    const form = JSON.stringify({ id: 'purchase-approve', components: [{ type: 'checkbox', key: 'approved' }] });
    const deployed = await agent.resource('bpm').deploy({ values: { name: 'purchase-approve.form', content: form } });
    expect(deployed.status).toBe(200);
    const notForm = await agent.resource('bpm').deploy({ values: { name: 'x.form', content: '{"title":"x"}' } });
    expect(errorOf(notForm)).toBe('This is not a BPMN or form file');

    // Operaton has no Camunda forms.
    await agent.resource('bpm').saveSettings({ values: { engine: 'operaton', url: 'http://operaton:8080' } });
    const refused = await agent.resource('bpm').deploy({ values: { name: 'purchase-approve.form', content: form } });
    expect(errorOf(refused)).toBe('Only Camunda 8 takes form files');
  });

  it('is only for administrators', async () => {
    expect((await app.agent().resource('bpm').getSettings()).status).toBe(401);
    const member = await app.db.getRepository('users').create({ values: { nickname: 'm', roles: ['member'] } });
    const agent = await app.agent().login(member);
    expect((await agent.resource('bpm').getSettings()).status).toBe(403);
    expect((await agent.resource('bpm').saveSettings({ values: { url: 'http://x' } })).status).toBe(403);
  });
});
