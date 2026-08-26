'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPhase10Report
} = require('../evals/phase10-run');

test('phase 10 report passes local and formal production gates', () => {
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
  assert.equal(report.production.available, true);
  assert.equal(report.production.formalSampleReady, true);
  assert.equal(report.production.metrics.requests, 100);
  assert.equal(report.production.metrics.unsafeAnswerRate, 0);
  assert.equal(report.production.metrics.acceptedWithoutCitationRate, 0);
  assert.ok(report.production.metrics.dualModelLatencyMs.p95 <= 12000);
  assert.equal(report.production.passed, true);
  assert.equal(report.acceptance.productionValidationRequired, false);
  assert.equal(report.acceptance.releaseReady, true);
  assert.equal(report.acceptance.status, 'passed');
});

test('phase 10 remains local-only when a production report is absent', () => {
  const report = buildPhase10Report({
    productionReportPath: '/tmp/phase10-production-report-does-not-exist.json'
  });
  assert.equal(report.production.available, false);
  assert.equal(report.acceptance.localReleaseReady, true);
  assert.equal(report.acceptance.productionValidationRequired, true);
  assert.equal(report.acceptance.releaseReady, false);
  assert.equal(report.acceptance.status, 'local_passed');
});
