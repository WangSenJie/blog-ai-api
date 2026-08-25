'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildVectorIndexAsync,
  providerMetadata
} = require('../lib/embedding');
const {
  DEFAULT_DIMENSIONS,
  DEFAULT_MODEL,
  createDashScopeProvider
} = require('../lib/embedding-providers/dashscope');
const {
  expandParentContext,
  hybridRankChunksAsync
} = require('../lib/hybrid-retrieve');

function response(status, payload, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers && headers[String(name).toLowerCase()] || null;
      }
    },
    async json() {
      return payload;
    }
  };
}

function makeChunk(id, values) {
  return Object.assign({
    id,
    contentHash: `sha256:${id.padEnd(64, 'a').slice(0, 64)}`,
    postId: 'post',
    postTitle: '测试文章',
    postUrl: '/test/',
    tags: [],
    categories: [],
    headingPath: ['测试小节'],
    sectionTitle: '测试小节',
    chunkType: 'prose',
    content: '向量检索测试正文'
  }, values || {});
}

function fakeProvider(overrides) {
  return Object.assign({
    name: 'dashscope',
    model: DEFAULT_MODEL,
    dimensions: 2,
    version: 1,
    normalization: 'l2-client-v1',
    maxBatchSize: 10,
    async embedDocuments(inputs) {
      return {
        vectors: inputs.map(() => [1, 0]),
        usage: { promptTokens: inputs.length, totalTokens: inputs.length }
      };
    },
    async embedQuery() {
      return [1, 0];
    }
  }, overrides || {});
}

test('DashScope provider defaults to qwen3.7 with the 1024-dimensional API contract', async () => {
  let request = null;
  const provider = createDashScopeProvider({
    apiKey: 'test-key',
    workspaceId: 'workspace-test',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return response(200, {
        id: 'request-1',
        data: [{ index: 0, embedding: Array(DEFAULT_DIMENSIONS).fill(0).map((_, index) => index ? 0 : 1) }],
        usage: { prompt_tokens: 7, total_tokens: 7 }
      });
    }
  });

  const vector = await provider.embedQuery('Instruct: retrieve\nQuery: 测试');

  assert.equal(provider.model, DEFAULT_MODEL);
  assert.equal(provider.dimensions, DEFAULT_DIMENSIONS);
  assert.equal(provider.maxBatchSize, 20);
  assert.equal(vector.length, DEFAULT_DIMENSIONS);
  assert.equal(request.url, 'https://workspace-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(request.body, {
    model: DEFAULT_MODEL,
    input: ['Instruct: retrieve\nQuery: 测试'],
    dimensions: DEFAULT_DIMENSIONS,
    encoding_format: 'float'
  });
});

test('DashScope provider applies model-specific batch limits', async () => {
  const fetchImpl = async (_url, options) => {
    const inputs = JSON.parse(options.body).input;
    return response(200, {
      data: inputs.map((_input, index) => ({ index, embedding: [1, 0] }))
    });
  };
  const qwen = createDashScopeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://embedding.example.test/v1',
    dimensions: 2,
    fetchImpl
  });
  const legacy = createDashScopeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://embedding.example.test/v1',
    model: 'text-embedding-v4',
    dimensions: 2,
    fetchImpl
  });

  assert.equal((await qwen.embedDocuments(Array(20).fill('qwen'))).vectors.length, 20);
  assert.equal(legacy.maxBatchSize, 10);
  await assert.rejects(
    legacy.embedDocuments(Array(11).fill('legacy')),
    error => error && error.code === 'EMBEDDING_INVALID_INPUT'
  );
});

test('DashScope provider retries a rate-limited request and preserves input order', async () => {
  let attempts = 0;
  const provider = createDashScopeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://embedding.example.test/v1',
    dimensions: 2,
    maxRetries: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return response(429, { error: { message: 'slow down' } }, { 'retry-after': '0' });
      }
      return response(200, {
        data: [
          { index: 1, embedding: [0, 2] },
          { index: 0, embedding: [3, 0] }
        ]
      });
    }
  });

  const result = await provider.embedDocuments(['first', 'second']);

  assert.equal(attempts, 2);
  assert.deepEqual(result.vectors, [[1, 0], [0, 1]]);
});

test('DashScope provider retries timeouts and returns a stable error code', async () => {
  let attempts = 0;
  const provider = createDashScopeProvider({
    apiKey: 'test-key',
    baseUrl: 'https://embedding.example.test/v1',
    dimensions: 2,
    timeoutMs: 100,
    maxRetries: 1,
    fetchImpl: async (_url, options) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }
  });

  await assert.rejects(
    provider.embedQuery('timeout'),
    error => error && error.code === 'EMBEDDING_TIMEOUT'
  );
  assert.equal(attempts, 2);
});

test('managed vector build reuses only matching content and fingerprints', async () => {
  const provider = fakeProvider();
  const metadata = providerMetadata(provider);
  const chunks = [makeChunk('one'), makeChunk('two')];
  const previous = [{
    id: 'one',
    contentHash: chunks[0].contentHash,
    fingerprint: metadata.fingerprint,
    values: [1, 0]
  }, {
    id: 'two',
    contentHash: chunks[1].contentHash,
    fingerprint: 'sha256:stale',
    values: [1, 0]
  }];

  const result = await buildVectorIndexAsync(chunks, previous, provider, {
    batchSize: 1,
    concurrency: 2
  });

  assert.deepEqual(result.build, {
    added: 0,
    updated: 1,
    reused: 1,
    deleted: 0,
    failed: 0
  });
  assert.equal(result.vectors.length, 2);
  assert.ok(result.vectors.every(vector => vector.fingerprint === metadata.fingerprint));
});

test('managed vector build reports empty vectors instead of publishing them', async () => {
  const provider = fakeProvider({
    async embedDocuments(inputs) {
      return { vectors: inputs.map(() => [0, 0]), usage: {} };
    }
  });
  const result = await buildVectorIndexAsync(
    [makeChunk('empty')],
    [],
    provider
  );

  assert.equal(result.vectors.length, 0);
  assert.equal(result.build.failed, 1);
  assert.equal(result.failures[0].code, 'EMBEDDING_EMPTY_VECTOR');
});

test('async hybrid retrieval falls back to BM25 on rate limits', async () => {
  const provider = fakeProvider({
    async embedQuery() {
      const error = new Error('rate limited');
      error.code = 'EMBEDDING_RATE_LIMITED';
      throw error;
    }
  });
  const metadata = providerMetadata(provider);
  const chunks = [makeChunk('fallback', { content: '限流时仍然使用关键词检索' })];
  const vectors = [{
    id: chunks[0].id,
    contentHash: chunks[0].contentHash,
    fingerprint: metadata.fingerprint,
    values: [1, 0]
  }];
  const result = await hybridRankChunksAsync(
    chunks,
    vectors,
    '关键词检索',
    'site',
    null,
    { provider, manifest: { embedding: metadata } }
  );

  assert.equal(result.strategy, 'bm25');
  assert.equal(result.ranked[0].chunk.id, 'fallback');
  assert.equal(result.stats.fallback, 'embedding_rate_limited');
  assert.equal(result.stats.fallbackCode, 'EMBEDDING_RATE_LIMITED');
});

test('async hybrid retrieval rejects a fingerprint mismatch before remote query', async () => {
  let called = false;
  const provider = fakeProvider({
    async embedQuery() {
      called = true;
      return [1, 0];
    }
  });
  const metadata = providerMetadata(provider);
  const chunks = [makeChunk('mismatch', { content: '指纹不一致回退关键词检索' })];
  const result = await hybridRankChunksAsync(
    chunks,
    [],
    '关键词检索',
    'site',
    null,
    {
      provider,
      manifest: {
        embedding: Object.assign({}, metadata, {
          fingerprint: `sha256:${'0'.repeat(64)}`
        })
      }
    }
  );

  assert.equal(called, false);
  assert.equal(result.strategy, 'bm25');
  assert.equal(result.stats.fallback, 'embedding_fingerprint_mismatch');
});

test('parent expansion adds an adjacent child without displacing primary results', () => {
  const chunks = [
    makeChunk('child-a', { parentId: 'parent-1', childOrdinal: 0, content: '第一段' }),
    makeChunk('child-b', { parentId: 'parent-1', childOrdinal: 1, content: '第二段' }),
    makeChunk('child-c', { parentId: 'parent-2', childOrdinal: 0, content: '第三段' })
  ];
  const ranked = [{
    chunk: chunks[0],
    rank: 1,
    score: 1,
    rerankScore: 1,
    position: 0
  }, {
    chunk: chunks[2],
    rank: 2,
    score: 0.9,
    rerankScore: 0.9,
    position: 2
  }];

  const expanded = expandParentContext(chunks, ranked, {
    rerankTopK: 5,
    maxChunksPerPost: 3
  });

  assert.deepEqual(expanded.slice(0, 2).map(item => item.chunk.id), ['child-a', 'child-c']);
  assert.equal(expanded[2].chunk.id, 'child-b');
  assert.equal(expanded[2].contextExpansion, 'adjacent_child');
  assert.equal(expanded[2].expandedFrom, 'child-a');
});
