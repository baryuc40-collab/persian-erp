import type Application from '@nocobase/server';
import type { Model } from '@nocobase/database';
import { buildModuleFile, ModuleExportError, ModuleRecords } from '../shared/build';
import { collectionFromConfig, collectRefs, emptyRefs, ModuleFile, ModuleInfo, modulePrefix } from '../shared/format';

type Row = Record<string, any>;

const json = (record: Model | null): Row | null => (record ? record.toJSON() : null);

// Repositories of optional plugins have no typings here, so they are reached through this shape.
interface UiSchemaRepository {
  getJsonSchema(uid: string, options: { includeAsyncNode: boolean }): Promise<Row>;
}
interface FlowModelRepository {
  findModelById(uid: string, options: { includeAsyncNode: boolean }): Promise<Row | null>;
}

/** Module rows of the erpModules collection. */
export interface ModuleRow extends ModuleInfo {
  groupSchemaUid: string;
}

const uidsOfModelTree = (model: Row, into: Set<string>) => {
  into.add(model.uid);
  for (const value of Object.values(model.subModels || {})) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object') uidsOfModelTree(child as Row, into);
    }
  }
  return into;
};

/** Reads the records of one module, following the boundary of docs/decisions/0005-erp-module-format.md. */
export async function readModuleRecords(app: Application, moduleRow: ModuleRow): Promise<ModuleRecords> {
  const db = app.db;
  const has = (name: string) => !!db.getCollection(name);
  const prefix = modulePrefix(moduleRow.key);

  // Menu: the group and everything below it.
  const group = json(await db.getRepository('desktopRoutes').findOne({ filter: { schemaUid: moduleRow.groupSchemaUid } }));
  if (!group || group.type !== 'group' || group.parentId) {
    throw new ModuleExportError('The menu group of the module must be a top-level menu group');
  }
  const routes: Row[] = [group];
  for (let parents = [group.id]; parents.length; ) {
    const children = (await db.getRepository('desktopRoutes').find({ filter: { parentId: { $in: parents } } })).map(
      (route) => route.toJSON(),
    );
    routes.push(...children);
    parents = children.map((route) => route.id);
  }
  const routeIds = new Set(routes.map((route) => String(route.id)));
  const routeUids = [...new Set(routes.flatMap((route) => [route.schemaUid, route.menuSchemaUid]).filter(Boolean))];

  // Collections and fields named with the module prefix.
  const collections = (await db.getRepository('collections').find({ appends: ['fields'] }))
    .map((collection) => collection.toJSON())
    .filter((collection) => collection.name.startsWith(prefix));
  const collectionNames = new Set(collections.map((collection) => collection.name));

  // Classic pages: root schemas the routes point to.
  const uiSchemas: Row[] = [];
  if (has('uiSchemas')) {
    const existing = await db.getRepository('uiSchemas').find({ filter: { 'x-uid': { $in: routeUids } } });
    const withParent = new Set(
      (
        await db.getRepository('uiSchemaTreePath').find({ filter: { descendant: { $in: routeUids }, depth: { $gt: 0 } } })
      ).map((path) => path.get('descendant') as string),
    );
    const repository = db.getRepository('uiSchemas') as unknown as UiSchemaRepository;
    for (const uid of existing.map((schema) => schema.get('x-uid') as string).filter((uid) => !withParent.has(uid))) {
      uiSchemas.push({ ...(await repository.getJsonSchema(uid, { includeAsyncNode: true })), 'x-uid': uid });
    }
  }

  // Modern pages: models below the routes, then popup hosts and templates they reach, until nothing new turns up.
  const flowModels: Row[] = [];
  const templates = new Map<string, Row>();
  const refs = emptyRefs();
  uiSchemas.forEach((schema) => collectRefs(schema, refs));
  if (has('flowModels')) {
    const repository = db.getRepository('flowModels') as unknown as FlowModelRepository;
    const parentOf = async (uid: string) =>
      (await db.getRepository('flowModelTreePath').findOne({ filter: { descendant: uid, depth: 1 } }))?.get(
        'ancestor',
      ) as string | undefined;
    const contained = new Set<string>();
    const pending = new Set<string>(
      (await db.getRepository('flowModelTreePath').find({ filter: { ancestor: { $in: routeUids }, depth: 1 } })).map(
        (path) => path.get('descendant') as string,
      ),
    );
    if (has('flowModelTemplates')) {
      const own = await db.getRepository('flowModelTemplates').find({
        filter: { collectionName: { $in: [...collectionNames] }, dataSourceKey: 'main' },
      });
      own.forEach((template) => {
        templates.set(template.get('uid') as string, template.toJSON());
        pending.add(template.get('targetUid') as string);
      });
    }
    while (pending.size) {
      const [uid] = pending;
      pending.delete(uid);
      if (contained.has(uid)) continue;
      const parent = await parentOf(uid);
      if (parent && !routeUids.includes(parent)) {
        throw new ModuleExportError('A page of the module opens a popup that belongs to a page outside the module', {
          model: uid,
        });
      }
      const model = await repository.findModelById(uid, { includeAsyncNode: true });
      // A reference to a deleted model or template is left as it is; NocoBase ignores it too.
      if (!model?.uid) continue;
      flowModels.push(model);
      uidsOfModelTree(model, contained);
      const found = collectRefs(model);
      found.collections.forEach((name) => refs.collections.add(name));
      found.workflowKeys.forEach((key) => refs.workflowKeys.add(key));
      found.modelUids.forEach((ref) => pending.add(ref));
      const newTemplates = [...found.templateUids].filter((ref) => !templates.has(ref));
      if (newTemplates.length && has('flowModelTemplates')) {
        for (const template of await db
          .getRepository('flowModelTemplates')
          .find({ filter: { uid: { $in: newTemplates } } })) {
          templates.set(template.get('uid') as string, template.toJSON());
          pending.add(template.get('targetUid') as string);
        }
      }
    }
    for (const template of templates.values()) {
      if (!contained.has(template.targetUid)) templates.delete(template.uid);
    }
  }
  const flowModelTemplateUsages: Row[] = [];
  if (has('flowModelTemplateUsages') && flowModels.length) {
    const contained = new Set<string>();
    flowModels.forEach((model) => uidsOfModelTree(model, contained));
    flowModelTemplateUsages.push(
      ...(
        await db.getRepository('flowModelTemplateUsages').find({ filter: { modelUid: { $in: [...contained] } } })
      ).map((usage) => usage.toJSON()),
    );
  }

  // Workflows: current versions triggered on a module collection or run from a module page.
  const workflows: Row[] = [];
  if (has('workflows')) {
    for (const workflow of await db.getRepository('workflows').find({ filter: { current: true }, appends: ['nodes'] })) {
      const row = workflow.toJSON();
      if (collectionNames.has(collectionFromConfig(row.config?.collection)) || refs.workflowKeys.has(row.key)) {
        workflows.push(row);
      }
    }
  }

  // Roles named with the module prefix, with their permissions on module collections and menus.
  const roles: Row[] = [];
  for (const role of (await db.getRepository('roles').find()).map((r) => r.toJSON())) {
    if (!role.name.startsWith(prefix)) continue;
    const resources = (
      await db.getRepository('dataSourcesRolesResources').find({
        filter: { roleName: role.name, dataSourceKey: 'main' },
        appends: ['actions'],
      })
    ).map((resource) => resource.toJSON());
    const scopeIds = resources.flatMap((resource) => (resource.actions || []).map((a) => a.scopeId)).filter(Boolean);
    const scopes = scopeIds.length
      ? (await db.getRepository('dataSourcesRolesResourcesScopes').find({ filter: { id: { $in: scopeIds } } })).map(
          (scope) => scope.toJSON(),
        )
      : [];
    const menu = (await db.getRepository('rolesDesktopRoutes').find({ filter: { roleName: role.name } }))
      .map((row) => String(row.get('desktopRouteId')))
      .filter((id) => routeIds.has(id));
    roles.push({ ...role, resources, scopes, routeIds: menu });
  }

  return {
    module: {
      key: moduleRow.key,
      title: moduleRow.title,
      version: moduleRow.version,
      description: moduleRow.description || '',
    },
    nocobase: app.getVersion(),
    collections,
    routes,
    groupId: group.id,
    uiSchemas,
    flowModels,
    flowModelTemplates: [...templates.values()],
    flowModelTemplateUsages,
    workflows,
    roles,
  };
}

export async function exportModule(app: Application, moduleRow: ModuleRow): Promise<ModuleFile> {
  return buildModuleFile(await readModuleRecords(app, moduleRow));
}
