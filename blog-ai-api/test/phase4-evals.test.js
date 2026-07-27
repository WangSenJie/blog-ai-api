'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STRATEGY,
  buildPhase4Report,
  validateDataset
} = require('../evals/phase4-run');
const {
  loadCorpus
} = require('../lib/corpus');

const datasetPath = path.join(__dirname, '..', 'evals', 'phase4-dataset.json');

function readDataset() {
  return JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
}

test('phase 4 dataset separates calibration from holdout evidence cases', () => {
  const dataset = readDataset();

  assert.equal(dataset.strategy, STRATEGY);
  assert.ok(dataset.cases.some(testCase => testCase.split === 'calibration'));
  assert.ok(dataset.cases.some(testCase => testCase.split === 'holdout'));
  assert.equal(validateDataset(dataset, loadCorpus()), true);
});

test('phase 4 report passes citation, extractive-claim, and refusal gates', async () => {
  const report = await buildPhase4Report(readDataset(), loadCorpus());

  assert.equal(report.phase, 4);
  assert.equal(report.acceptance.passed, true);
  assert.equal(report.acceptance.configMatchesSelection, true);
  assert.equal(report.acceptance.holdout.passedCases, report.acceptance.holdout.cases);
  assert.equal(report.acceptance.holdout.citationCompleteness, 1);
  assert.equal(report.acceptance.holdout.citationSupport, 1);
  assert.equal(report.acceptance.holdout.citationProvenance, 1);
  assert.equal(report.acceptance.holdout.extractiveClaims, 1);
  assert.equal(report.acceptance.holdout.unsupportedClaimRate, 0);
  assert.equal(report.acceptance.holdout.rejectionRecall, 1);
  assert.equal(report.acceptance.holdout.rejectionPrecision, 1);
  assert.deepEqual(report.failedCases, []);
});
