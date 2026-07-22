'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadCorpus } = require('../lib/corpus');
const {
  BLOG_ORIGIN,
  isAllowedPostUrl,
  normalizePostUrl
} = require('../lib/retrieval-core');
const { buildResponse, detectMode, rankChunks } = require('../lib/retrieve');

function makeChunk(values) {
  return Object.assign({
    id: '',
    postTitle: '',
    postUrl: '',
    tags: [],
    categories: [],
    sectionTitle: '',
    content: ''
  }, values);
}

test('rankChunks prioritizes an exact title match', () => {
  const chunks = [
    makeChunk({
      id: 'other#0',
      postTitle: '推荐系统概览',
      postUrl: '/overview/',
      content: '召回阶段可以使用多种模型。'
    }),
    makeChunk({
      id: 'tower#0',
      postTitle: '双塔模型',
      postUrl: '/double-tower/',
      tags: ['召回'],
      content: '用户塔和物品塔分别输出向量并计算相似度。'
    })
  ];

  const ranked = rankChunks(chunks, '双塔模型', 'site', null);

  assert.equal(ranked[0].chunk.id, 'tower#0');
  assert.ok(ranked[0].score > 0);
});

test('post URL normalization only accepts HTTPS URLs on the blog origin', () => {
  const allowedCases = [
    {
      input: '/2026/07/22/rag?from=test#section',
      normalized: `${BLOG_ORIGIN}/2026/07/22/rag/`
    },
    {
      input: `${BLOG_ORIGIN}/2026/07/22/rag///`,
      normalized: `${BLOG_ORIGIN}/2026/07/22/rag/`
    },
    {
      input: BLOG_ORIGIN,
      normalized: `${BLOG_ORIGIN}/`
    }
  ];

  for (const item of allowedCases) {
    assert.equal(isAllowedPostUrl(item.input), true, item.input);
    assert.equal(normalizePostUrl(item.input), item.normalized, item.input);
  }

  const blockedCases = [
    'https://example.com/2026/07/22/rag/',
    'https://wangsenjie.github.io.example.com/rag/',
    'http://wangsenjie.github.io/rag/',
    '//wangsenjie.github.io/rag/',
    'https://user:password@wangsenjie.github.io/rag/',
    '/safe\\unsafe/',
    'relative/path',
    'wangsenjie.github.io/rag/',
    'javascript:alert(1)',
    ''
  ];

  for (const value of blockedCases) {
    assert.equal(isAllowedPostUrl(value), false, value);
    assert.equal(normalizePostUrl(value), '', value);
  }
});

test('rankChunks excludes chunks with missing fields or non-blog URLs', () => {
  const chunks = [
    makeChunk({
      id: 'valid#0',
      postTitle: 'Sentinel Article',
      postUrl: '/sentinel/',
      content: 'sentinel retrieval content'
    }),
    makeChunk({
      id: '',
      postTitle: 'Missing ID',
      postUrl: '/missing-id/',
      content: 'sentinel retrieval content'
    }),
    makeChunk({
      id: 'missing-title#0',
      postTitle: '',
      postUrl: '/missing-title/',
      content: 'sentinel retrieval content'
    }),
    makeChunk({
      id: 'external#0',
      postTitle: 'External Article',
      postUrl: 'https://example.com/external/',
      content: 'sentinel retrieval content'
    }),
    makeChunk({
      id: 'missing-content#0',
      postTitle: 'Missing Content',
      postUrl: '/missing-content/',
      content: '   '
    })
  ];

  const ranked = rankChunks(chunks, 'sentinel', 'site', null);

  assert.deepEqual(ranked.map(item => item.chunk.id), ['valid#0']);
});

test('page summary only returns chunks from the current page in source order', () => {
  const chunks = [
    makeChunk({
      id: 'page-a#0',
      postTitle: '文章 A',
      postUrl: '/a/',
      content: '第一部分。'
    }),
    makeChunk({
      id: 'page-b#0',
      postTitle: '文章 B',
      postUrl: '/b/',
      content: '另一篇文章。'
    }),
    makeChunk({
      id: 'page-a#1',
      postTitle: '文章 A',
      postUrl: '/a/',
      content: '第二部分。'
    })
  ];

  const ranked = rankChunks(
    chunks,
    '总结这篇文章',
    detectMode('总结这篇文章'),
    { url: '/a/' }
  );

  assert.deepEqual(ranked.map(item => item.chunk.id), ['page-a#0', 'page-a#1']);
});

test('buildResponse exposes a resolvable chunk ID and section for citations', () => {
  const chunks = [makeChunk({
    id: 'tower#0',
    postTitle: '双塔模型',
    postUrl: '/double-tower/',
    sectionTitle: '模型结构',
    content: '双塔模型由用户塔和物品塔组成。'
  })];
  const ranked = [{
    chunk: chunks[0],
    score: 10,
    position: 0
  }];

  const response = buildResponse('什么是双塔模型？', ranked, null, 'site');

  assert.equal(response.citations.length, 1);
  assert.equal(response.citations[0].chunkId, 'tower#0');
  assert.equal(response.citations[0].section, '模型结构');
  assert.equal(response.citations[0].title, '双塔模型');
  assert.equal(response.citations[0].url, `${BLOG_ORIGIN}/double-tower/`);

  const sourceChunk = chunks.find(chunk => chunk.id === response.citations[0].chunkId);
  assert.ok(sourceChunk);
  assert.equal(sourceChunk.sectionTitle, response.citations[0].section);
  assert.equal(normalizePostUrl(sourceChunk.postUrl), response.citations[0].url);
});

test('citations returned from the deployed corpus resolve to their source chunks', () => {
  const corpus = loadCorpus();
  const seedChunk = corpus.chunks.find(chunk => chunk.sectionTitle && chunk.postTitle);
  assert.ok(seedChunk, 'expected at least one corpus chunk with a section');

  const ranked = rankChunks(corpus.chunks, seedChunk.postTitle, 'site', null);
  const response = buildResponse(seedChunk.postTitle, ranked, null, 'site');
  const chunksById = new Map(corpus.chunks.map(chunk => [chunk.id, chunk]));

  assert.ok(response.citations.length > 0);
  for (const citation of response.citations) {
    const sourceChunk = chunksById.get(citation.chunkId);
    assert.ok(sourceChunk, `missing source chunk for ${citation.chunkId}`);
    assert.equal(citation.section, sourceChunk.sectionTitle || '');
    assert.equal(citation.title, sourceChunk.postTitle);
    assert.equal(citation.url, normalizePostUrl(sourceChunk.postUrl));
  }
});

test('detectMode recognizes summary, current-page, and site questions', () => {
  assert.equal(detectMode('总结这篇文章'), 'page_summary');
  assert.equal(detectMode('这篇适合谁看？'), 'page');
  assert.equal(detectMode('什么是 ResNet？'), 'site');
});
