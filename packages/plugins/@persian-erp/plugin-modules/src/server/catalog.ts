import fs from 'fs';
import path from 'path';
import { MODULE_FILE_SUFFIX, ModuleFile } from '../shared/format';

/**
 * Where the module files of the catalog are (STORY-070): ERP_MODULES_CATALOG when set; dist/catalog in a built
 * package, where build.config.js copies them; otherwise the modules/ folder of this repository, during development.
 */
export function catalogDir() {
  if (process.env.ERP_MODULES_CATALOG) return process.env.ERP_MODULES_CATALOG;
  const built = path.resolve(__dirname, '../catalog');
  if (fs.existsSync(built)) return built;
  return path.resolve(__dirname, '../../../../../../modules');
}

export interface CatalogEntry {
  file: string;
  module: ModuleFile | null;
  error?: string;
}

/** The module files in the catalog folder and the folders right below it, sorted by file name. */
export function readCatalog(dir = catalogDir()): CatalogEntry[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(MODULE_FILE_SUFFIX)) files.push(path.join(dir, entry.name));
    if (entry.isDirectory()) {
      for (const name of fs.readdirSync(path.join(dir, entry.name)).filter((n) => n.endsWith(MODULE_FILE_SUFFIX))) {
        files.push(path.join(dir, entry.name, name));
      }
    }
  }
  return files
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
    .map((file) => {
      try {
        return { file: path.basename(file), module: JSON.parse(fs.readFileSync(file, 'utf8')) as ModuleFile };
      } catch (error) {
        return { file: path.basename(file), module: null, error: (error as Error).message };
      }
    });
}
