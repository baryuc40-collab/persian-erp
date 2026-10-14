import type { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import { ModuleExportError } from '../shared/build';
import { isModuleKey, MODULE_FILE_SUFFIX, ModuleFile, stringifyModule } from '../shared/format';
import { summarizeModule } from '../shared/summary';
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

  async importAction(ctx: Context, next: Next) {
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
    const file = ctx.action.params.values as ModuleFile;
    // A preview runs the checks of an import and changes nothing.
    if (['true', true, '1'].includes(ctx.action.params.dryRun)) {
      const summary = summarizeModule(file && typeof file === 'object' ? file : {});
      try {
        const { warnings } = await checkImport(this.app, file);
        ctx.body = { summary, warnings: warnings.map(translate), problems: [], conflicts: [] };
      } catch (error) {
        if (!(error instanceof ModuleImportError)) throw error;
        ctx.body = {
          summary,
          warnings: [],
          problems: error.problems.map(translate),
          conflicts: conflictLines(error.conflicts),
        };
      }
      return next();
    }
    try {
      const result = await importModule(this.app, file);
      ctx.body = { ...result, warnings: result.warnings.map(translate) };
    } catch (error) {
      if (error instanceof ModuleImportError) {
        const lines = [...error.problems.map(translate), ...conflictLines(error.conflicts)];
        ctx.throw(400, lines.join('\n'), { conflicts: error.conflicts });
      }
      throw error;
    }
    await next();
  }
}

export default PluginModulesServer;
