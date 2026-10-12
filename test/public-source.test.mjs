import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PUBLIC_SCRIPTS, REQUIRED_REPORT_FILES, assertPublicSourceFiles} from '../scripts/public-source-files.mjs';

const required = [...REQUIRED_REPORT_FILES, ...PUBLIC_SCRIPTS.map(name => 'scripts/' + name)];
test('public source includes report collectors, bridge, policy, tests and local release tools', () => {
  assert.equal(new Set(required).size, required.length);
  for (const name of required) assert(fs.statSync(name).isFile(), name);
  assert.doesNotThrow(() => assertPublicSourceFiles(required));
});

test('public package fails closed for each missing report dependency or verification tool', () => {
  for (const omitted of required) {
    assert.throws(() => assertPublicSourceFiles(required.filter(name => name !== omitted)),
      error => error.message === 'Missing public source: ' + omitted);
  }
});
