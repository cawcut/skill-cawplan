#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildRefs,
  buildRefsForCase,
  resolveCaseIdentity,
  computeContentHash,
} = require('./refs_utils');

function test(name, fn) {
  try {
    fn();
    console.log('ok', name);
  } catch (err) {
    console.error('FAIL', name, err);
    process.exitCode = 1;
  }
}

test('buildRefs includes case identity', () => {
  assert.strictEqual(
    buildRefs('req-1', 'tp-1', 'login-main'),
    'cawplan:req-1;cawplan:tp-1;cawplan:case_login-main',
  );
});

test('resolveCaseIdentity prefers sourceCaseKey', () => {
  assert.strictEqual(
    resolveCaseIdentity({
      sourceCaseKey: 'login-main',
      contentHash: 'sha256:abc',
      title: 'Login test',
    }),
    'login-main',
  );
});

test('resolveCaseIdentity falls back to contentHash', () => {
  assert.strictEqual(
    resolveCaseIdentity({ contentHash: 'sha256:abc', title: 'Login test' }),
    'sha256:abc',
  );
});

test('resolveCaseIdentity computes hash from content', () => {
  const got = resolveCaseIdentity({ title: 'Login test', steps: [], expected: [] });
  assert.ok(got.startsWith('sha256:'));
  assert.strictEqual(
    got,
    computeContentHash('Login test', [], [], '', undefined, undefined),
  );
});

test('same test point different content yields different refs', () => {
  const a = buildRefsForCase({
    requirementId: 'req-1',
    testPointId: 'tp-1',
    title: 'Case A',
    steps: ['s1'],
    expected: ['e1'],
  });
  const b = buildRefsForCase({
    requirementId: 'req-1',
    testPointId: 'tp-1',
    title: 'Case B',
    steps: ['s1'],
    expected: ['e1'],
  });
  assert.notStrictEqual(a, b);
});

test('title-only case uses empty steps array in hash', () => {
  const h = computeContentHash('Only title', [], [], '', '正向', undefined);
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
});

test('buildRefsForCase wires requirement and test point ids', () => {
  const refs = buildRefsForCase({
    requirementId: 'req-1',
    testPointId: 'tp-1',
    title: 'Login test',
    steps: [],
    expected: [],
  });
  assert.ok(refs.startsWith('cawplan:req-1;cawplan:tp-1;cawplan:case_sha256:'));
});
