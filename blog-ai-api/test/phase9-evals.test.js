'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildPhase9Report } = require('../evals/phase9-run');

test('phase 9 report passes every browser memory and privacy gate', () => {
  const report = buildPhase9Report();
  assert.equal(report.phase, 9);
  assert.equal(report.implementation.passed, true);
  assert.ok(Object.values(report.implementation.checks).every(Boolean));
  assert.equal(report.crossVisitReferences.totalCases, 20);
  assert.equal(report.crossVisitReferences.accuracy, 1);
  assert.equal(report.crossVisitReferences.passed, true);
  assert.ok(Object.values(report.coverage).every(Boolean));
  assert.equal(report.acceptance.releaseReady, true);
  assert.equal(report.acceptance.status, 'passed');
});
