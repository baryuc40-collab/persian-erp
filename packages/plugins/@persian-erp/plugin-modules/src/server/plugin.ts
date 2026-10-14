import type { Context, Next } from '@nocobase/actions';
import { Plugin } from '@nocobase/server';
import { ModuleExportError } from '../shared/build';
import { MODULE_FILE_SUFFIX, stringifyModule } from '../shared/format';
import erpModulesCollection from './erp-modules-collection';
import { exportModule, ModuleRow } from './exporter';
import { ConflictKind, importModule, ModuleImportError } from './importer';
import type { FileProblem } from '../shared/validate';

export const MODULES_RESOURCE = 'erpModules';
export const MODULES_SNIPPET = 'pm.erp-modules';
const NAMESPACE = '@persian-erp/plugin-modules';

export class PluginModulesServer extends Plugin {
  async beforeLoad() {
    this.db.collection(erpModulesCollection);
    this.app.acl.registerSnippet({ name: MODULES_SNIPPET, actions: [`${MODULES_RESOURCE}:*`] });
  }

  async load() {
    this.app.resourceManager.registerActionHandlers({
      [`${MODULES_RESOURCE}:export`]: (ctx: Context, next: Next) => this.exportAction(ctx, next),
      [`${MODULES_RESOURCE}:import`]: (ctx: Context, next: Next) => this.importAction(ctx, next),
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

  async importAction(ctx: Context, next: Next) {
    const t = (message: string, values: Record<string, unknown> = {}) => ctx.t(message, { ns: NAMESPACE, ...values });
    const translate = (problem: FileProblem) => t(problem.message, problem.values);
    try {
      const result = await importModule(this.app, ctx.action.params.values);
      ctx.body = { ...result, warnings: result.warnings.map(translate) };
    } catch (error) {
      if (error instanceof ModuleImportError) {
        const lines = error.problems.map(translate);
        const kinds: Record<ConflictKind, string> = {
          module: t('Module'),
          collection: t('Collection'),
          role: t('Role'),
          menu: t('Menu group'),
          workflow: t('Workflow'),
          uid: t('Page element'),
        };
        lines.push(...error.conflicts.map((conflict) => `${kinds[conflict.kind]}: ${conflict.name}`));
        ctx.throw(400, lines.join('\n'), { conflicts: error.conflicts });
      }
      throw error;
    }
    await next();
  }
}

export default PluginModulesServer;
