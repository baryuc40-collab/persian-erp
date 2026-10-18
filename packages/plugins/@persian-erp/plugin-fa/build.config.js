// Copies the Vazirmatn fonts (fonts/*.woff2) into dist/client/fonts (STORY-072). The nginx of the NocoBase image
// serves only dist/client and dist/client-v2 of a plugin package and refuses every other file with 403.
const fs = require('fs');
const path = require('path');

const FONTS = path.join(__dirname, 'fonts');
const TARGET = path.join(__dirname, 'dist', 'client', 'fonts');

module.exports = {
  afterBuild: async (log) => {
    fs.rmSync(TARGET, { recursive: true, force: true });
    fs.mkdirSync(TARGET, { recursive: true });
    for (const file of fs.readdirSync(FONTS).filter((name) => name.endsWith('.woff2') || name === 'OFL.txt')) {
      fs.copyFileSync(path.join(FONTS, file), path.join(TARGET, file));
    }
    log(`fonts: copied to ${path.relative(__dirname, TARGET)}`);
  },
};
