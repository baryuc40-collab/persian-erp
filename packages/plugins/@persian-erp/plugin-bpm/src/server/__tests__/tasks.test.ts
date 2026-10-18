import { createMockServer, MockServer } from '@nocobase/test';
import { BpmEngine, FormField, UserTask, Variables } from '../engine';
import PluginBpmServer from '../plugin';

// The task inbox on the server (STORY-082), with a stand-in engine: who sees and completes which task.

const errorOf = (res) => res.body.errors?.[0]?.message as string;

const task = (id: string, extra: Partial<UserTask> = {}): UserTask => ({
  id,
  name: 'تأیید مدیر',
  taskKey: 'approve',
  processKey: 'purchase_request',
  processName: 'درخواست خرید',
  processDefinitionId: 'purchase_request:1',
  processInstanceId: `i-${id}`,
  businessKey: 'purchase_requests:1',
  assignee: null,
  candidateGroups: ['purchase_manager'],
  created: '2026-10-14T08:00:00.000Z',
  ...extra,
});

const form: FormField[] = [
  { id: 'approved', label: 'تأیید', type: 'boolean', required: true, defaultValue: null, options: [] },
  { id: 'amount', label: 'مبلغ', type: 'long', required: false, defaultValue: null, options: [] },
  {
    id: 'priority',
    label: 'اولویت',
    type: 'enum',
    required: false,
    defaultValue: null,
    options: [
      { id: 'low', name: 'کم' },
      { id: 'high', name: 'زیاد' },
    ],
  },
];

describe('bpm task inbox', () => {
  let app: MockServer;
  let tasks: UserTask[];
  let completed: { id: string; variables: Variables }[];
  let asked: { candidateGroups?: string[]; assignee?: string }[];

  const login = async (roles: string[]) => {
    for (const name of roles) {
      if (!(await app.db.getRepository('roles').findOne({ filterByTk: name }))) {
        await app.db.getRepository('roles').create({ values: { name, title: name } });
      }
    }
    const user = await app.db.getRepository('users').create({ values: { nickname: roles.join('-'), roles } });
    return { agent: await app.agent().login(user, roles[0]), id: String(user.id) };
  };

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
    await app.db.getRepository('collections').create({
      values: {
        name: 'purchase_requests',
        title: 'درخواست خرید',
        titleField: 'title',
        fields: [
          { name: 'title', type: 'string', interface: 'input', uiSchema: { title: 'عنوان' } },
          { name: 'secret', type: 'password', interface: 'password', uiSchema: { title: 'رمز' } },
        ],
      },
      context: {},
    });
    await app.db.getRepository('purchase_requests').create({ values: { title: 'لپ‌تاپ', secret: 'x' } });

    tasks = [
      task('t1'),
      task('t2', { candidateGroups: ['accounting', 'purchase_manager'], businessKey: 'gone:5' }),
      task('t3', { candidateGroups: ['accounting'] }),
      task('t6', { businessKey: 'purchase_requests:not-a-number' }),
      task('t5', { candidateGroups: [], assignee: 'nobody' }),
    ];
    completed = [];
    asked = [];
    const engine: Partial<BpmEngine> = {
      // Like the engine: tasks of any of the groups, or of the assignee.
      listUserTasks: async (filter) => {
        asked.push(filter);
        return tasks.filter(
          (t) =>
            t.candidateGroups.some((g) => filter.candidateGroups?.includes(g)) ||
            (filter.assignee && t.assignee === filter.assignee),
        );
      },
      getUserTask: async (id) => tasks.find((t) => t.id === id) ?? null,
      getTaskForm: async () => form,
      completeUserTask: async (id, variables) => {
        completed.push({ id, variables });
        tasks = tasks.filter((t) => t.id !== id);
      },
    };
    const bpm = app.pm.get(PluginBpmServer) as PluginBpmServer;
    bpm.createEngine = () => engine as BpmEngine;
    process.env.BPM_ENGINE_URL = 'http://engine';
  });

  afterEach(async () => {
    delete process.env.BPM_ENGINE_URL;
    await app.destroy();
  });

  it('lists the tasks of the user’s roles and the ones assigned to them, with their records', async () => {
    const manager = await login(['purchase_manager']);
    tasks.push(task('t4', { candidateGroups: [], assignee: manager.id }));
    const res = await manager.agent.resource('bpmTasks').list();
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).toEqual(['t1', 't2', 't6', 't4']);
    expect(res.body.data[0]).toMatchObject({
      name: 'تأیید مدیر',
      processName: 'درخواست خرید',
      created: '2026-10-14T08:00:00.000Z',
      record: { collection: 'purchase_requests', collectionTitle: 'درخواست خرید', id: 1, title: 'لپ‌تاپ' },
    });
    // A business key whose record or collection is gone gives no record, not an error.
    expect(res.body.data[1].record).toBeNull();
    expect(res.body.data[2].record).toBeNull();
    expect(asked[0]).toEqual({ candidateGroups: ['purchase_manager'], assignee: manager.id });
  });

  it('shows the task with its form and the fields of its record, but not hidden ones', async () => {
    const { agent } = await login(['purchase_manager']);
    const res = await agent.resource('bpmTasks').get({ filterByTk: 't1' });
    expect(res.status).toBe(200);
    expect(res.body.data.form).toEqual(form);
    const fields = res.body.data.fields.map((f) => [f.name, f.title, f.value]);
    expect(fields).toContainEqual(['title', 'عنوان', 'لپ‌تاپ']);
    expect(fields.map(([name]) => name)).not.toContain('secret');
  });

  it('keeps a user without the role out of the task, with a 403', async () => {
    const { agent } = await login(['clerk']);
    expect((await agent.resource('bpmTasks').list()).body.data).toEqual([]);
    const get = await agent.resource('bpmTasks').get({ filterByTk: 't1' });
    expect(get.status).toBe(403);
    const complete = await agent.resource('bpmTasks').complete({ filterByTk: 't1', values: { approved: true } });
    expect(complete.status).toBe(403);
    expect(completed).toEqual([]);
    expect((await app.agent().resource('bpmTasks').list()).status).toBe(401);
  });

  it('completes the task with the form’s values only, each as its type', async () => {
    const { agent } = await login(['purchase_manager']);
    const missing = await agent.resource('bpmTasks').complete({ filterByTk: 't1', values: { amount: 5 } });
    expect(missing.status).toBe(400);
    expect(errorOf(missing)).toBe('Fill in تأیید');
    const wrong = await agent.resource('bpmTasks').complete({
      filterByTk: 't1',
      values: { approved: true, priority: 'urgent' },
    });
    expect(errorOf(wrong)).toBe('The value of اولویت is not valid');

    const res = await agent.resource('bpmTasks').complete({
      filterByTk: 't1',
      values: { approved: 'true', amount: '1200', priority: 'high', status: 'paid' },
    });
    expect(res.status).toBe(200);
    expect(completed).toEqual([{ id: 't1', variables: { approved: true, amount: 1200, priority: 'high' } }]);
    // Done tasks are gone.
    expect((await agent.resource('bpmTasks').complete({ filterByTk: 't1', values: { approved: true } })).status).toBe(
      404,
    );
  });
});
