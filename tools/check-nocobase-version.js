// Fails when the @nocobase/* versions in package.json drift from NOCOBASE_VERSION.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expected = fs.readFileSync(path.join(root, 'NOCOBASE_VERSION'), 'utf8').trim();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const mismatches = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([name, version]) => name.startsWith('@nocobase/') && version !== expected)
  .map(([name, version]) => `${name}@${version}`);

if (mismatches.length) {
  console.error(`NOCOBASE_VERSION is ${expected}, but package.json has: ${mismatches.join(', ')}`);
  process.exit(1);
}
console.log(`@nocobase/* packages match NOCOBASE_VERSION (${expected}).`);
