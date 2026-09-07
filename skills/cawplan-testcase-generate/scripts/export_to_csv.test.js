#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { HEADERS, buildCsvText } = require('./export_to_csv');

function test(name, fn) {
  try {
    fn();
    console.log('ok', name);
  } catch (err) {
    console.error('FAIL', name, err);
    process.exitCode = 1;
  }
}

const baseCase = {
  title: 'Case one',
  priority: 'P0',
  tag: '正向',
  group: 'G',
  testPointTitle: 'TP title',
  preconditions: 'pre',
  steps: ['s1', 's2'],
  expected: ['e1', 'e2'],
  moduleTreeNodeId: 'node-1',
  requirementId: 'req-1',
  testPointId: 'tp-1',
};

test('HEADERS has 13 columns ending with Refs', () => {
  assert.strictEqual(HEADERS.length, 13);
  assert.strictEqual(HEADERS[12], 'Refs');
});

test('buildCsvText writes Refs on first row only', () => {
  const text = buildCsvText([baseCase]);
  const lines = text.trimEnd().split('\r\n');
  assert.strictEqual(lines.length, 3);
  const first = lines[1].split(',');
  assert.ok(lines[1].includes('cawplan:req-1;cawplan:tp-1;cawplan:case_sha256:'));
  const second = lines[2];
  assert.ok(!second.includes('cawplan:'));
  assert.ok(second.endsWith(',,,,'));
});

test('title-only case still emits Refs', () => {
  const text = buildCsvText([{
    ...baseCase,
    preconditions: '',
    steps: [],
    expected: [],
  }]);
  const lines = text.trimEnd().split('\r\n');
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[1].includes('cawplan:case_sha256:'));
});
