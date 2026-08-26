'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  executionPlan,
  parseArgs,
  responseRecord,
  resumableExecution,
  summarize,
  validateDataset,
  validateRuntimeOptions
} = require('../evals/phase10-production-run');

const SHIPPED_DATASET = JSON.parse(fs.readFileSync(path.join(
  __dirname,
  '..',
  'evals',
  'phase10-production-dataset.json'
), 'utf8'));

function fixtureDataset() {
  return {
    version: 'test-v1',
    strategy: 'grounded-answer-v2-production-gray',
    formalSampleMin: 3,
    targets: {
      httpSuccessRate: 1,
      rolloutSelectionRate: 1,
      generationSchemaSuccessRate: 0.99,
      verificationSchemaSuccessRate: 0.99,
      unsafeAnswerRate: 0,
      acceptedWithoutCitationRate: 0,
      answerableCoverage: 0.5,
      dualModelP95Ms: 12000
    },
    cases: [{
      id: 'answer',
      category: 'answerable',
      question: '双塔模型是什么？',
      expected: 'answer',
      expectedTitles: ['双塔模型']
    }, {
      id: 'refuse',
      category: 'refusal',
      question: 'Kubernetes 是什么？',
      expected: 'refuse'
    }, {
      id: 'near',
      category: 'near_match',
      question: '双塔模型如何使用 Dropout？',
      expected: 'refuse'
    }]
  };
}

function productionResponse(values) {
  const settings = Object.assign({
    accepted: false,
    attempted: false,
    claims: [],
    citations: [],
    totalMs: 100
  }, values || {});
  return {
    status: 200,
    body: {
      claims: settings.claims,
      citations: settings.citations,
      meta: {
        evidenceStatus: settings.accepted ? 'sufficient' : 'insufficient',
        phase10: { rolloutSelected: true },
        model: {
          generationAttempted: settings.attempted,
          generationSchemaValid: settings.attempted,
          verificationAttempted: settings.attempted,
          verificationSchemaValid: settings.attempted,
          accepted: settings.accepted,
          rejectionReason: settings.accepted ? '' : 'no_verified_direct_claim'
        },
        citationVerification: settings.accepted
          ? { source: 'semantic_verifier_v2' }
          : { status: 'not_required' },
        timings: { totalMs: settings.totalMs },
        traceId: 'trace_test'
      }
    }
  };
}

test('shipped production dataset covers all three bounded categories', () => {
  validateDataset(SHIPPED_DATASET);
  assert.equal(SHIPPED_DATASET.cases.length, 20);
  assert.deepEqual(
    [...new Set(SHIPPED_DATASET.cases.map(item => item.category))].sort(),
    ['answerable', 'near_match', 'refusal']
  );
});

test('production summary passes safe answer, refusal, and near-match fixtures', () => {
  const dataset = validateDataset(fixtureDataset());
  const answer = responseRecord(dataset.cases[0], 1, productionResponse({
    accepted: true,
    attempted: true,
    claims: [{ id: 'claim_1' }],
    citations: [{ title: '双塔模型' }],
    totalMs: 5000
  }), 5100);
  const refusal = responseRecord(
    dataset.cases[1],
    1,
    productionResponse(),
    120
  );
  const near = responseRecord(
    dataset.cases[2],
    1,
    productionResponse(),
    130
  );
  const acceptance = summarize(dataset, [answer, refusal, near]);

  assert.equal(acceptance.formalSampleReady, true);
  assert.equal(acceptance.passed, true);
  assert.equal(acceptance.metrics.answerableCoverage, 1);
  assert.equal(acceptance.metrics.unsafeAnswerRate, 0);
  assert.equal(acceptance.metrics.acceptedWithoutCitationRate, 0);
  assert.equal(acceptance.metrics.dualModelLatencyMs.p95, 5000);
});

test('accepted answers without a published claim and citation fail the gate', () => {
  const dataset = validateDataset(fixtureDataset());
  const broken = responseRecord(
    dataset.cases[0],
    1,
    productionResponse({ accepted: true, attempted: true }),
    100
  );
  assert.equal(broken.passed, false);
  const acceptance = summarize(dataset, [
    broken,
    responseRecord(dataset.cases[1], 1, productionResponse(), 100),
    responseRecord(dataset.cases[2], 1, productionResponse(), 100)
  ]);
  assert.equal(acceptance.metrics.acceptedWithoutCitation, 1);
  assert.equal(acceptance.checks.acceptedWithoutCitationRate, false);
  assert.equal(acceptance.passed, false);
});

test('execution requires an explicit flag and keeps request counts bounded', () => {
  const options = parseArgs([
    '--execute',
    '--repetitions', '5',
    '--max-requests', '7',
    '--proxy', 'http://127.0.0.1:7890'
  ]);
  validateRuntimeOptions(options);
  assert.equal(options.execute, true);
  assert.equal(options.repetitions, 5);
  assert.equal(executionPlan(fixtureDataset(), options).length, 7);
  assert.throws(
    () => parseArgs(['--repetitions', '0']),
    /repetitions must be an integer/
  );
  assert.throws(
    () => validateRuntimeOptions(Object.assign({}, options, {
      endpoint: 'http://example.com/api/ask'
    })),
    /must use HTTPS/
  );
});

test('resume reruns only transport failures and retains completed responses', () => {
  const dataset = fixtureDataset();
  const options = parseArgs(['--repetitions', '1']);
  const completed = dataset.cases.map((item, index) => ({
    id: item.id,
    iteration: 1,
    status: index === 1 ? 0 : 200
  }));
  const execution = resumableExecution(dataset, options, {
    dataset: {
      hash: require('../evals/phase10-production-run').datasetHash(dataset),
      repetitions: 1
    },
    results: completed
  });

  assert.equal(execution.queue.length, 1);
  assert.equal(execution.queue[0].testCase.id, 'refuse');
  assert.equal(execution.retained.length, 2);
});
