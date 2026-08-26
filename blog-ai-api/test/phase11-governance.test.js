'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildVectorIndex } = require('../lib/embedding');
const {
  hybridRankChunks,
  hybridRankChunksAsync
} = require('../lib/hybrid-retrieve');
const {
  buildAskMetrics,
  safeErrorCode
} = require('../lib/observability');
const {
  getReleaseFlags,
  publicReleaseFlags
} = require('../lib/release-flags');

function chunks() {
  return [{
    id: 'chunk_phase11_tower',
    contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    postId: 'tower',
    postTitle: '双塔模型',
    postUrl: '/double-tower/',
    tags: ['推荐系统'],
    categories: [],
    headingPath: ['结构'],
    sectionTitle: '结构',
    content: '双塔模型分别编码用户和物品，并计算向量相似度。'
  }];
}

test('phase 11 feature flags preserve legacy defaults and support independent rollback', () => {
  assert.deepEqual(publicReleaseFlags({}), {
    ragChunkV2: true,
    remoteEmbedding: true,
    semanticReranker: true,
    memoryV1: false,
    naturalAnswerV2: false,
    semanticVerifier: false
  });
  const legacyAliases = getReleaseFlags({
    GROUNDED_SYNTHESIS_ENABLED: 'true',
    SEMANTIC_VERIFICATION_ENABLED: 'true',
    MEMORY_ENABLED: 'true'
  });
  assert.equal(legacyAliases.naturalAnswerV2Enabled, true);
  assert.equal(legacyAliases.semanticVerifierEnabled, true);
  assert.equal(legacyAliases.memoryV1Enabled, true);

  const rolledBack = getReleaseFlags({
    RAG_CHUNK_V2_ENABLED: 'false',
    REMOTE_EMBEDDING_ENABLED: 'false',
    SEMANTIC_RERANKER_ENABLED: 'false',
    MEMORY_V1_ENABLED: 'false',
    NATURAL_ANSWER_V2_ENABLED: 'false',
    SEMANTIC_VERIFIER_ENABLED: 'false'
  });
  assert.deepEqual(Object.values(rolledBack), [false, false, false, false, false, false]);
});

test('remote embedding and semantic reranker have independent safe fallbacks', async () => {
  const corpusChunks = chunks();
  const vectors = buildVectorIndex(corpusChunks, []).vectors;
  let providerCalls = 0;
  const bm25 = await hybridRankChunksAsync(
    corpusChunks,
    vectors,
    '双塔模型',
    'site',
    null,
    {
      remoteEmbeddingEnabled: false,
      provider: { embedQuery: async () => { providerCalls += 1; } }
    }
  );
  const rrf = hybridRankChunks(
    corpusChunks,
    vectors,
    '双塔模型',
    'site',
    null,
    { semanticRerankerEnabled: false }
  );

  assert.equal(providerCalls, 0);
  assert.equal(bm25.strategy, 'bm25');
  assert.equal(bm25.stats.fallback, 'remote_embedding_feature_flag');
  assert.equal(rrf.strategy, 'hybrid_rrf');
  assert.equal(rrf.stats.semanticRerankerEnabled, false);
});

test('operational metrics expose stage counts without tokens, input, or memory content', () => {
  const secret = 'secret-value-that-must-never-be-logged';
  const metrics = buildAskMetrics({
    answer: 'private answer text',
    claims: [{ text: 'private claim' }],
    citations: [{ chunkId: 'chunk_1' }],
    unansweredSubquestions: [],
    memory: {
      status: 'active',
      writeStatus: 'duplicate',
      replayed: true,
      expiresAt: '2026-08-26T01:00:00.000Z',
      memoryToken: `m1.${secret}`,
      summary: 'private memory'
    },
    meta: {
      traceId: 'trace_phase11',
      route: 'site_qa',
      mode: 'site',
      indexVersion: 'index-v1',
      standaloneQuery: 'private user input',
      retrieval: { selectedChunks: 3 },
      toolCalls: [{
        retrieval: {
          bm25Candidates: 20,
          vectorCandidates: 20,
          fusedCandidates: 31,
          rerankedCandidates: 20,
          embeddingRequests: 1,
          embeddingFailures: 1,
          embedding429: 1,
          embedding5xx: 0,
          embeddingEstimatedCostUsd: 0.000001,
          fallbackCode: 'EMBEDDING_RATE_LIMITED',
          apiKey: secret
        }
      }],
      model: {
        generationAttempted: true,
        generationSchemaValid: true,
        verificationAttempted: true,
        verificationSchemaValid: true,
        accepted: true
      },
      citationVerification: { status: 'verified', reasons: [] },
      timings: {
        retrievalMs: 10,
        generationMs: 20,
        semanticVerificationMs: 30,
        totalMs: 60
      }
    }
  }, {
    now: Date.parse('2026-08-26T00:00:00.000Z'),
    releaseFlags: publicReleaseFlags({})
  });
  const serialized = JSON.stringify(metrics);

  assert.equal(metrics.retrieval.bm25Candidates, 20);
  assert.equal(metrics.retrieval.denseCandidates, 20);
  assert.equal(metrics.retrieval.rrfCandidates, 31);
  assert.equal(metrics.retrieval.rerankerCandidates, 20);
  assert.equal(metrics.retrieval.finalCandidates, 3);
  assert.equal(metrics.retrieval.embedding429, 1);
  assert.equal(metrics.memory.idempotencyHit, true);
  assert.equal(metrics.memory.ttlSecondsRemaining, 3600);
  for (const forbidden of [
    secret,
    'private answer text',
    'private claim',
    'private memory',
    'private user input',
    'memoryToken',
    'standaloneQuery'
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(
    safeErrorCode({ code: `bad ${secret}`, message: secret }, 'SAFE_FAILURE'),
    'SAFE_FAILURE'
  );
});
