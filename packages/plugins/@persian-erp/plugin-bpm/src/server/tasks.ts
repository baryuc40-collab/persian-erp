// The task inbox of STORY-082: the user tasks of the engine, shown and completed through NocoBase. Users never talk to
// the engine; these actions read it as the service user and let a user see only the tasks of their roles or the ones
// assigned to them (decision 0007, section 5).

import type { Context, Next } from '@nocobase/actions';
import type { FormField, UserTask, Variables } from './engine';
import type { PluginBpmServer } from './plugin';
import { splitBusinessKey } from './worker';

export const TASKS_RESOURCE = 'bpmTasks';

const ASSOCIATIONS = ['belongsTo', 'hasOne', 'hasMany', 'belongsToMany', 'belongsToArray'];
const HIDDEN_INTERFACES = ['password'];

export interface RecordField {
  name: string;
  title: string | null;
  interface: string;
  value: unknown;
}

export interface TaskRecord {
  collection: string;
  collectionTitle: string | null;
  id: string | number;
  title: string | null;
}

export interface TaskRow {
  id: string;
  name: string | null;
  processKey: string;
  processName: string | null;
  businessKey: string | null;
  created: string;
  record: TaskRecord | null;
}

export class TaskInbox {
  constructor(private plugin: PluginBpmServer) {}

  get actions() {
    return {
      list: (ctx: Context, next: Next) => this.list(ctx, next),
      get: (ctx: Context, next: Next) => this.get(ctx, next),
      complete: (ctx: Context, next: Next) => this.complete(ctx, next),
    };
  }

  private user(ctx: Context) {
    const roles: string[] = Array.isArray(ctx.state.currentRoles)
      ? ctx.state.currentRoles
      : [ctx.state.currentRole].filter(Boolean);
    const userId = ctx.state.currentUser?.id;
    return { roles, userId: userId === undefined || userId === null ? null : String(userId) };
  }

  /** A task is the user's when one of their current roles is a candidate group of it, or it is assigned to them. */
  private allowed(ctx: Context, task: UserTask) {
    const { roles, userId } = this.user(ctx);
    return (userId !== null && task.assignee === userId) || task.candidateGroups.some((group) => roles.includes(group));
  }

  private collectionTitle(name: string) {
    const collection = this.plugin.db.getCollection(name);
    return (collection?.options.title as string) || null;
  }

  // The record of the task's business key `<collection>:<id>`; seeing the task lets the user see this record.
  private async findRecord(businessKey: string | null) {
    const [name, id] = splitBusinessKey(businessKey);
    const collection = name ? this.plugin.db.getCollection(name) : null;
    if (!collection || id === null) return null;
    // A key the collection cannot hold, like text for a numeric ID, means no record rather than a broken inbox.
    const record = await this.plugin.db
      .getRepository(name)
      .findOne({ filterByTk: id })
      .catch((): null => null);
    return record ? { collection, record, name, id } : null;
  }

  private async summary(task: UserTask): Promise<TaskRow> {
    const found = await this.findRecord(task.businessKey);
    let record: TaskRecord | null = null;
    if (found) {
      const titleField = (found.collection.options.titleField as string) || found.collection.filterTargetKey || 'id';
      const title = found.record.get(titleField as string);
      record = {
        collection: found.name,
        collectionTitle: this.collectionTitle(found.name),
        id: found.id,
        title: title === null || title === undefined ? null : String(title),
      };
    }
    return {
      id: task.id,
      name: task.name,
      processKey: task.processKey,
      processName: task.processName,
      businessKey: task.businessKey,
      created: task.created,
      record,
    };
  }

  async list(ctx: Context, next: Next) {
    const { roles, userId } = this.user(ctx);
    const tasks = await this.plugin.withEngine(ctx, (engine) =>
      engine.listUserTasks({ candidateGroups: roles, assignee: userId ?? undefined }),
    );
    ctx.body = await Promise.all(tasks.filter((task) => this.allowed(ctx, task)).map((task) => this.summary(task)));
    await next();
  }

  // The task of filterByTk, or a 404 when it is done and a 403 when it is not the user's.
  private async task(ctx: Context) {
    const taskId = String(ctx.action.params.filterByTk || '');
    const task = taskId ? await this.plugin.withEngine(ctx, (engine) => engine.getUserTask(taskId)) : null;
    if (!task) ctx.throw(404, this.plugin.tr(ctx, 'The task is no longer open'));
    if (!this.allowed(ctx, task)) ctx.throw(403, this.plugin.tr(ctx, 'This task is not yours'));
    return task;
  }

  async get(ctx: Context, next: Next) {
    const task = await this.task(ctx);
    const form = await this.plugin.withEngine(ctx, (engine) => engine.getTaskForm(task));
    const found = await this.findRecord(task.businessKey);
    const fields: RecordField[] = [];
    if (found) {
      for (const field of found.collection.fields.values()) {
        const options = field.options as Record<string, any>;
        if (!options.interface || options.hidden || HIDDEN_INTERFACES.includes(options.interface)) continue;
        if (ASSOCIATIONS.includes(field.type)) continue;
        fields.push({
          name: field.name,
          title: options.uiSchema?.title ?? null,
          interface: options.interface,
          value: found.record.get(field.name) ?? null,
        });
      }
    }
    ctx.body = { ...(await this.summary(task)), form, fields };
    await next();
  }

  async complete(ctx: Context, next: Next) {
    const task = await this.task(ctx);
    const form = await this.plugin.withEngine(ctx, (engine) => engine.getTaskForm(task));
    const variables = this.formValues(ctx, form, ctx.action.params.values || {});
    await this.plugin.withEngine(ctx, (engine) => engine.completeUserTask(task.id, variables));
    ctx.body = { id: task.id };
    await next();
  }

  // Only the fields of the task's form go to the engine, each as its type; anything else in the request is dropped.
  private formValues(ctx: Context, form: FormField[], values: Record<string, unknown>): Variables {
    const variables: Variables = {};
    for (const field of form) {
      const value = values[field.id];
      const label = field.label || field.id;
      if (value === undefined || value === null || value === '') {
        if (field.required) ctx.throw(400, this.plugin.tr(ctx, 'Fill in {{label}}', { label }));
        continue;
      }
      const invalid = () => ctx.throw(400, this.plugin.tr(ctx, 'The value of {{label}} is not valid', { label }));
      switch (field.type) {
        case 'boolean':
          if (value !== true && value !== false && value !== 'true' && value !== 'false') invalid();
          variables[field.id] = value === true || value === 'true';
          break;
        case 'long':
          if (!Number.isSafeInteger(Number(value))) invalid();
          variables[field.id] = Number(value);
          break;
        case 'date': {
          const date = new Date(String(value));
          if (Number.isNaN(date.getTime())) invalid();
          variables[field.id] = date.toISOString();
          break;
        }
        case 'enum':
          if (!field.options.some((option) => option.id === String(value))) invalid();
          variables[field.id] = String(value);
          break;
        default:
          variables[field.id] = String(value);
      }
    }
    return variables;
  }
}

export default TaskInbox;
