// Fails when the @nocobase/* versions in package.json drift from NOCOBASE_VERSION, or when docker/Dockerfile
// names a NocoBase image version itself instead of taking it from NOCOBASE_VERSION (docker/build.sh passes it).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expected = fs.readFileSync(path.join(root, 'NOCOBASE_VERSION'), 'utf8').trim();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const mismatches = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([name, version]) => name.startsWith('@nocobase/') && version !== expected)
  .map(([name, version]) => `${name}@${version}`);

const dockerfile = path.join(root, 'docker', 'Dockerfile');
const bases = fs.existsSync(dockerfile)
  ? [...fs.readFileSync(dockerfile, 'utf8').matchAll(/^FROM\s+nocobase\/nocobase:(\S+)/gim)].map((m) => m[1])
  : [];
const pinnedBases = bases.filter((tag) => tag !== '${NOCOBASE_VERSION}');

if (mismatches.length || pinnedBases.length) {
  if (mismatches.length)
    console.error(`NOCOBASE_VERSION is ${expected}, but package.json has: ${mismatches.join(', ')}`);
  if (pinnedBases.length) {
    console.error(`docker/Dockerfile must use nocobase/nocobase:\${NOCOBASE_VERSION}, not: ${pinnedBases.join(', ')}`);
  }
  process.exit(1);
}
console.log(
  `@nocobase/* packages${bases.length ? ' and the Docker base image' : ''} match NOCOBASE_VERSION (${expected}).`,
);
