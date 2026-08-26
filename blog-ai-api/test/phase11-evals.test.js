'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPhase11Report,
  idDiff,
  tableHasHeader
} = require('../evals/phase11-run');
const { loadCorpus } = require('../lib/corpus');

test('phase 11 report covers ingestion, metrics, privacy, flags, and rollback', async () => {
  const report = await buildPhase11Report(loadCorpus());

  assert.equal(report.phase, 11);
  assert.equal(report.ingestion.tokenCount.p95, 433);
  assert.equal(report.ingestion.vectors.coverage, 1);
  assert.equal(
    report.ingestion.chunkIdChurn.deployment.chunkIdChurnRatio,
    0
  );
  assert.equal(report.privacy.passed, true);
  assert.equal(report.rollback.passed, true);
  assert.equal(report.rollback.full.memoryRecordRetained, true);
  assert.deepEqual(
    Object.values(report.acceptance.checks).filter(value => !value),
    []
  );
  assert.equal(report.acceptance.passed, true);
});

test('phase 11 chunk churn counts stable updates separately from ID churn', () => {
  const diff = idDiff([
    { id: 'a', contentHash: 'old' },
    { id: 'b', contentHash: 'same' }
  ], [
    { id: 'a', contentHash: 'new' },
    { id: 'c', contentHash: 'added' }
  ]);

  assert.equal(diff.added, 1);
  assert.equal(diff.deleted, 1);
  assert.equal(diff.updated, 1);
  assert.equal(diff.chunkIdChurnRatio, 1);
  assert.equal(diff.contentUpdateRatio, 1);
});

test('phase 11 table header heuristic requires a labeled multi-column first row', () => {
  assert.equal(tableHasHeader({
    content: '方式 | 控制方式\nRemoveMessage | 删除指定消息'
  }), true);
  assert.equal(tableHasHeader({ content: '只有一行' }), false);
});
