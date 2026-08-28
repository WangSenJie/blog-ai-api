'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildVectorIndex, embeddingInputForChunk } = require('../lib/embedding');
const {
  hybridRankChunks,
  hybridRankChunksAsync
} = require('../lib/hybrid-retrieve');

function makeChunk(values) {
  return Object.assign({
    id: '',
    contentHash: '',
    postId: '',
    postTitle: '',
    postUrl: '',
    tags: [],
    categories: [],
    headingPath: [],
    sectionTitle: '',
    content: ''
  }, values);
}

function chunksForHybridTests() {
  return [
    makeChunk({
      id: 'chunk_tower',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      postId: 'tower',
      postTitle: '双塔模型',
      postUrl: '/double-tower/',
      tags: ['推荐系统', '召回'],
      headingPath: ['模型结构'],
      sectionTitle: '模型结构',
      content: '双塔模型使用用户塔和物品塔分别编码用户与物品，再计算两个向量的相似度。'
    }),
    makeChunk({
      id: 'chunk_filter',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      postId: 'filter',
      postTitle: '曝光过滤',
      postUrl: '/exposure-filter/',
      tags: ['推荐系统'],
      headingPath: ['过滤策略'],
      sectionTitle: '过滤策略',
      content: '召回后需要过滤用户已经看过或已经展示过的内容。'
    }),
    makeChunk({
      id: 'chunk_noise',
      contentHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      postId: 'noise',
      postTitle: '普通数组',
      postUrl: '/array/',
      tags: ['算法'],
      headingPath: ['概览'],
      sectionTitle: '概览',
      content: '数组题可以使用双指针和前缀和优化。'
    })
  ];
}

test('incremental vector build reuses unchanged chunks and updates changed content', () => {
  const chunks = chunksForHybridTests();
  const first = buildVectorIndex(chunks, []);
  const second = buildVectorIndex(chunks, first.vectors);
  const changed = chunks.map(chunk => Object.assign({}, chunk));
  changed[0].contentHash = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
  const third = buildVectorIndex(changed, second.vectors);

  assert.deepEqual(first.build, {
    added: 3,
    updated: 0,
    reused: 0,
    deleted: 0,
    failed: 0
  });
  assert.deepEqual(second.build, {
    added: 0,
    updated: 0,
    reused: 3,
    deleted: 0,
    failed: 0
  });
  assert.deepEqual(third.build, {
    added: 0,
    updated: 1,
    reused: 2,
    deleted: 0,
    failed: 0
  });
});

test('embedding input uses the versioned document template and citation content', () => {
  const chunk = makeChunk({
    content: '可以直接引用的原始正文',
    retrievalText: '标题和标签增强\n可以直接引用的原始正文'
  });

  assert.equal(
    embeddingInputForChunk(chunk),
    'Title: \nSection: \nType: text\n\n可以直接引用的原始正文'
  );
});

test('hybrid retrieval finds a semantic rewrite and returns RRF/reranker metadata', () => {
  const chunks = chunksForHybridTests();
  const vectors = buildVectorIndex(chunks, []).vectors;
  const result = hybridRankChunks(
    chunks,
    vectors,
    '把请求侧和候选侧映射到同一表征空间的召回架构是什么？',
    'site',
    null
  );

  assert.equal(result.strategy, 'hybrid_rrf_rerank');
  assert.equal(result.ranked[0].chunk.id, 'chunk_tower');
  assert.ok(result.stats.vectorCandidates >= 1);
  assert.ok(result.ranked[0].vectorRank >= 1);
  assert.ok(result.ranked[0].rrfScore > 0);
  assert.ok(result.ranked[0].rerankScore > 0);
});

test('hybrid retrieval preserves exact-keyword retrieval and current-page evidence', () => {
  const chunks = chunksForHybridTests();
  const vectors = buildVectorIndex(chunks, []).vectors;
  const exact = hybridRankChunks(chunks, vectors, '曝光过滤', 'site', null);
  const pageAware = hybridRankChunks(
    chunks,
    vectors,
    '推荐系统如何做候选排除？',
    'site',
    { url: '/exposure-filter/' }
  );

  assert.equal(exact.ranked[0].chunk.id, 'chunk_filter');
  assert.equal(pageAware.ranked[0].chunk.id, 'chunk_filter');
});

test('hybrid reranking removes duplicate evidence while retaining current-page context', () => {
  const chunks = chunksForHybridTests();
  chunks.push(makeChunk({
    id: 'chunk_filter_duplicate',
    contentHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    postId: 'filter-copy',
    postTitle: '曝光过滤副本',
    postUrl: '/exposure-filter-copy/',
    tags: ['推荐系统'],
    headingPath: ['过滤策略'],
    sectionTitle: '过滤策略',
    content: chunks[1].content
  }));
  const vectors = buildVectorIndex(chunks, []).vectors;
  const result = hybridRankChunks(
    chunks,
    vectors,
    '如何过滤已经展示给用户的推荐内容？',
    'site',
    { url: '/exposure-filter/' }
  );
  const duplicateIds = new Set(['chunk_filter', 'chunk_filter_duplicate']);

  assert.equal(result.ranked[0].chunk.id, 'chunk_filter');
  assert.equal(
    result.ranked.filter(item => duplicateIds.has(item.chunk.id)).length,
    1
  );
});

test('BM25 degradation still diversifies posts before applying the result limit', async () => {
  const chunks = [];
  for (let index = 0; index < 6; index += 1) {
    chunks.push(makeChunk({
      id: `boost_${index}`,
      contentHash: `sha256:${String(index).repeat(64)}`,
      postId: 'boost',
      postTitle: 'AdaBoost',
      postUrl: '/adaboost/',
      tags: ['集成学习'],
      sectionTitle: '算法',
      content: `集成学习算法与弱学习器 ${'算法 '.repeat(8 - index)}`
    }));
  }
  chunks.push(makeChunk({
    id: 'gbdt_0',
    contentHash: `sha256:${'a'.repeat(64)}`,
    postId: 'gbdt',
    postTitle: 'GBDT',
    postUrl: '/gbdt/',
    tags: ['集成学习'],
    sectionTitle: '算法',
    content: 'GBDT 是一种集成学习算法。'
  }));

  const result = await hybridRankChunksAsync(
    chunks,
    [],
    '集成学习算法',
    'site',
    null,
    {
      remoteEmbeddingEnabled: false,
      maxChunksPerPost: 2,
      rerankTopK: 10
    }
  );

  assert.equal(result.strategy, 'bm25');
  assert.ok(result.ranked.some(item => item.chunk.id === 'gbdt_0'));
  assert.ok(result.ranked.filter(item => (
    item.chunk.postUrl === '/adaboost/'
  )).length <= 2);
});
