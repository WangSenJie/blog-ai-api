'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPhase10Report
} = require('../evals/phase10-run');

test('phase 10 report passes grounded answer and trusted memory local gates', () => {
  const report = buildPhase10Report();
  assert.equal(report.phase, 10);
  assert.equal(report.implementation.passed, true);
  assert.equal(report.quality.passed, true);
  assert.equal(report.memory.passed, true);
  assert.equal(report.quality.metrics.unsupportedClaimPublishedRate, 0);
  assert.equal(report.quality.metrics.citationSourceValidity, 1);
  assert.equal(report.quality.metrics.duplicateClaimRate, 0);
  assert.ok(report.quality.metrics.requiredSubquestionCoverage >= 0.9);
  assert.ok(report.quality.metrics.modelStageBudgetMs <= 12000);
  assert.equal(report.acceptance.localReleaseReady, true);
  assert.equal(report.acceptance.productionValidationRequired, true);
  assert.equal(report.acceptance.status, 'local_passed');
});
