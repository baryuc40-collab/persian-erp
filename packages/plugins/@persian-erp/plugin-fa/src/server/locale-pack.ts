import fs from 'fs/promises';
import path from 'path';

export const LOCALE_PACK_LANGS = ['fa-IR'];

// Translations for NocoBase packages live in `locales/<lang>/<module>.json` at the
// package root, one file per i18n namespace (`client`, `data-source-manager`, ...).
// See docs/decisions/0003-i18n-delivery.md.
export const localePackDir = (lang: string) => path.resolve(__dirname, '../../locales', lang);

export async function readLocalePack(lang: string): Promise<Record<string, Record<string, string>>> {
  if (!LOCALE_PACK_LANGS.includes(lang)) {
    return {};
  }
  let files: string[];
  try {
    files = await fs.readdir(localePackDir(lang));
  } catch (error) {
    return {};
  }
  const resources: Record<string, Record<string, string>> = {};
  for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
    const module = file.slice(0, -'.json'.length);
    const content = await fs.readFile(path.join(localePackDir(lang), file), 'utf8');
    resources[module] = JSON.parse(content);
  }
  return resources;
}
