import type { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import { ModuleExportError } from '../shared/build';
import { isModuleKey, MODULE_FILE_SUFFIX, ModuleFile, stringifyModule } from '../shared/format';
import { summarizeModule } from '../shared/summary';
import { readCatalog } from './catalog';
import erpModulesCollection from './erp-modules-collection';
import { exportModule, ModuleRow } from './exporter';
import { checkImport, ConflictKind, importModule, ModuleImportError } from './importer';
import type { FileProblem } from '../shared/validate';

export const MODULES_RESOURCE = 'erpModules';
export const MODULES_SNIPPET = 'pm.erp-modules';
const NAMESPACE = '@persian-erp/plugin-modules';
const MAX_NAMES_PER_LINE = 5;

export class PluginModulesServer extends Plugin {
  async beforeLoad() {
    this.db.collection(erpModulesCollection);
    this.app.acl.registerSnippet({ name: MODULES_SNIPPET, actions: [`${MODULES_RESOURCE}:*`] });
  }

  async load() {
    this.app.resourceManager.registerActionHandlers({
      [`${MODULES_RESOURCE}:export`]: (ctx: Context, next: Next) => this.exportAction(ctx, next),
      [`${MODULES_RESOURCE}:import`]: (ctx: Context, next: Next) => this.importAction(ctx, next),
      [`${MODULES_RESOURCE}:overview`]: (ctx: Context, next: Next) => this.overviewAction(ctx, next),
      [`${MODULES_RESOURCE}:create`]: (ctx: Context, next: Next) => this.createAction(ctx, next),
      [`${MODULES_RESOURCE}:catalog`]: (ctx: Context, next: Next) => this.catalogAction(ctx, next),
      [`${MODULES_RESOURCE}:install`]: (ctx: Context, next: Next) => this.installAction(ctx, next),
    });
  }

  async exportAction(ctx: Context, next: Next) {
    const t = (message: string) => ctx.t(message, { ns: NAMESPACE });
    const key = ctx.action.params.filterByTk;
    const row = await this.db.getRepository(MODULES_RESOURCE).findOne({ filterByTk: key });
    if (!row) {
      ctx.throw(404, t('Module not found'));
    }
    try {
      const file = await exportModule(this.app, row.toJSON() as ModuleRow);
      ctx.withoutDataWrapping = true;
      ctx.type = 'application/json';
      ctx.set('Content-Disposition', `attachment; filename="${key}${MODULE_FILE_SUFFIX}"`);
      ctx.body = stringifyModule(file);
    } catch (error) {
      if (error instanceof ModuleExportError) {
        ctx.throw(400, t(error.message), { details: error.details });
      }
      throw error;
    }
    await next();
  }

  /** Defines a module over a top-level menu group that is not part of another module. */
  async createAction(ctx: Context, next: Next) {
    const t = (message: string) => ctx.t(message, { ns: NAMESPACE });
    const values = ctx.action.params.values || {};
    const key = typeof values.key === 'string' ? values.key.trim() : '';
    const title = typeof values.title === 'string' ? values.title.trim() : '';
    if (!isModuleKey(key)) ctx.throw(400, t('The module key is not valid'));
    if (!title) ctx.throw(400, t('The module needs a title'));
    const repository = this.db.getRepository(MODULES_RESOURCE);
    if (await repository.findOne({ filterByTk: key })) ctx.throw(400, t('A module with this key already exists'));
    const group = await this.db
      .getRepository('desktopRoutes')
      .findOne({ filter: { schemaUid: values.groupSchemaUid, type: 'group', parentId: null } });
    if (!values.groupSchemaUid || !group) ctx.throw(400, t('The menu group of the module must be a top-level menu group'));
    if (await repository.findOne({ filter: { groupSchemaUid: values.groupSchemaUid } })) {
      ctx.throw(400, t('This menu group already belongs to another module'));
    }
    const row = await repository.create({
      values: {
        key,
        title,
        version: (typeof values.version === 'string' && values.version.trim()) || '1.0.0',
        description: typeof values.description === 'string' ? values.description : '',
        groupSchemaUid: values.groupSchemaUid,
      },
    });
    ctx.body = row.toJSON();
    await next();
  }

  /** The modules of this install with what each holds, read the way an export reads them. */
  async overviewAction(ctx: Context, next: Next) {
    const t = (message: string) => ctx.t(message, { ns: NAMESPACE });
    const rows = await this.db.getRepository(MODULES_RESOURCE).find({ sort: ['key'] });
    const items = [];
    for (const row of rows.map((r) => r.toJSON() as ModuleRow)) {
      try {
        items.push({ ...summarizeModule(await exportModule(this.app, row)), groupSchemaUid: row.groupSchemaUid });
      } catch (error) {
        if (!(error instanceof ModuleExportError)) throw error;
        // The module is still listed, so that the administrator sees what is wrong with it.
        items.push({ ...summarizeModule({ module: row }), groupSchemaUid: row.groupSchemaUid, error: t(error.message) });
      }
    }
    ctx.body = items;
    await next();
  }

  /** Messages of an import, translated for the request. */
  private messages(ctx: Context) {
    const t = (message: string, values: Record<string, unknown> = {}) => ctx.t(message, { ns: NAMESPACE, ...values });
    const translate = (problem: FileProblem) => t(problem.message, problem.values);
    const kinds: Record<ConflictKind, string> = {
      module: t('Module'),
      collection: t('Collection'),
      role: t('Role'),
      menu: t('Menu group'),
      workflow: t('Workflow'),
      uid: t('Page element'),
    };
    // One line per kind; a page has dozens of element uids, so only the first few are named.
    const conflictLines = (conflicts: { kind: ConflictKind; name: string }[]) =>
      (Object.keys(kinds) as ConflictKind[]).flatMap((kind) => {
        const names = conflicts.filter((c) => c.kind === kind).map((c) => c.name);
        if (!names.length) return [];
        const shown = names.slice(0, MAX_NAMES_PER_LINE).join(', ');
        const more = names.length - MAX_NAMES_PER_LINE;
        return [`${kinds[kind]}: ${shown}${more > 0 ? ` ${t('and {{count}} more', { count: more })}` : ''}`];
      });
    return { t, translate, conflictLines };
  }

  /** The checks of an import without any change: what the file holds and what would stop it. */
  async preview(ctx: Context, file: ModuleFile) {
    const { translate, conflictLines } = this.messages(ctx);
    const summary = summarizeModule(file && typeof file === 'object' ? file : {});
    try {
      const { warnings } = await checkImport(this.app, file);
      return { summary, warnings: warnings.map(translate), problems: [] as string[], conflicts: [] as string[] };
    } catch (error) {
      if (!(error instanceof ModuleImportError)) throw error;
      return {
        summary,
        warnings: [] as string[],
        problems: error.problems.map(translate),
        conflicts: conflictLines(error.conflicts),
      };
    }
  }

  async runImport(ctx: Context, file: ModuleFile) {
    const { translate, conflictLines } = this.messages(ctx);
    try {
      const result = await importModule(this.app, file);
      return { ...result, warnings: result.warnings.map(translate) };
    } catch (error) {
      if (error instanceof ModuleImportError) {
        const lines = [...error.problems.map(translate), ...conflictLines(error.conflicts)];
        ctx.throw(400, lines.join('\n'), { conflicts: error.conflicts });
      }
      throw error;
    }
  }

  async importAction(ctx: Context, next: Next) {
    const file = ctx.action.params.values as ModuleFile;
    // A preview runs the checks of an import and changes nothing.
    ctx.body = isTrue(ctx.action.params.dryRun) ? await this.preview(ctx, file) : await this.runImport(ctx, file);
    await next();
  }

  /** The module files that come with the plugin, each with whether it is installed and what an import would say. */
  async catalogAction(ctx: Context, next: Next) {
    const { t } = this.messages(ctx);
    const installed = new Set(
      (await this.db.getRepository(MODULES_RESOURCE).find({ fields: ['key'] })).map((row) => row.get('key') as string),
    );
    const items = [];
    for (const entry of readCatalog()) {
      if (!entry.module) {
        items.push({ file: entry.file, installed: false, summary: summarizeModule({}), warnings: [], problems: [t('This is not an ERP module file')], conflicts: [] });
        continue;
      }
      const key = entry.module.module?.key;
      if (installed.has(key)) {
        items.push({ file: entry.file, installed: true, summary: summarizeModule(entry.module), warnings: [], problems: [], conflicts: [] });
      } else {
        items.push({ file: entry.file, installed: false, ...(await this.preview(ctx, entry.module)) });
      }
    }
    ctx.body = items;
    await next();
  }

  /** Installs a module of the catalog by its key. */
  async installAction(ctx: Context, next: Next) {
    const { t } = this.messages(ctx);
    const key = ctx.action.params.filterByTk;
    const entry = readCatalog().find((e) => e.module?.module?.key === key);
    if (!entry) ctx.throw(404, t('Module not found'));
    ctx.body = await this.runImport(ctx, entry.module);
    await next();
  }
}

const isTrue = (value: unknown) => value === true || value === 'true' || value === '1';

export default PluginModulesServer;
