import type { BelongsToManyRepository, Transaction } from '@nocobase/database';
import type Application from '@nocobase/server';
import { canonicalize, ModuleFile, ModuleRoute, ModuleWorkflow } from '../shared/format';
import { compareVersions, FileProblem } from '../shared/validate';
import { exportModule, ModuleRow, readModuleRecords } from './exporter';
import { moduleHash, saveInstalledHash } from './installed-hash';
import {
  checkImport,
  createRoleResources,
  DEFAULT_LAYOUT,
  fieldValues,
  hasLayouts,
  importCollections,
  importPages,
  importWorkflows,
  ModuleImportError,
  namesOf,
  RELATION_TYPES,
  routesOf,
} from './importer';

type Row = Record<string, any>;

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

const same = (a: unknown, b: unknown) => JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
const byName = <T extends Row>(items: T[], key = 'name') => new Map(items.map((item) => [item[key] as string, item]));

// What makes two versions of a workflow different (section 2 of decision 0006).
const workflowShape = (workflow: ModuleWorkflow) => ({
  type: workflow.type,
  title: workflow.title,
  description: workflow.description ?? null,
  sync: !!workflow.sync,
  options: workflow.options ?? {},
  config: workflow.config ?? {},
  nodes: [...(workflow.nodes || [])]
    .map((node) => ({
      key: node.key,
      type: node.type,
      title: node.title ?? null,
      config: node.config ?? {},
      upstream: node.upstream ?? null,
      downstream: node.downstream ?? null,
      branchIndex: node.branchIndex ?? null,
    }))
    .sort((p, q) => (p.key < q.key ? -1 : 1)),
});

// Field options an upgrade writes on an existing field: everything but what names it.
const fieldUpdate = (field: Row) => {
  const { name, type, collectionName, key, ...values } = fieldValues(field);
  return values;
};

// NocoBase writes the default sourceKey ("id") on a relation created from full values, as the import does; a file
// made elsewhere may not have it, and the field is the same either way.
const fieldShape = ({ sourceKey, ...field }: Row) => (sourceKey === 'id' ? field : { ...field, sourceKey });

/** Every change an upgrade makes, for the preview and for the upgrade itself. */
export interface UpgradePlan {
  key: string;
  title: string;
  from: string;
  to: string;
  localChanges: boolean;
  collections: { added: string[]; updated: string[]; kept: string[] };
  fields: { added: string[]; updated: string[]; kept: string[] };
  routes: { added: string[]; updated: string[]; removed: string[] };
  workflows: { added: string[]; revised: string[]; disabled: string[] };
  roles: { added: string[]; updated: string[]; kept: string[] };
}

/** Compares the installed module with the file and checks the upgrade can be made (section 1 of decision 0006). */
export async function planUpgrade(app: Application, row: ModuleRow, file: ModuleFile) {
  // The checks of an import, where what the installed module has is not a conflict.
  const current = await exportModule(app, row);
  const { warnings } = await checkImport(app, file, namesOf(current));

  const problems: FileProblem[] = [];
  if (file.module.key !== row.key) {
    problems.push({ message: 'The file is module {{name}}, not this module', values: { name: file.module.key } });
  }
  const order = compareVersions(file.module.version, row.version);
  if (order === null) {
    problems.push({
      message: 'The module version {{version}} is not of the form 1.2.3',
      values: { version: file.module.version },
    });
  } else if (order <= 0) {
    problems.push({
      message: 'Version {{version}} of the module is installed; the file has version {{fileVersion}}',
      values: { version: row.version, fileVersion: file.module.version },
    });
  }

  const plan: UpgradePlan = {
    key: row.key,
    title: file.module.title,
    from: row.version,
    to: file.module.version,
    localChanges: !!(row as Row).installedHash && (row as Row).installedHash !== moduleHash(current),
    collections: { added: [], updated: [], kept: [] },
    fields: { added: [], updated: [], kept: [] },
    routes: { added: [], updated: [], removed: [] },
    workflows: { added: [], revised: [], disabled: [] },
    roles: { added: [], updated: [], kept: [] },
  };

  const installedCollections = byName(current.collections as Row[]);
  const nextCollections = byName(file.collections as Row[]);
  for (const [name, next] of nextCollections) {
    const installed = installedCollections.get(name);
    if (!installed) {
      plan.collections.added.push(name);
      continue;
    }
    const { fields: nextFields = [], ...nextOptions } = next;
    const { fields: installedFields = [], ...installedOptions } = installed;
    if (!same(nextOptions, installedOptions)) plan.collections.updated.push(name);
    const installedByName = byName(installedFields as Row[]);
    for (const field of nextFields as Row[]) {
      const before = installedByName.get(field.name);
      const path = `${name}.${field.name}`;
      if (!before) plan.fields.added.push(path);
      else if (before.type !== field.type) {
        problems.push({
          message: 'The field {{name}} changes its type from {{from}} to {{to}}',
          values: { name: path, from: before.type, to: field.type },
        });
      } else if (!same(fieldShape(before), fieldShape(field))) plan.fields.updated.push(path);
    }
    const nextNames = new Set((nextFields as Row[]).map((f) => f.name));
    for (const field of installedFields as Row[]) {
      if (!nextNames.has(field.name)) plan.fields.kept.push(`${name}.${field.name}`);
    }
  }
  plan.collections.kept = [...installedCollections.keys()].filter((name) => !nextCollections.has(name));

  const installedRoutes = new Map(routesOf(current.routes).map((r) => [r.schemaUid as string, r]));
  const nextRoutes = routesOf(file.routes);
  for (const route of nextRoutes) {
    const before = installedRoutes.get(route.schemaUid as string);
    if (!route.schemaUid || !before) plan.routes.added.push(String(route.title || route.ref));
    else if (!same({ ...before, children: undefined }, { ...route, children: undefined })) {
      plan.routes.updated.push(String(route.title || route.ref));
    }
  }
  const nextRouteUids = new Set(nextRoutes.map((r) => r.schemaUid).filter(Boolean));
  plan.routes.removed = [...installedRoutes.values()]
    .filter((r) => r.schemaUid && !nextRouteUids.has(r.schemaUid))
    .map((r) => String(r.title || r.ref));

  const installedWorkflows = byName(current.workflows, 'key');
  for (const workflow of file.workflows) {
    const before = installedWorkflows.get(workflow.key);
    if (!before) plan.workflows.added.push(workflow.key);
    else if (!same(workflowShape(before), workflowShape(workflow))) plan.workflows.revised.push(workflow.key);
  }
  const nextWorkflowKeys = new Set(file.workflows.map((w) => w.key));
  plan.workflows.disabled = current.workflows
    .filter((w) => !nextWorkflowKeys.has(w.key) && w.enabled)
    .map((w) => w.key);

  const installedRoles = byName(current.roles);
  for (const role of file.roles) {
    const before = installedRoles.get(role.name);
    if (!before) plan.roles.added.push(role.name);
    else if (!same(before, role)) plan.roles.updated.push(role.name);
  }
  const nextRoleNames = new Set(file.roles.map((r) => r.name));
  plan.roles.kept = current.roles.filter((r) => !nextRoleNames.has(r.name)).map((r) => r.name);

  if (problems.length) throw new ModuleImportError(problems);
  return { plan, current, warnings };
}

async function upgradeCollections(
  app: Application,
  plan: UpgradePlan,
  current: ModuleFile,
  file: ModuleFile,
  transaction: Transaction,
) {
  const db = app.db;
  const added = new Set(plan.collections.added);
  await importCollections(
    app,
    { ...file, collections: file.collections.filter((c) => added.has(c.name as string)) },
    transaction,
  );
  const installed = byName(current.collections as Row[]);
  for (const next of file.collections as Row[]) {
    if (added.has(next.name)) continue;
    const { fields = [], name, ...options } = next;
    if (plan.collections.updated.includes(name)) {
      await db.getRepository('collections').update({ filterByTk: name, values: options, transaction });
    }
    const before = byName((installed.get(name)?.fields as Row[]) || []);
    // Plain fields first, then relations, whose targets may be collections added above.
    const ordered = [...fields].sort((a, b) => Number(RELATION_TYPES.has(a.type)) - Number(RELATION_TYPES.has(b.type)));
    for (const field of ordered as Row[]) {
      const path = `${name}.${field.name}`;
      if (plan.fields.added.includes(path)) {
        await db
          .getRepository('fields')
          .create({ values: { ...fieldValues(field), collectionName: name }, context: {}, transaction });
      } else if (plan.fields.updated.includes(path) && before.has(field.name)) {
        await db.getRepository('fields').update({
          filter: { collectionName: name, name: field.name },
          values: fieldUpdate(field),
          transaction,
        });
      }
    }
  }
}

async function upgradeRoles(
  app: Application,
  plan: UpgradePlan,
  current: ModuleFile,
  file: ModuleFile,
  transaction: Transaction,
) {
  const db = app.db;
  const collections = [...new Set([...current.collections, ...file.collections].map((c) => c.name as string))];
  for (const role of file.roles) {
    const { resources, scopes, routes, name, ...values } = role;
    if (plan.roles.added.includes(name)) {
      await db.getRepository('roles').create({ values: { name, ...values }, transaction });
    } else if (plan.roles.updated.includes(name)) {
      // Its permissions on module collections are written again from the file; others are not the module's.
      await db.getRepository('roles').update({ filterByTk: name, values, transaction });
      await db.getRepository('dataSourcesRolesResources').destroy({
        filter: { roleName: name, dataSourceKey: 'main', name: { $in: collections } },
        transaction,
      });
    } else {
      continue;
    }
    await createRoleResources(app, role, transaction);
  }
}

// Routes keep their ids, so the menus that roles outside the module see stay theirs.
async function upgradeRoutes(app: Application, current: ModuleFile, file: ModuleFile, transaction: Transaction) {
  const db = app.db;
  const repository = db.getRepository('desktopRoutes');
  const layouts = hasLayouts(app);
  const ids = new Map<string, unknown>();
  const write = async (route: ModuleRoute, parentId: unknown, sort?: number) => {
    const { ref, children, uiLayouts, ...values } = route;
    if (layouts) values.uiLayouts = Array.isArray(uiLayouts) && uiLayouts.length ? uiLayouts : [DEFAULT_LAYOUT];
    // Children take the order of the file; the group keeps its place among the other menus.
    if (sort !== undefined) values.sort = sort;
    // The group is the module's own menu even when a new build of the module gave it another schemaUid, so it keeps
    // its record, and the menus of roles outside the module that link to it.
    const existing =
      parentId === null
        ? await repository.findOne({ filter: { schemaUid: current.routes.schemaUid }, transaction })
        : route.schemaUid
        ? await repository.findOne({ filter: { schemaUid: route.schemaUid }, transaction })
        : null;
    let id: unknown;
    if (existing) {
      id = existing.get('id');
      await repository.update({
        filterByTk: id as string,
        values: { ...values, parentId: parentId ?? null },
        transaction,
      });
    } else {
      id = (await repository.create({ values: { ...values, parentId: parentId ?? null }, transaction })).get('id');
    }
    ids.set(ref, id);
    let index = 0;
    for (const child of children || []) await write(child, id, ++index);
  };
  // Read before writing, since the group may take a new schemaUid.
  const installed = await repository.find({
    filter: {
      schemaUid: {
        $in: routesOf(current.routes)
          .map((r) => r.schemaUid)
          .filter(Boolean),
      },
    },
    transaction,
  });
  await write(file.routes, null);

  // Routes the new version no longer has, and links (which have no schemaUid), children first.
  const kept = new Set([...ids.values()].map(String));
  const below = async (parents: unknown[]): Promise<Row[]> => {
    if (!parents.length) return [];
    const children = (await repository.find({ filter: { parentId: { $in: parents } }, transaction })).map((r) =>
      r.toJSON(),
    );
    return [...(await below(children.map((r) => r.id))), ...children];
  };
  const all = [...(await below(installed.map((r) => r.get('id')))), ...installed.map((r) => r.toJSON())];
  const seen = new Set<string>();
  for (const route of all) {
    const id = String(route.id);
    if (kept.has(id) || seen.has(id)) continue;
    seen.add(id);
    await repository.destroy({ filterByTk: route.id, transaction });
  }
  return ids;
}

async function upgradePages(
  app: Application,
  current: ModuleFile,
  file: ModuleFile,
  routeIds: Map<string, unknown>,
  transaction: Transaction,
) {
  const db = app.db;
  const records = { flowModels: current.flowModels as Row[], uiSchemas: current.uiSchemas as Row[] };
  for (const model of records.flowModels) {
    await ((db.getRepository('flowModels') as unknown) as TreeRepository).remove(model.uid, { transaction });
  }
  for (const schema of records.uiSchemas) {
    await ((db.getRepository('uiSchemas') as unknown) as TreeRepository).remove(schema['x-uid'], { transaction });
  }
  const nextTemplates = new Set(file.flowModelTemplates.map((t) => t.uid as string));
  const templates = db.getCollection('flowModelTemplates') ? db.getRepository('flowModelTemplates') : null;
  for (const template of current.flowModelTemplates) {
    const uid = template.uid as string;
    const usages = db.getCollection('flowModelTemplateUsages')
      ? await db.getRepository('flowModelTemplateUsages').count({ filter: { templateUid: uid }, transaction })
      : 0;
    // A template still used by a page outside the module stays, and is updated if the file has it.
    if (!nextTemplates.has(uid) && !usages) await templates.destroy({ filterByTk: uid, transaction });
  }
  const created: Row[] = [];
  for (const template of file.flowModelTemplates) {
    if (await templates.findOne({ filterByTk: template.uid as string, transaction })) {
      await templates.update({ filterByTk: template.uid as string, values: template, transaction });
    } else {
      created.push(template);
    }
  }
  await importPages(app, { ...file, flowModelTemplates: created }, routeIds, transaction);
}

export interface UpgradeOptions {
  /** Runs inside the transaction after every record is written; tests use it to fail at the last step. */
  beforeCommit?: (transaction: Transaction) => Promise<void>;
}

/** Upgrades an installed module to the version in the file, in one transaction (section 4 of decision 0006). */
export async function upgradeModule(app: Application, row: ModuleRow, file: ModuleFile, options: UpgradeOptions = {}) {
  const db = app.db;
  const { plan, current, warnings } = await planUpgrade(app, row, file);
  const records = await readModuleRecords(app, row);
  const turnedOff = records.workflows.filter((w) => w.enabled).map((w) => w.id);
  const transaction = await db.sequelize.transaction();
  let created: { id: unknown; enabled: boolean }[] = [];
  try {
    await upgradeCollections(app, plan, current, file, transaction);
    await upgradeRoles(app, plan, current, file, transaction);
    const changed = new Set([...plan.workflows.added, ...plan.workflows.revised]);
    created = await importWorkflows(app, { workflows: file.workflows.filter((w) => changed.has(w.key)) }, transaction, {
      current: true,
    });
    if (plan.workflows.disabled.length) {
      await db.getRepository('workflows').update({
        filter: { key: { $in: plan.workflows.disabled }, current: true },
        values: { enabled: false },
        transaction,
      });
    }
    const routeIds = await upgradeRoutes(app, current, file, transaction);
    await upgradePages(app, current, file, routeIds, transaction);
    for (const role of file.roles) {
      const tk = role.routes.map((ref) => routeIds.get(ref)).filter((id) => id !== undefined) as string[];
      await db.getRepository<BelongsToManyRepository>('roles.desktopRoutes', role.name).set({ tk, transaction });
    }
    await db.getRepository('erpModules').update({
      filterByTk: row.key,
      values: {
        title: file.module.title,
        version: file.module.version,
        description: file.module.description,
        groupSchemaUid: file.routes.schemaUid,
      },
      transaction,
    });
    await options.beforeCommit?.(transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    // The rollback brings the rows back, not what hooks changed in memory on the way (decision 0006, section 4).
    for (const name of plan.collections.added) if (db.hasCollection(name)) db.removeCollection(name);
    // Loading a collection again sets the fields it has in the database, but leaves the ones it no longer has.
    for (const path of plan.fields.added) {
      const [collection, field] = path.split('.');
      db.getCollection(collection)?.removeField(field);
    }
    const existing = file.collections
      .map((c) => c.name as string)
      .filter((name) => !plan.collections.added.includes(name));
    await ((db.getRepository('collections') as unknown) as CollectionRepository).load({
      filter: { name: { $in: existing } },
    });
    for (const name of plan.roles.added) app.acl.removeRole(name);
    const acl = (app.pm.get('acl') as unknown) as AclPlugin;
    for (const role of await db.getRepository('roles').find({
      filter: { name: { $in: plan.roles.updated } },
      appends: ['resources', 'resources.actions'],
    })) {
      await acl.writeRoleToACL(role);
    }
    // Turned off and on again: an update that changes nothing would not start the trigger.
    for (const id of turnedOff) {
      await db.getRepository('workflows').update({ filterByTk: id, values: { enabled: false } });
      await db.getRepository('workflows').update({ filterByTk: id, values: { enabled: true } });
    }
    throw error;
  }
  for (const workflow of created.filter((w) => w.enabled)) {
    await db.getRepository('workflows').update({ filterByTk: workflow.id as string, values: { enabled: true } });
  }
  await saveInstalledHash(app, row.key);
  return { plan, warnings };
}
