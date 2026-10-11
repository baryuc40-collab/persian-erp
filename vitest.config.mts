import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from '@nocobase/test/vitest.mjs';

const config = defineConfig();

// The published @nocobase/test points `module` at src/ and `exports.import` at
// es/index.mjs, and neither is shipped in the npm package. Inside the NocoBase
// monorepo tsconfig.paths.json maps it to source; here we use the CommonJS build.
const require = createRequire(import.meta.url);
const nocobaseTestDir = path.dirname(require.resolve('@nocobase/test/package.json'));
config.test.alias.unshift({
  find: /^@nocobase\/test$/,
  replacement: path.join(nocobaseTestDir, 'lib/index.js'),
});

export default config;
