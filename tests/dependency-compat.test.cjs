const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

test('SDK 57 query-string keeps synchronous parse/stringify with the patched decoder', async () => {
  const query = require('query-string');
  assert.deepEqual(
    { ...query.parse('invite=ABC123&label=%E2%88%A3%2B%E2%9F%A9&name=two+players&empty') },
    { invite: 'ABC123', label: '∣+⟩', name: 'two players', empty: null }
  );
  const parameters = { invite: 'ABC123', label: '∣+⟩', name: 'two players' };
  const encoded = query.stringify(parameters, { sort: false });
  assert.ok(encoded.startsWith('invite=ABC123&'));
  assert.deepEqual({ ...query.parse(encoded) }, parameters);
  assert.deepEqual(query.parse('tag=one&tag=two').tag, ['one', 'two']);
  const cjs = require('decode-uri-component');
  const esm = (await import('decode-uri-component')).default;
  for (const input of ['hello%20world', '%E2%88%A3%2B%E2%9F%A9', '%FE%FF', '%C2', '%broken'])
    assert.equal(cjs(input), esm(input));
});

test('malformed percent-encoded deep-link data finishes within a bounded subprocess', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const query = require('query-string'); const parsed = query.parse('invite=' + '%FE'.repeat(4096)); if (typeof parsed.invite !== 'string') process.exit(1);`,
    ],
    { cwd: process.cwd(), timeout: 2000, encoding: 'utf8' }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('xcode retains UUID generation and patched uuid rejects undersized output buffers', () => {
  const xcode = require('xcode');
  const project = xcode.project('compatibility-test.pbxproj');
  project.hash = { project: { objects: {} } };
  const identifiers = new Set(Array.from({ length: 20 }, () => project.generateUuid()));
  assert.equal(identifiers.size, 20);
  for (const id of identifiers) assert.match(id, /^[0-9A-F]{24}$/);
  const uuid = require('uuid');
  assert.throws(() => uuid.v5('sample', uuid.v5.DNS, new Uint8Array(8), 0), RangeError);
});
