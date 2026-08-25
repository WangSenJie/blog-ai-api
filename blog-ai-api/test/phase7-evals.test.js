'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPhase7Report
} = require('../evals/phase7-run');
const {
  loadCorpus
} = require('../lib/corpus');

test('phase 7 report passes Chunk v2, hybrid, fallback, and browser-boundary gates', async () => {
  const report = await buildPhase7Report(loadCorpus(), { environment: {} });

  assert.equal(report.phase, 7);
  assert.equal(report.corpus.vectorCoverage, 1);
  assert.equal(report.chunkAudit.passed, true);
  assert.equal(report.browserBoundary.passed, true);
  assert.equal(report.fallbackAudit.passed, true);
  assert.equal(report.quality.acceptance.passed, true);
  assert.equal(report.acceptance.implementationPassed, true);
  assert.deepEqual(
    Object.values(report.acceptance.checks).filter(value => !value),
    []
  );
});

test('phase 7 recognizes the published managed index without using CI credentials', async () => {
  const report = await buildPhase7Report(loadCorpus(), { environment: {} });

  assert.equal(report.managedEmbedding.target.provider, 'dashscope');
  assert.equal(report.managedEmbedding.target.model, 'qwen3.7-text-embedding');
  assert.equal(report.managedEmbedding.target.dimensions, 1024);
  assert.equal(report.managedEmbedding.configured, false);
  assert.equal(report.managedEmbedding.active, true);
  assert.equal(report.acceptance.releaseReady, true);
  assert.equal(report.acceptance.status, 'passed');
});
