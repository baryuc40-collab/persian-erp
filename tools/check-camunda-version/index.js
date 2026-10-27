#!/usr/bin/env node
// Fails when a file names a Camunda 8 image other than the version of CAMUNDA_VERSION (STORY-091). The version is
// written out in the Compose files and CI, since Compose cannot read it from a file; this keeps them all equal to it.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
// Files that may run the engine: the Compose files and the CI workflows.
const FILES = ['docker-compose.yml', 'docker/docker-compose.yml'];
const WORKFLOWS = '.github/workflows';

/** The tags of camunda/camunda images in a text, with their line numbers. */
function findCamundaImages(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\bcamunda\/camunda:([^\s'"]+)/g)) found.push({ line: index + 1, tag: match[1] });
  });
  return found;
}

/** Mismatches of the files against the expected version; a file without the image is fine. */
function checkFiles(expected, files) {
  const problems = [];
  for (const [name, text] of Object.entries(files)) {
    for (const { line, tag } of findCamundaImages(text)) {
      if (tag !== expected)
        problems.push(`${name}:${line}: camunda/camunda:${tag} is not CAMUNDA_VERSION (${expected})`);
    }
  }
  return problems;
}

function run() {
  const expected = fs.readFileSync(path.join(root, 'CAMUNDA_VERSION'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+$/.test(expected)) {
    console.error(`CAMUNDA_VERSION must be a version like 8.10.7, not "${expected}"`);
    return 1;
  }
  const names = [...FILES];
  const workflows = path.join(root, WORKFLOWS);
  if (fs.existsSync(workflows)) {
    names.push(
      ...fs
        .readdirSync(workflows)
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => `${WORKFLOWS}/${f}`),
    );
  }
  const files = Object.fromEntries(
    names
      .filter((name) => fs.existsSync(path.join(root, name)))
      .map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]),
  );
  const problems = checkFiles(expected, files);
  if (problems.length) {
    problems.forEach((problem) => console.error(problem));
    return 1;
  }
  const count = Object.values(files).reduce((sum, text) => sum + findCamundaImages(text).length, 0);
  console.log(`${count} Camunda image(s) match CAMUNDA_VERSION (${expected}).`);
  return 0;
}

module.exports = { findCamundaImages, checkFiles, run };

if (require.main === module) process.exitCode = run();
