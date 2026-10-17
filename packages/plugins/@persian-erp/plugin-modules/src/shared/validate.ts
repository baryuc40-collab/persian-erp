import { isModuleKey, MODULE_FORMAT, MODULE_FORMAT_VERSION, ModuleFile } from './format';

/** A problem with a module file, as a message key and its variables, so the server can translate it. */
export interface FileProblem {
  message: string;
  values?: Record<string, string | number>;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)/;
/** Compares x.y.z versions; null when one of them is not of that form. */
export function compareVersions(a: string, b: string): number | null {
  const x = VERSION.exec(String(a || ''));
  const y = VERSION.exec(String(b || ''));
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(x[i]) - Number(y[i]);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

const minorOf = (version: string) => {
  const match = /^(\d+)\.(\d+)\./.exec(String(version || ''));
  return match ? `${match[1]}.${match[2]}` : null;
};

/**
 * Checks what can be checked without the database: the format, its version and the NocoBase version.
 * See section 4 of docs/decisions/0005-erp-module-format.md.
 */
export function checkModuleFile(file: unknown, nocobaseVersion: string) {
  const errors: FileProblem[] = [];
  const warnings: FileProblem[] = [];
  const value = file as Partial<ModuleFile>;
  if (!value || typeof value !== 'object' || value.format !== MODULE_FORMAT) {
    errors.push({ message: 'This is not an ERP module file' });
    return { errors, warnings };
  }
  if (typeof value.formatVersion !== 'number' || value.formatVersion > MODULE_FORMAT_VERSION) {
    errors.push({
      message: 'The module file has format version {{fileVersion}}, but this plugin reads up to version {{version}}',
      values: { fileVersion: String(value.formatVersion), version: MODULE_FORMAT_VERSION },
    });
  }
  if (!isModuleKey(value.module?.key)) {
    errors.push({ message: 'The module key is not valid' });
  }
  const fileMinor = minorOf(value.nocobase);
  const ownMinor = minorOf(nocobaseVersion);
  if (!fileMinor || fileMinor !== ownMinor) {
    errors.push({
      message: 'The module was made with NocoBase {{fileVersion}} and cannot be imported into NocoBase {{version}}',
      values: { fileVersion: String(value.nocobase), version: nocobaseVersion },
    });
  } else if (value.nocobase !== nocobaseVersion) {
    warnings.push({
      message: 'The module was made with NocoBase {{fileVersion}}; this install runs {{version}}',
      values: { fileVersion: value.nocobase, version: nocobaseVersion },
    });
  }
  const sections = ['collections', 'uiSchemas', 'flowModels', 'flowModelTemplates', 'workflows', 'roles'];
  if (!value.routes || typeof value.routes !== 'object' || sections.some((key) => !Array.isArray(value[key]))) {
    errors.push({ message: 'The module file is incomplete' });
  }
  return { errors, warnings };
}
