// Copies the reference modules of this repository (modules/*/*.erp-module.json) into dist/catalog, so the plugin
// package carries its catalog (STORY-070).
const fs = require('fs');
const path = require('path');

const MODULES = path.resolve(__dirname, '../../../../modules');
const CATALOG = path.join(__dirname, 'dist', 'catalog');

module.exports = {
  afterBuild: async (log) => {
    fs.rmSync(CATALOG, { recursive: true, force: true });
    if (!fs.existsSync(MODULES)) return;
    fs.mkdirSync(CATALOG, { recursive: true });
    for (const dir of fs.readdirSync(MODULES, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const file of fs.readdirSync(path.join(MODULES, dir.name)).filter((name) => name.endsWith('.erp-module.json'))) {
        fs.copyFileSync(path.join(MODULES, dir.name, file), path.join(CATALOG, file));
        log(`catalog: ${file}`);
      }
    }
  },
};
