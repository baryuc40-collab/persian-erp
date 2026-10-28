const test = require('node:test');
const assert = require('node:assert');
const { findCamundaImages, checkFiles } = require('..');

test('finds every camunda/camunda image with its line', () => {
  const text =
    "services:\n  camunda:\n    image: camunda/camunda:8.10.7\n  other:\n    image: 'camunda/camunda:8.9.1'\n";
  assert.deepStrictEqual(findCamundaImages(text), [
    { line: 3, tag: '8.10.7' },
    { line: 5, tag: '8.9.1' },
  ]);
});

test('other Camunda images and files without one are fine', () => {
  const files = {
    'a.yml': 'image: camunda/connectors-bundle:8.10.0\nimage: postgres:16\n',
    'b.yml': 'image: camunda/camunda:8.10.7\n',
  };
  assert.deepStrictEqual(checkFiles('8.10.7', files), []);
});

test('an image of another version is reported with its file and line', () => {
  const problems = checkFiles('8.10.7', { 'docker-compose.yml': 'x\n    image: camunda/camunda:8.10.6\n' });
  assert.deepStrictEqual(problems, ['docker-compose.yml:2: camunda/camunda:8.10.6 is not CAMUNDA_VERSION (8.10.7)']);
});

test('a moving tag like latest is a mismatch too', () => {
  assert.strictEqual(checkFiles('8.10.7', { 'ci.yml': 'image: camunda/camunda:latest' }).length, 1);
});
