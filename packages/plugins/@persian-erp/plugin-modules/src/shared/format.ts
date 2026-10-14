// The ERP module file format; see docs/decisions/0005-erp-module-format.md.

export const MODULE_FORMAT = 'persian-erp-module';
export const MODULE_FORMAT_VERSION = 1;
export const MODULE_FILE_SUFFIX = '.erp-module.json';

// Lower-case Latin letters, digits and _, starting with a letter, 2 to 20 characters.
export const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,19}$/;

export const isModuleKey = (key: unknown): key is string => typeof key === 'string' && MODULE_KEY_PATTERN.test(key);

export const modulePrefix = (key: string) => `${key}_`;

export interface ModuleInfo {
  key: string;
  title: string;
  version: string;
  description?: string;
}

export interface ModuleRequires {
  collections: string[];
  fieldTypes: string[];
  fieldInterfaces: string[];
  workflowTriggers: string[];
  workflowInstructions: string[];
  /** Notification channels the notification nodes of the workflows send through; absent when there are none. */
  notificationChannels?: string[];
  models: string[];
}

export interface ModuleRoute {
  ref: string;
  type: string;
  title?: string;
  children?: ModuleRoute[];
  [key: string]: unknown;
}

export interface ModuleWorkflowNode {
  key: string;
  type: string;
  title?: string;
  upstream: string | null;
  downstream: string | null;
  branchIndex: number | null;
  config: Record<string, unknown>;
}

export interface ModuleWorkflow {
  key: string;
  type: string;
  title: string;
  enabled: boolean;
  config: Record<string, unknown>;
  nodes: ModuleWorkflowNode[];
  [key: string]: unknown;
}

export interface ModuleRoleAction {
  name: string;
  fields: string[];
  scope: string | null;
}

export interface ModuleRole {
  name: string;
  title: string;
  resources: { name: string; usingActionsConfig: boolean; actions: ModuleRoleAction[] }[];
  scopes: { key: string; name: string; resourceName: string | null; scope: unknown }[];
  routes: string[];
  [key: string]: unknown;
}

export interface ModuleFile {
  format: typeof MODULE_FORMAT;
  formatVersion: number;
  module: ModuleInfo;
  nocobase: string;
  requires: ModuleRequires;
  collections: Record<string, unknown>[];
  routes: ModuleRoute;
  uiSchemas: Record<string, unknown>[];
  flowModels: Record<string, unknown>[];
  flowModelTemplates: Record<string, unknown>[];
  flowModelTemplateUsages: { templateUid: string; modelUid: string }[];
  workflows: ModuleWorkflow[];
  roles: ModuleRole[];
  data?: Record<string, Record<string, unknown>[]>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// Keys whose value maps child names to child schemas; their order is the display order, so it follows x-index.
const ORDERED_SCHEMA_MAPS = new Set(['properties', 'definitions', 'patternProperties']);

const xIndex = (value: unknown) =>
  isPlainObject(value) && typeof value['x-index'] === 'number' ? (value['x-index'] as number) : Infinity;

/**
 * A copy with object keys in a stable order, so that two exports of the same module are identical.
 * Keys are sorted, except in the child maps of classic schemas, where the order is the display order.
 */
export function canonicalize<T>(value: T, parentKey?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)) as unknown as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const keys = Object.keys(value);
  if (parentKey && ORDERED_SCHEMA_MAPS.has(parentKey)) {
    keys.sort((a, b) => xIndex(value[a]) - xIndex(value[b]) || (a < b ? -1 : a > b ? 1 : 0));
  } else {
    keys.sort();
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      result[key] = canonicalize(value[key], key);
    }
  }
  return result as T;
}

export const stringifyModule = (file: ModuleFile) => `${JSON.stringify(canonicalize(file), null, 2)}\n`;

/** References found inside classic schemas and modern models; see section 7 of docs/research/erp-modules.md. */
export interface FoundRefs {
  collections: Set<string>;
  workflowKeys: Set<string>;
  modelUids: Set<string>;
  templateUids: Set<string>;
  models: Set<string>;
}

export const emptyRefs = (): FoundRefs => ({
  collections: new Set(),
  workflowKeys: new Set(),
  modelUids: new Set(),
  templateUids: new Set(),
  models: new Set(),
});

// "ds:name" or "name" (main data source) in workflow configs.
export const collectionFromConfig = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const [dataSource, name] = value.includes(':') ? value.split(':', 2) : ['main', value];
  return dataSource === 'main' ? name : null;
};

/** Walks a classic schema or a modern model tree and collects the references the module boundary depends on. */
export function collectRefs(value: unknown, refs: FoundRefs = emptyRefs()): FoundRefs {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
    return refs;
  }
  if (!isPlainObject(value)) {
    return refs;
  }
  const dataSource = value.dataSourceKey ?? value.dataSource;
  const isMain = dataSource === undefined || dataSource === null || dataSource === 'main';
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && child) {
      switch (key) {
        case 'collectionName':
          if (isMain) refs.collections.add(child);
          break;
        case 'associationName':
          if (isMain) refs.collections.add(child.split('.')[0]);
          break;
        case 'x-collection-field':
          refs.collections.add(child.split('.')[0]);
          break;
        case 'x-acl-action':
          if (child.includes(':')) refs.collections.add(child.split(':')[0]);
          break;
        case 'workflowKey':
          refs.workflowKeys.add(child);
          break;
        case 'popupTemplateUid':
        case 'templateUid':
          refs.templateUids.add(child);
          break;
        case 'use':
          refs.models.add(child);
          break;
      }
    }
    if (key === 'x-decorator-props' && isPlainObject(child)) {
      const props = child;
      const propsMain = props.dataSource === undefined || props.dataSource === 'main';
      if (propsMain && typeof props.collection === 'string' && props.collection) {
        refs.collections.add(props.collection);
      }
      if (propsMain && typeof props.association === 'string' && props.association) {
        refs.collections.add(props.association.split('.')[0]);
      }
    }
    if (key === 'openView' && isPlainObject(child) && typeof child.uid === 'string' && child.uid) {
      refs.modelUids.add(child.uid);
    }
    collectRefs(child, refs);
  }
  return refs;
}
