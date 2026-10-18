import { createHash } from 'crypto';
import type Application from '@nocobase/server';
import { ModuleFile, stringifyModule } from '../shared/format';
import { exportModule, ModuleRow } from './exporter';

/** The SHA-256 of a module export, to tell later whether the module changed after it was installed (decision 0006). */
export const moduleHash = (file: ModuleFile) => createHash('sha256').update(stringifyModule(file)).digest('hex');

/** Saves the hash of the module as it is now; done after an import or an upgrade is committed. */
export async function saveInstalledHash(app: Application, key: string) {
  const row = await app.db.getRepository('erpModules').findOne({ filterByTk: key });
  if (!row) return;
  const hash = moduleHash(await exportModule(app, row.toJSON() as ModuleRow));
  await app.db.getRepository('erpModules').update({ filterByTk: key, values: { installedHash: hash } });
}
