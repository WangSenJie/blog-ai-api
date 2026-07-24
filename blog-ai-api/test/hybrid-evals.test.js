'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildVectorIndex } = require('../lib/embedding');
const { buildPhase2Report } = require('../evals/hybrid-run');

test('phase 2 report proves semantic gain without exact retrieval regression', () => {
  const chunks = [
    {
      id: 'chunk_tower',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      postId: 'tower',
      postTitle: '双塔模型',
      postUrl: '/double-tower/',
      tags: ['推荐系统'],
      categories: ['推荐算法'],
      headingPath: ['模型结构'],
      sectionTitle: '模型结构',
      content: '双塔模型通过用户塔和物品塔分别编码两侧实体，并计算向量相似度。'
    },
    {
      id: 'chunk_noise',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      postId: 'noise',
      postTitle: '数组',
      postUrl: '/array/',
      tags: ['算法'],
      categories: ['算法'],
      headingPath: ['概览'],
      sectionTitle: '概览',
      content: '数组题可以使用双指针。'
    }
  ];
  const corpus = {
    posts: [
      { id: 'tower', title: '双塔模型', url: '/double-tower/' },
      { id: 'noise', title: '数组', url: '/array/' }
    ],
    chunks,
    vectors: buildVectorIndex(chunks, []).vectors
  };
  const dataset = {
    version: 1,
    cases: [
      {
        id: 'exact',
        category: 'exact',
        question: '双塔模型',
        relevantPostTitles: ['双塔模型']
      },
      {
        id: 'semantic',
        category: 'semantic',
        question: '把请求侧和候选侧映射到同一表征空间的架构是什么？',
        relevantPostTitles: ['双塔模型']
      }
    ]
  };

  const report = buildPhase2Report(dataset, corpus);

  assert.equal(report.acceptance.semanticImproved, true);
  assert.equal(report.acceptance.exactNoRegression, true);
  assert.equal(report.acceptance.passed, true);
  assert.ok(
    report.comparison.semantic.hybrid.recallAt5 >
      report.comparison.semantic.baseline.recallAt5
  );
});
