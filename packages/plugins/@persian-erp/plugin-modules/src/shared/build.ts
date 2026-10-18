import {
  canonicalize,
  collectionFromConfig,
  collectRefs,
  emptyRefs,
  ModuleFile,
  ModuleInfo,
  ModuleRole,
  ModuleRoute,
  ModuleWorkflow,
  ModuleWorkflowNode,
  MODULE_FORMAT,
  MODULE_FORMAT_VERSION,
} from './format';

type Row = Record<string, any>;

/** Records of one module as read from the database; see src/server/exporter.ts. */
export interface ModuleRecords {
  module: ModuleInfo;
  nocobase: string;
  collections: Row[]; // each with its fields in `fields`
  routes: Row[]; // the group and every route below it, flat
  groupId: string | number;
  uiSchemas: Row[]; // root schemas from getJsonSchema
  flowModels: Row[]; // root model trees from findModelById
  flowModelTemplates: Row[];
  flowModelTemplateUsages: Row[];
  workflows: Row[]; // current versions, each with its nodes in `nodes`
  roles: Row[]; // each with `resources` (with `actions`), `scopes` and `routeIds`
  otherModules?: { key: string; version: string }[]; // the other modules installed, which may own referenced collections
}

/** The installed module whose collections the name belongs to: the longest key that the name starts with, then `_`. */
export function ownerOf(name: string, modules: { key: string }[]) {
  return modules.filter((module) => name.startsWith(`${module.key}_`)).sort((a, b) => b.key.length - a.key.length)[0];
}

// Database ids, timestamps and audit columns: they differ between installs and are rebuilt on import.
const RECORD_NOISE = ['createdAt', 'updatedAt', 'createdById', 'updatedById', 'createdBy', 'updatedBy'];

const omit = (row: Row, keys: string[]) => {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (!keys.includes(key) && !RECORD_NOISE.includes(key)) {
      result[key] = value;
    }
  }
  return result;
};

const sortBy = <T>(items: T[], key: (item: T) => string | number) =>
  [...items].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });

const sorted = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort();

const compareIds = (a: unknown, b: unknown) => {
  const x = BigInt(String(a));
  const y = BigInt(String(b));
  return x < y ? -1 : x > y ? 1 : 0;
};

export class ModuleExportError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

function buildCollections(collections: Row[]) {
  const fieldName = new Map<string, string>();
  for (const collection of collections) {
    for (const field of collection.fields || []) {
      fieldName.set(field.key, field.name);
    }
  }
  return sortBy(collections, (c) => c.name).map((collection) => {
    const fields = [...(collection.fields || [])]
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.name < b.name ? -1 : 1))
      .map((field) => {
        const result = omit(field, ['key', 'collectionName', 'parentKey', 'reverseKey', 'sort']);
        if (field.reverseKey) {
          result.reverseFieldName = fieldName.get(field.reverseKey) ?? null;
        }
        return result;
      });
    return { ...omit(collection, ['key', 'fields', 'sort', 'category']), fields };
  });
}

function buildRoutes(routes: Row[], groupId: string | number) {
  const children = new Map<string, Row[]>();
  for (const route of routes) {
    const parent = String(route.parentId ?? '');
    children.set(parent, [...(children.get(parent) || []), route]);
  }
  const refById = new Map<string, string>();
  const toModule = (route: Row, ref: string): ModuleRoute => {
    refById.set(String(route.id), ref);
    const own = sortBy(children.get(String(route.id)) || [], (r) => r.sort ?? 0);
    const result: ModuleRoute = {
      ...omit(route, ['id', 'parentId', 'sort', 'roles', 'children', 'uiLayouts']),
      ref,
      type: route.type,
    };
    if (Array.isArray(route.uiLayouts)) {
      result.uiLayouts = sorted(route.uiLayouts.map((layout) => layout.uid));
    }
    if (own.length) {
      // A route without schemaUid (a link) is named by its parent and position.
      result.children = own.map((child, index) => toModule(child, child.schemaUid || `${ref}/${index + 1}`));
    }
    return result;
  };
  const group = routes.find((route) => String(route.id) === String(groupId));
  if (!group) {
    throw new ModuleExportError('The menu group of the module does not exist');
  }
  return { tree: toModule(group, group.schemaUid || 'group'), refById };
}

// The route id stored in a page is rebuilt from the route the page hangs from.
function stripModel(model: Row): Row {
  const result = omit(model, ['parent']);
  if (result.props && typeof result.props === 'object' && 'routeId' in result.props) {
    result.props = omit(result.props, ['routeId']);
  }
  if (result.subModels && typeof result.subModels === 'object') {
    const subModels: Row = {};
    for (const [key, value] of Object.entries(result.subModels)) {
      subModels[key] = Array.isArray(value) ? value.map(stripModel) : stripModel(value as Row);
    }
    result.subModels = subModels;
  }
  return result;
}

function buildWorkflows(workflows: Row[]): ModuleWorkflow[] {
  return sortBy(workflows, (w) => w.key).map((workflow) => {
    const nodes = [...(workflow.nodes || [])].sort((a, b) => compareIds(a.id, b.id));
    const keyById = new Map(nodes.map((node) => [String(node.id), node.key as string]));
    const keyOf = (id: unknown) => (id === null || id === undefined ? null : keyById.get(String(id)) ?? null);
    const moduleNodes: ModuleWorkflowNode[] = nodes.map((node) => ({
      ...omit(node, ['id', 'workflowId', 'upstreamId', 'downstreamId']),
      key: node.key,
      type: node.type,
      title: node.title,
      upstream: keyOf(node.upstreamId),
      downstream: keyOf(node.downstreamId),
      branchIndex: node.branchIndex ?? null,
      config: node.config ?? {},
    }));
    return {
      ...omit(workflow, [
        'id',
        'nodes',
        'current',
        'executed',
        'allExecuted',
        'stats',
        'versionStats',
        'revisions',
        'categories',
      ]),
      key: workflow.key,
      type: workflow.type,
      title: workflow.title,
      enabled: !!workflow.enabled,
      config: workflow.config ?? {},
      nodes: moduleNodes,
    };
  });
}

function buildRoles(roles: Row[], collectionNames: Set<string>, refById: Map<string, string>): ModuleRole[] {
  return sortBy(roles, (r) => r.name).map((role) => {
    const scopeKey = new Map<string, string>((role.scopes || []).map((scope) => [String(scope.id), scope.key]));
    const resources = sortBy(
      (role.resources || []).filter((resource) => collectionNames.has(resource.name)),
      (r) => r.name,
    ).map((resource) => ({
      name: resource.name,
      usingActionsConfig: !!resource.usingActionsConfig,
      actions: sortBy(resource.actions || [], (a: Row) => a.name).map((action: Row) => ({
        name: action.name,
        fields: sorted(action.fields || []),
        scope: action.scopeId ? scopeKey.get(String(action.scopeId)) ?? null : null,
      })),
    }));
    const usedScopes = new Set(resources.flatMap((r) => r.actions.map((a) => a.scope)).filter(Boolean));
    const scopes = sortBy(
      (role.scopes || []).filter((scope) => usedScopes.has(scope.key)),
      (s: Row) => s.key,
    ).map((scope: Row) => ({
      key: scope.key,
      name: scope.name,
      resourceName: scope.resourceName ?? null,
      scope: scope.scope ?? {},
    }));
    const routes = sorted((role.routeIds || []).map((id) => refById.get(String(id))).filter(Boolean));
    return {
      ...omit(role, ['resources', 'scopes', 'routeIds', 'users', 'sort', 'menuUiSchemas', 'desktopRoutes']),
      name: role.name,
      title: role.title,
      resources,
      scopes,
      routes,
    };
  });
}

/** Builds the module file from its records. Pure: everything it needs is in `records`. */
export function buildModuleFile(records: ModuleRecords): ModuleFile {
  const collectionNames = new Set(records.collections.map((c) => c.name));
  const { tree, refById } = buildRoutes(records.routes, records.groupId);
  const workflows = buildWorkflows(records.workflows);

  // References that point outside the module.
  const refs = emptyRefs();
  records.uiSchemas.forEach((schema) => collectRefs(schema, refs));
  records.flowModels.forEach((model) => collectRefs(model, refs));
  const referenced = new Set(refs.collections);
  for (const collection of records.collections) {
    for (const field of collection.fields || []) {
      if (field.target) referenced.add(field.target);
      if (field.through) referenced.add(field.through);
    }
  }
  for (const workflow of workflows) {
    const name = collectionFromConfig(workflow.config.collection);
    if (name) referenced.add(name);
    for (const node of workflow.nodes) {
      const nodeCollection = collectionFromConfig(node.config.collection);
      if (nodeCollection) referenced.add(nodeCollection);
    }
  }
  const channels = sorted(
    workflows.flatMap((w) =>
      w.nodes
        .filter((n) => n.type === 'notification' && typeof n.config.channelName === 'string')
        .map((n) => n.config.channelName as string),
    ),
  );
  // A collection of another installed module is not listed by name: the module is, with the version installed now.
  const others = (records.otherModules || []).filter((module) => module.key !== records.module.key);
  const external = [...referenced].filter((name) => !collectionNames.has(name));
  const modules: Record<string, string> = {};
  for (const name of external) {
    const owner = ownerOf(name, others);
    if (owner) modules[owner.key] = owner.version;
  }
  // A role keeps its permissions on the collections of the modules it needs, such as reading their items.
  const roles = buildRoles(
    records.roles,
    new Set([...collectionNames, ...external.filter((name) => ownerOf(name, others))]),
    refById,
  );
  const file: ModuleFile = {
    format: MODULE_FORMAT,
    formatVersion: MODULE_FORMAT_VERSION,
    module: records.module,
    nocobase: records.nocobase,
    requires: {
      collections: sorted(external.filter((name) => !ownerOf(name, others))),
      fieldTypes: sorted(records.collections.flatMap((c) => (c.fields || []).map((f) => f.type))),
      fieldInterfaces: sorted(records.collections.flatMap((c) => (c.fields || []).map((f) => f.interface))),
      workflowTriggers: sorted(workflows.map((w) => w.type)),
      workflowInstructions: sorted(workflows.flatMap((w) => w.nodes.map((n) => n.type))),
      ...(channels.length ? { notificationChannels: channels } : {}),
      ...(Object.keys(modules).length ? { modules: canonicalize(modules) as Record<string, string> } : {}),
      models: sorted(refs.models),
    },
    collections: buildCollections(records.collections),
    routes: tree,
    uiSchemas: sortBy(records.uiSchemas, (s) => s['x-uid']),
    flowModels: sortBy(records.flowModels.map(stripModel), (m) => m.uid),
    flowModelTemplates: sortBy(
      records.flowModelTemplates.map((t) => omit(t, [])),
      (t) => t.uid,
    ),
    flowModelTemplateUsages: sortBy(
      records.flowModelTemplateUsages.map((u) => ({ templateUid: u.templateUid, modelUid: u.modelUid })),
      (u) => `${u.templateUid}\u0000${u.modelUid}`,
    ),
    workflows,
    roles,
  };
  return canonicalize(file);
}
