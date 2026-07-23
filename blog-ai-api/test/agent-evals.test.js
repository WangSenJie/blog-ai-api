'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STRATEGY,
  buildAgentReport,
  validateDataset
} = require('../evals/agent-run');
const {
  loadCorpus
} = require('../lib/corpus');

const datasetPath = path.join(__dirname, '..', 'evals', 'agent-dataset.json');

function readDataset() {
  return JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
}

test('phase 3 dataset is independent and explicitly records the BM25 workflow', () => {
  const dataset = readDataset();

  assert.equal(dataset.version, 4);
  assert.equal(dataset.strategy, STRATEGY);
  assert.equal(dataset.stage2Implemented, false);
  assert.ok(dataset.cases.length >= 15);
  assert.equal(
    new Set(dataset.cases.map(testCase => testCase.id)).size,
    dataset.cases.length
  );
  assert.equal(validateDataset(dataset, loadCorpus()), true);
});

test('offline Agent report passes workflow, reference, safety, and limit gates', async () => {
  const report = await buildAgentReport(readDataset(), loadCorpus());

  assert.equal(report.strategy, 'bm25_agent_workflow');
  assert.equal(report.stage2Implemented, false);
  assert.equal(report.acceptance.passed, true);
  assert.equal(report.summary.passedCases, report.summary.cases);
  assert.equal(report.summary.referenceResolutionAccuracy, 1);
  assert.equal(report.summary.comparisonCoverage, 1);
  assert.equal(report.summary.safeStopAccuracy, 1);
  assert.equal(report.summary.limitCompliance, 1);
  assert.ok(report.summary.maxRetrievalAttempts <= 2);
  assert.deepEqual(report.failedCases, []);
});

test('Agent dataset validation rejects phase-2 claims and unknown article labels', () => {
  const corpus = loadCorpus();
  const stageTwoClaim = readDataset();
  stageTwoClaim.stage2Implemented = true;
  assert.throws(
    () => validateDataset(stageTwoClaim, corpus),
    /stage2Implemented=false/
  );

  const unknownTitle = readDataset();
  unknownTitle.cases[1].expected.relevantPostTitles = [
    '不存在的文章'
  ];
  assert.throws(
    () => validateDataset(unknownTitle, corpus),
    /Unknown article title/
  );
});
