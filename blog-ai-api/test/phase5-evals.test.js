'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  STRATEGY,
  buildPhase5Report,
  materializeRequest,
  validateDataset
} = require('../evals/phase5-run');
const {
  loadCorpus
} = require('../lib/corpus');

const datasetPath = path.join(__dirname, '..', 'evals', 'phase5-dataset.json');

function readDataset() {
  return JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
}

test('phase 5 dataset uses the v3 serving corpus and covers every specialist boundary', () => {
  const dataset = readDataset();
  const corpus = loadCorpus();
  const categories = new Set(dataset.cases.map(testCase => testCase.category));

  assert.equal(dataset.version, 1);
  assert.equal(dataset.strategy, STRATEGY);
  assert.ok(corpus.manifest.schemaVersion >= 3);
  assert.ok(corpus.codeBlocks.length > 0);
  assert.ok(corpus.learningGraph.tracks.length > 0);
  assert.ok(categories.has('comparison'));
  assert.ok(categories.has('learning_path'));
  assert.ok(categories.has('next_article'));
  assert.ok(categories.has('code'));
  assert.ok(categories.has('safe_refusal'));
  assert.equal(validateDataset(dataset, corpus), true);
});

test('phase 5 block-ID fixture is generated from the current source-code artifact', () => {
  const dataset = readDataset();
  const corpus = loadCorpus();
  const idCase = dataset.cases.find(testCase => (
    testCase.expected && testCase.expected.code &&
    testCase.expected.code.selector === 'block_id'
  ));
  const materialized = materializeRequest(idCase, corpus);

  assert.ok(materialized.expectedBlock);
  assert.match(materialized.question, new RegExp(materialized.expectedBlock.id));
  assert.equal(materialized.input.page.url, materialized.expectedBlock.postUrl);
});

test('phase 5 report passes structured comparison, author-graph, code, citation, and refusal gates', async () => {
  const report = await buildPhase5Report(readDataset(), loadCorpus());

  assert.equal(report.phase, 5);
  assert.equal(report.acceptance.passed, true);
  assert.equal(report.summary.passedCases, report.summary.cases);
  assert.equal(report.summary.strictCitationSupport, 1);
  assert.equal(report.summary.comparisonAlignment, 1);
  assert.equal(report.summary.authorGraphConformance, 1);
  assert.equal(report.summary.codeArtifactExactness, 1);
  assert.equal(report.summary.safeRefusalRate, 1);
  assert.equal(report.summary.noModelCalls, 1);
  assert.equal(report.summary.limitCompliance, 1);
  assert.deepEqual(report.failedCases, []);
});
