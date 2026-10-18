import type { Transaction } from '@nocobase/database';
import type Application from '@nocobase/server';
import { buildModuleFile, ModuleRecords } from '../shared/build';
import { summarizeModule } from '../shared/summary';
import { ModuleRow, readModuleRecords } from './exporter';

type Row = Record<string, any>;

export class ModuleRemoveError extends Error {}

// Repositories of optional plugins have no typings here, so they are reached through these shapes.
interface TreeRepository {
  remove(uid: string, options: { transaction: Transaction }): Promise<void>;
}
interface CollectionRepository {
  load(options: { filter: Record<string, unknown> }): Promise<void>;
}
interface AclPlugin {
  writeRoleToACL(role: unknown, options?: { transaction?: Transaction }): Promise<void>;
}

/** What removing a module takes away, counted for the preview. */
export interface RemovalPlan {
  key: string;
  title: string;
  version: string;
  collections: { name: string; title: string; records: number }[];
  pages: { title: string; type: string }[];
  workflows: { key: string; title: string; versions: number }[];
  roles: { name: string; title: string; users: number }[];
}

/** Reads a module the way an export does and counts the records its removal deletes. */
export async function planRemoval(app: Application, row: ModuleRow) {
  const db = app.db;
  const records = await readModuleRecords(app, row);
  const summary = summarizeModule(buildModuleFile(records));
  const plan: RemovalPlan = {
    key: row.key,
    title: row.title,
    version: row.version,
    collections: [],
    pages: summary.pages,
    workflows: [],
    roles: [],
  };
  for (const collection of records.collections) {
    const records = db.getCollection(collection.name) ? await db.getRepository(collection.name).count() : 0;
    plan.collections.push({ name: collection.name, title: collection.title, records });
  }
  for (const workflow of records.workflows) {
    const versions = await db.getRepository('workflows').count({ filter: { key: workflow.key } });
    plan.workflows.push({ key: workflow.key, title: workflow.title, versions });
  }
  for (const role of records.roles) {
    const users = await db.getRepository('rolesUsers').count({ filter: { roleName: role.name } });
    plan.roles.push({ name: role.name, title: role.title, users });
  }
  return { plan, records };
}

// Children before their parents, so that no route is left without its parent on the way.
const deepestFirst = (routes: Row[]) => {
  const parentOf = new Map(routes.map((route) => [String(route.id), route.parentId ? String(route.parentId) : null]));
  const depth = (id: string) => {
    let count = 0;
    for (let parent = parentOf.get(id); parent && parentOf.has(parent); parent = parentOf.get(parent)) count++;
    return count;
  };
  return [...routes].sort((a, b) => depth(String(b.id)) - depth(String(a.id)));
};

async function removeRecords(app: Application, records: ModuleRecords, transaction: Transaction) {
  const db = app.db;
  const has = (name: string) => !!db.getCollection(name);

  // Every version of each workflow, as workflows:destroy does for a current version.
  const workflowKeys = records.workflows.map((workflow) => workflow.key);
  if (workflowKeys.length) {
    await db.getRepository('workflows').destroy({ filter: { key: { $in: workflowKeys } }, transaction });
    if (has('workflowStats')) {
      await db.getRepository('workflowStats').destroy({ filter: { key: { $in: workflowKeys } }, transaction });
    }
  }

  // Pages, then the templates they used. Removing a route removes its own models too (plugin-client).
  for (const model of records.flowModels) {
    await (db.getRepository('flowModels') as unknown as TreeRepository).remove(model.uid, { transaction });
  }
  for (const schema of records.uiSchemas) {
    await (db.getRepository('uiSchemas') as unknown as TreeRepository).remove(schema['x-uid'], { transaction });
  }
  const templateUids = records.flowModelTemplates.map((template) => template.uid);
  if (templateUids.length) {
    if (has('flowModelTemplateUsages')) {
      await db
        .getRepository('flowModelTemplateUsages')
        .destroy({ filter: { templateUid: { $in: templateUids } }, transaction });
    }
    await db.getRepository('flowModelTemplates').destroy({ filterByTk: templateUids, transaction });
  }
  for (const route of deepestFirst(records.routes)) {
    await db.getRepository('desktopRoutes').destroy({ filterByTk: route.id, transaction });
  }

  // Users keep their account; only the link to a module role goes with the role.
  const roleNames = records.roles.map((role) => role.name);
  if (roleNames.length) await db.getRepository('roles').destroy({ filterByTk: roleNames, transaction });

  // Dropping a collection also removes the relation fields of other collections that point to it.
  for (const collection of records.collections) {
    const model = await db.getRepository('collections').findOne({ filterByTk: collection.name, transaction });
    if (model) await model.destroy({ transaction, cascade: true } as { transaction: Transaction });
  }

  await db.getRepository('erpModules').destroy({ filterByTk: records.module.key, transaction });
}

/**
 * Removes a module and everything it holds in one transaction; see section 5 of
 * docs/decisions/0006-erp-module-upgrade.md. `confirm` must be the module key.
 */
export async function removeModule(
  app: Application,
  row: ModuleRow,
  confirm: unknown,
  options: { beforeCommit?: (transaction: Transaction) => Promise<void> } = {},
) {
  if (confirm !== row.key) throw new ModuleRemoveError('Type the module key to confirm the deletion');
  const db = app.db;
  const { plan, records } = await planRemoval(app, row);
  const enabled = records.workflows.filter((workflow) => workflow.enabled).map((workflow) => workflow.id);
  const transaction = await db.sequelize.transaction();
  try {
    await removeRecords(app, records, transaction);
    await options.beforeCommit?.(transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    // The rollback brings the rows back, not what hooks took out of memory on the way: collections, roles in the
    // ACL and the triggers of enabled workflows.
    const names = records.collections.map((collection) => collection.name);
    await ((db.getRepository('collections') as unknown) as CollectionRepository).load({
      filter: { name: { $in: names } },
    });
    const acl = app.pm.get('acl') as unknown as AclPlugin;
    for (const role of await db.getRepository('roles').find({
      filter: { name: { $in: records.roles.map((r) => r.name) } },
      appends: ['resources', 'resources.actions'],
    })) {
      await acl.writeRoleToACL(role);
    }
    // Turned off and on again: an update that changes nothing would not start the trigger.
    for (const id of enabled) {
      await db.getRepository('workflows').update({ filterByTk: id, values: { enabled: false } });
      await db.getRepository('workflows').update({ filterByTk: id, values: { enabled: true } });
    }
    throw error;
  }
  return plan;
}
