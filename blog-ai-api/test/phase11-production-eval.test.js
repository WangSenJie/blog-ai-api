'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  allFlagsPresent,
  askRecord,
  parseArgs,
  stageMetrics
} = require('../evals/phase11-production-run');

test('phase 11 production parser is preview-only unless execute is explicit', () => {
  const preview = parseArgs([]);
  const execute = parseArgs([
    '--execute',
    '--proxy',
    'http://127.0.0.1:7890',
    '--timeout-ms',
    '30000'
  ]);

  assert.equal(preview.execute, false);
  assert.equal(execute.execute, true);
  assert.equal(execute.proxy, 'http://127.0.0.1:7890');
  assert.equal(execute.timeoutMs, 30000);
});

test('phase 11 production record keeps operational metrics and drops content', () => {
  const body = {
    answer: 'not retained',
    claims: [{ text: 'not retained' }],
    citations: [{ chunkId: 'chunk_1' }],
    memory: {
      status: 'active',
      writeStatus: 'committed',
      expiresAt: '2026-09-26T00:00:00.000Z',
      memoryToken: 'not-retained'
    },
    meta: {
      traceId: 'trace_phase11_prod',
      releaseFlags: {
        ragChunkV2: true,
        remoteEmbedding: true,
        semanticReranker: true,
        memoryV1: true,
        naturalAnswerV2: true,
        semanticVerifier: true
      },
      retrieval: { strategy: 'hybrid_rrf_rerank', selectedChunks: 3 },
      toolCalls: [{
        retrieval: {
          bm25Candidates: 20,
          vectorCandidates: 20,
          fusedCandidates: 32,
          rerankedCandidates: 20,
          embeddingRequests: 1,
          embeddingFailures: 0,
          embedding429: 0,
          embedding5xx: 0
        }
      }],
      citationVerification: { status: 'verified' },
      timings: { retrievalMs: 10, totalMs: 20 }
    }
  };
  const record = askRecord('fixture', {
    status: 200,
    body,
    clientElapsedMs: 25
  });

  assert.equal(allFlagsPresent(record.releaseFlags), true);
  assert.equal(record.stageMetrics.contractPresent, true);
  assert.equal(record.stageMetrics.denseCandidates, 20);
  assert.equal(record.memory.ttlPresent, true);
  assert.equal(JSON.stringify(record).includes('not retained'), false);
  assert.equal(JSON.stringify(record).includes('not-retained'), false);
  assert.deepEqual(stageMetrics(body).embeddingFailures, 0);
});
