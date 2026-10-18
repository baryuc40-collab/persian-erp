import type Application from '@nocobase/server';
import type { BelongsToManyRepository, Transaction } from '@nocobase/database';
import { ModuleFile, ModuleRoute } from '../shared/format';
import { checkModuleFile, FileProblem } from '../shared/validate';
import { saveInstalledHash } from './installed-hash';

type Row = Record<string, any>;

// Repositories of optional plugins have no typings here, so they are reached through this shape.
interface UiSchemaRepository {
  insert(schema: Row, options: { transaction: Transaction }): Promise<unknown>;
}
interface FlowModelRepository {
  insertModel(model: Row, options: { transaction: Transaction }): Promise<unknown>;
  upsertModel(model: Row, options: { transaction: Transaction }): Promise<unknown>;
}
interface Registry {
  get(name: string): unknown;
}
interface WorkflowPlugin {
  triggers: Registry;
  instructions: Registry;
}

export type ConflictKind = 'module' | 'collection' | 'role' | 'menu' | 'workflow' | 'uid';

export class ModuleImportError extends Error {
  constructor(
    public readonly problems: FileProblem[],
    public readonly conflicts: { kind: ConflictKind; name: string }[] = [],
  ) {
    super(problems.map((p) => p.message).join('; ') || 'Conflicts');
  }
}

export interface ImportOptions {
  /** Runs inside the transaction after every record is written; tests use it to fail at the last step. */
  beforeCommit?: (transaction: Transaction) => Promise<void>;
}

export const RELATION_TYPES = new Set(['belongsTo', 'hasOne', 'hasMany', 'belongsToMany', 'belongsToArray']);

export const routesOf = (route: ModuleRoute): ModuleRoute[] => [route, ...(route.children || []).flatMap(routesOf)];

const schemaUids = (schema: Row, into: string[] = []) => {
  if (schema?.['x-uid']) into.push(schema['x-uid']);
  for (const key of ['properties', 'definitions', 'patternProperties']) {
    Object.values(schema?.[key] || {}).forEach((child) => schemaUids(child as Row, into));
  }
  if (schema?.items && typeof schema.items === 'object') {
    (Array.isArray(schema.items) ? schema.items : [schema.items]).forEach((child) => schemaUids(child, into));
  }
  return into;
};

const modelUids = (model: Row, into: string[] = []) => {
  if (model?.uid) into.push(model.uid);
  for (const value of Object.values(model?.subModels || {})) {
    (Array.isArray(value) ? value : [value]).forEach((child) => modelUids(child as Row, into));
  }
  return into;
};

// A collection's parents (inherits) are created before it.
function collectionOrder(collections: Row[]) {
  const byName = new Map(collections.map((c) => [c.name, c]));
  const ordered: Row[] = [];
  const seen = new Set<string>();
  const visit = (collection: Row) => {
    if (seen.has(collection.name)) return;
    seen.add(collection.name);
    for (const parent of [].concat(collection.inherits || [])) {
      if (byName.has(parent)) visit(byName.get(parent));
    }
    ordered.push(collection);
  };
  collections.forEach(visit);
  return ordered;
}

/** What an installed module already has; an upgrade of it may reuse these names and uids (decision 0006). */
export interface OwnedNames {
  collections: Set<string>;
  roles: Set<string>;
  workflows: Set<string>;
  uids: Set<string>;
}

/** The names and uids a module file takes on an install. */
export function namesOf(file: ModuleFile): OwnedNames {
  const routeUids = routesOf(file.routes)
    .flatMap((r) => [r.schemaUid, r.menuSchemaUid])
    .filter(Boolean) as string[];
  return {
    collections: new Set(file.collections.map((c) => c.name as string)),
    roles: new Set(file.roles.map((r) => r.name)),
    workflows: new Set(file.workflows.map((w) => w.key)),
    uids: new Set([
      ...routeUids,
      ...file.uiSchemas.flatMap((s) => schemaUids(s)),
      ...file.flowModels.flatMap((m) => modelUids(m)),
      ...file.flowModelTemplates.map((t) => t.uid as string),
    ]),
  };
}

/**
 * Checks the file and the install before anything is written. Throws ModuleImportError with every problem found.
 * For an upgrade, `owned` holds what the installed module has, which is not a conflict.
 */
export async function checkImport(app: Application, file: ModuleFile, owned?: OwnedNames) {
  const db = app.db;
  const { errors, warnings } = checkModuleFile(file, app.getVersion());
  if (errors.length) throw new ModuleImportError(errors);

  const problems: FileProblem[] = [];
  for (const name of file.requires?.collections || []) {
    if (!db.getCollection(name)) {
      problems.push({ message: 'This install has no collection named {{name}}', values: { name } });
    }
  }
  for (const type of file.requires?.fieldTypes || []) {
    if (!db.fieldTypes.has(type)) {
      problems.push({ message: 'This install has no field type {{name}}', values: { name: type } });
    }
  }
  const workflow = (app.pm.get('workflow') as unknown) as WorkflowPlugin;
  if (file.workflows.length && !workflow) {
    problems.push({ message: 'The workflow plugin is not enabled' });
  }
  for (const type of workflow ? file.requires?.workflowTriggers || [] : []) {
    if (!workflow.triggers.get(type)) {
      problems.push({ message: 'This install has no workflow trigger {{name}}', values: { name: type } });
    }
  }
  for (const type of workflow ? file.requires?.workflowInstructions || [] : []) {
    if (!workflow.instructions.get(type)) {
      problems.push({ message: 'This install has no workflow node type {{name}}', values: { name: type } });
    }
  }
  for (const name of ['uiSchemas', 'flowModels', 'flowModelTemplates']) {
    if (file[name].length && !db.getCollection(name)) {
      problems.push({ message: 'The plugin that stores {{name}} is not enabled', values: { name } });
    }
  }
  if (hasLayouts(app)) {
    const wanted = [...new Set(routesOf(file.routes).flatMap((r) => (r.uiLayouts as string[]) || []))];
    const found = wanted.length
      ? (await db.getRepository('uiLayouts').find({ filter: { uid: { $in: wanted } } })).map((l) => l.get('uid'))
      : [];
    for (const uid of wanted.filter((uid) => !found.includes(uid)).sort()) {
      problems.push({ message: 'This install has no UI layout {{name}}', values: { name: uid } });
    }
  }
  if (problems.length) throw new ModuleImportError(problems);

  const conflicts: { kind: ConflictKind; name: string }[] = [];
  const mine = (set: keyof OwnedNames, name: string) => !!owned?.[set].has(name);
  const existing = async (collection: string, field: string, values: string[]) => {
    if (!values.length || !db.getCollection(collection)) return [];
    const rows = await db.getRepository(collection).find({ filter: { [field]: { $in: values } }, fields: [field] });
    return [...new Set(rows.map((row) => String(row.get(field))))].sort();
  };
  if (!owned && (await db.getRepository('erpModules').findOne({ filterByTk: file.module.key }))) {
    conflicts.push({ kind: 'module', name: file.module.key });
  }
  const collectionNames = file.collections.map((c) => c.name as string).filter((name) => !mine('collections', name));
  for (const name of collectionNames.filter((name) => db.getCollection(name)).sort()) {
    conflicts.push({ kind: 'collection', name });
  }
  for (const name of await existing('collections', 'name', collectionNames)) {
    if (!conflicts.some((c) => c.kind === 'collection' && c.name === name))
      conflicts.push({ kind: 'collection', name });
  }
  for (const name of await existing(
    'roles',
    'name',
    file.roles.map((r) => r.name).filter((name) => !mine('roles', name)),
  )) {
    conflicts.push({ kind: 'role', name });
  }
  // A group with the same title, other than the module's own group when it is upgraded.
  const sameGroup = await db.getRepository('desktopRoutes').findOne({
    filter: {
      parentId: null,
      type: 'group',
      title: file.routes.title,
      ...(owned ? { schemaUid: { $notIn: [...owned.uids] } } : {}),
    },
  });
  if (sameGroup) conflicts.push({ kind: 'menu', name: String(file.routes.title) });
  for (const key of await existing(
    'workflows',
    'key',
    file.workflows.map((w) => w.key).filter((key) => !mine('workflows', key)),
  )) {
    conflicts.push({ kind: 'workflow', name: key });
  }
  const routeUids = routesOf(file.routes)
    .flatMap((r) => [r.schemaUid, r.menuSchemaUid])
    .filter(Boolean) as string[];
  const uids = [
    ...(await existing('desktopRoutes', 'schemaUid', routeUids)),
    ...(await existing(
      'uiSchemas',
      'x-uid',
      file.uiSchemas.flatMap((s) => schemaUids(s)),
    )),
    // A route makes a flowModels row with its schemaUid, so those uids must be free there too.
    ...(await existing('flowModels', 'uid', [...file.flowModels.flatMap((m) => modelUids(m)), ...routeUids])),
    ...(await existing(
      'flowModelTemplates',
      'uid',
      file.flowModelTemplates.map((t) => t.uid as string),
    )),
  ];
  for (const uid of [...new Set(uids)].filter((uid) => !mine('uids', uid)).sort())
    conflicts.push({ kind: 'uid', name: uid });
  if (conflicts.length) {
    throw new ModuleImportError([{ message: 'The module conflicts with what this install already has' }], conflicts);
  }
  return { warnings };
}

export async function importCollections(app: Application, file: ModuleFile, transaction: Transaction) {
  const db = app.db;
  const fieldsOf = new Map(file.collections.map((c) => [c.name as string, (c.fields as Row[]) || []]));
  const ordered = collectionOrder(file.collections);
  for (const collection of ordered) {
    const { fields = [], ...values } = collection as Row;
    await db.getRepository('collections').create({
      values: { ...values, fields: fields.filter((f) => !RELATION_TYPES.has(f.type)).map(fieldValues) },
      context: {},
      transaction,
    });
  }
  // Relation fields once both ends exist; a pair of reverse fields is created once, from its first side.
  const done = new Set<string>();
  for (const collection of ordered) {
    for (const field of fieldsOf.get(collection.name as string).filter((f) => RELATION_TYPES.has(f.type))) {
      const id = `${collection.name}.${field.name}`;
      if (done.has(id)) continue;
      done.add(id);
      const values: Row = { ...fieldValues(field), collectionName: collection.name };
      const reverse = field.reverseFieldName
        ? (fieldsOf.get(field.target) || []).find((f) => f.name === field.reverseFieldName)
        : null;
      if (reverse) {
        done.add(`${field.target}.${reverse.name}`);
        values.reverseField = fieldValues(reverse);
      }
      await db.getRepository('fields').create({ values, context: {}, transaction });
    }
  }
}

export const fieldValues = (field: Row) => {
  const { reverseFieldName, ...values } = field;
  return values;
};

async function importRoles(app: Application, file: ModuleFile, transaction: Transaction) {
  for (const role of file.roles) {
    const { resources, scopes, routes, ...values } = role;
    await app.db.getRepository('roles').create({ values, transaction });
    await createRoleResources(app, role, transaction);
  }
}

/** The permissions of a module role on module collections, with the data scopes they use. */
export async function createRoleResources(
  app: Application,
  role: ModuleFile['roles'][number],
  transaction: Transaction,
) {
  const db = app.db;
  const { resources, scopes } = role;
  const scopeIds = new Map<string, unknown>();
  for (const scope of scopes) {
    const found = await db
      .getRepository('dataSourcesRolesResourcesScopes')
      .findOne({ filter: { key: scope.key }, transaction });
    const record =
      found ||
      (await db.getRepository('dataSourcesRolesResourcesScopes').create({
        values: { ...scope, dataSourceKey: 'main' },
        transaction,
      }));
    scopeIds.set(scope.key, record.get('id'));
  }
  for (const resource of resources) {
    await db.getRepository('dataSourcesRolesResources').create({
      values: {
        roleName: role.name,
        dataSourceKey: 'main',
        name: resource.name,
        usingActionsConfig: resource.usingActionsConfig,
        actions: resource.actions.map((action) => ({
          name: action.name,
          fields: action.fields,
          scopeId: action.scope ? scopeIds.get(action.scope) ?? null : null,
        })),
      },
      transaction,
    });
  }
}

/**
 * Creates the workflows of a file, disabled. With `current`, each becomes the current version of its key and the
 * previous current version is turned off, as plugin-workflow does for a revision (decision 0006).
 */
export async function importWorkflows(
  app: Application,
  file: Pick<ModuleFile, 'workflows'>,
  transaction: Transaction,
  extra: { current?: boolean } = {},
) {
  const db = app.db;
  const created: { id: unknown; enabled: boolean }[] = [];
  for (const workflow of file.workflows) {
    const { nodes, enabled, ...values } = workflow;
    // Enabled after commit: a trigger registers itself in memory at once and would survive a rollback.
    const record = await db
      .getRepository('workflows')
      .create({ values: { ...values, ...extra, enabled: false }, transaction });
    created.push({ id: record.get('id'), enabled });
    const ids = new Map<string, unknown>();
    for (const node of nodes) {
      const { upstream, downstream, ...nodeValues } = node;
      const row = await db
        .getRepository('flow_nodes')
        .create({ values: { ...nodeValues, workflowId: record.get('id') }, transaction });
      ids.set(node.key, row.get('id'));
    }
    for (const node of nodes) {
      await db.getRepository('flow_nodes').update({
        filterByTk: ids.get(node.key) as string,
        values: {
          upstreamId: node.upstream ? ids.get(node.upstream) : null,
          downstreamId: node.downstream ? ids.get(node.downstream) : null,
        },
        transaction,
      });
    }
  }
  return created;
}

// plugin-ui-layout lists a route only in the layouts it is linked to; routes from a file without layouts go to the
// admin layout, where a route made in the UI lands too.
export const DEFAULT_LAYOUT = 'admin-layout-model';
export const hasLayouts = (app: Application) => !!app.db.getCollection('desktopRoutes')?.getField('uiLayouts');

async function importRoutes(app: Application, file: ModuleFile, transaction: Transaction) {
  const ids = new Map<string, unknown>();
  const layouts = hasLayouts(app);
  const create = async (route: ModuleRoute, parentId: unknown) => {
    const { ref, children, uiLayouts, ...values } = route;
    if (layouts) {
      values.uiLayouts = Array.isArray(uiLayouts) && uiLayouts.length ? uiLayouts : [DEFAULT_LAYOUT];
    }
    const record = await app.db
      .getRepository('desktopRoutes')
      .create({ values: { ...values, parentId: parentId ?? null }, transaction });
    ids.set(ref, record.get('id'));
    for (const child of children || []) {
      await create(child, record.get('id'));
    }
  };
  await create(file.routes, null);
  return ids;
}

export async function importPages(
  app: Application,
  file: ModuleFile,
  routeIds: Map<string, unknown>,
  transaction: Transaction,
) {
  const db = app.db;
  const routeIdByUid = new Map<string, unknown>();
  for (const route of routesOf(file.routes)) {
    if (route.schemaUid) routeIdByUid.set(route.schemaUid as string, routeIds.get(route.ref));
  }
  for (const schema of file.uiSchemas) {
    await ((db.getRepository('uiSchemas') as unknown) as UiSchemaRepository).insert(schema, { transaction });
  }
  for (const template of file.flowModelTemplates) {
    await db.getRepository('flowModelTemplates').create({ values: template, transaction });
  }
  const models = (db.getRepository('flowModels') as unknown) as FlowModelRepository;
  for (const model of file.flowModels) {
    const routeId = model.parentId ? routeIdByUid.get(model.parentId as string) : undefined;
    // The page stores the id of its route, which is new on this install.
    const values =
      model.use === 'RootPageModel' && routeId !== undefined
        ? { ...model, props: { ...((model.props as Row) || {}), routeId } }
        : model;
    if (model.parentId) {
      await models.upsertModel(values, { transaction });
    } else {
      await models.insertModel(values, { transaction });
    }
  }
  // plugin-ui-templates records most usages itself when a model is saved; the rest are added here.
  if (db.getCollection('flowModelTemplateUsages')) {
    const usages = db.getRepository('flowModelTemplateUsages');
    for (const usage of file.flowModelTemplateUsages || []) {
      if (!(await usages.findOne({ filter: usage, transaction }))) {
        await usages.create({ values: usage, transaction });
      }
    }
  }
}

/** Imports a module file in one transaction; see section 5 of docs/decisions/0005-erp-module-format.md. */
export async function importModule(app: Application, file: ModuleFile, options: ImportOptions = {}) {
  const db = app.db;
  const { warnings } = await checkImport(app, file);
  const transaction = await db.sequelize.transaction();
  let workflows: { id: unknown; enabled: boolean }[] = [];
  try {
    await importCollections(app, file, transaction);
    await importRoles(app, file, transaction);
    workflows = await importWorkflows(app, file, transaction);
    const routeIds = await importRoutes(app, file, transaction);
    await importPages(app, file, routeIds, transaction);
    for (const role of file.roles) {
      const tk = role.routes.map((ref) => routeIds.get(ref)).filter((id) => id !== undefined) as string[];
      await db.getRepository<BelongsToManyRepository>('roles.desktopRoutes', role.name).set({ tk, transaction });
    }
    for (const [collection, records] of Object.entries(file.data || {})) {
      if (file.collections.some((c) => c.name === collection)) {
        await db.getRepository(collection).create({ values: records, transaction });
      }
    }
    await db.getRepository('erpModules').create({
      values: {
        key: file.module.key,
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
    // The rollback undoes the tables, not what the app loaded into memory on the way.
    for (const collection of file.collections) {
      if (db.hasCollection(collection.name as string)) db.removeCollection(collection.name as string);
    }
    for (const role of file.roles) {
      app.acl.removeRole(role.name);
    }
    throw error;
  }
  for (const workflow of workflows.filter((w) => w.enabled)) {
    await db.getRepository('workflows').update({ filterByTk: workflow.id as string, values: { enabled: true } });
  }
  await saveInstalledHash(app, file.module.key);
  return {
    key: file.module.key,
    title: file.module.title,
    warnings,
    collections: file.collections.map((c) => c.name as string),
    workflows: file.workflows.map((w) => w.key),
    roles: file.roles.map((r) => r.name),
  };
}
