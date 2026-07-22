'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

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

test('buildResponse keeps citations on the ranked blog content', () => {
  const ranked = [{
    chunk: makeChunk({
      id: 'tower#0',
      postTitle: '双塔模型',
      postUrl: '/double-tower/',
      content: '双塔模型由用户塔和物品塔组成。'
    }),
    score: 10,
    position: 0
  }];

  const response = buildResponse('什么是双塔模型？', ranked, null, 'site');

  assert.equal(response.citations.length, 1);
  assert.equal(response.citations[0].title, '双塔模型');
  assert.equal(response.citations[0].url, '/double-tower/');
});

test('detectMode recognizes summary, current-page, and site questions', () => {
  assert.equal(detectMode('总结这篇文章'), 'page_summary');
  assert.equal(detectMode('这篇适合谁看？'), 'page');
  assert.equal(detectMode('什么是 ResNet？'), 'site');
});
