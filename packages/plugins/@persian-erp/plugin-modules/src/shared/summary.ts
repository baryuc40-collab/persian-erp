import type { ModuleFile, ModuleRoute } from './format';

/** What a module file holds, as the settings page lists it before an import and for installed modules. */
export interface ModuleSummary {
  key: string;
  title: string;
  version: string;
  description: string;
  collections: { name: string; title: string }[];
  pages: { title: string; type: string }[];
  workflows: { key: string; title: string; enabled: boolean }[];
  roles: { name: string; title: string }[];
}

const PAGE_TYPES = new Set(['page', 'flowPage']);

const routesOf = (route: ModuleRoute | undefined): ModuleRoute[] =>
  route ? [route, ...(route.children || []).flatMap(routesOf)] : [];

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Reads the summary defensively: a file that failed the checks is still shown as far as it goes. */
export function summarizeModule(file: Partial<ModuleFile>): ModuleSummary {
  const list = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : []);
  return {
    key: text(file.module?.key),
    title: text(file.module?.title),
    version: text(file.module?.version),
    description: text(file.module?.description),
    collections: list<Record<string, unknown>>(file.collections).map((c) => ({
      name: text(c.name),
      title: text(c.title),
    })),
    pages: routesOf(file.routes)
      .filter((route) => PAGE_TYPES.has(route.type))
      .map((route) => ({ title: text(route.title), type: route.type })),
    workflows: list<Record<string, unknown>>(file.workflows).map((w) => ({
      key: text(w.key),
      title: text(w.title),
      enabled: !!w.enabled,
    })),
    roles: list<Record<string, unknown>>(file.roles).map((r) => ({ name: text(r.name), title: text(r.title) })),
  };
}
