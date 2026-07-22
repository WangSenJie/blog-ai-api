'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildReport, validateDataset } = require('../evals/run');

function makeCorpus() {
  return {
    posts: [
      { title: '双塔模型', url: '/double-tower/' },
      { title: '其他文章', url: '/other/' }
    ],
    chunks: [
      {
        id: 'tower#0',
        postTitle: '双塔模型',
        postUrl: '/double-tower/',
        tags: ['召回'],
        categories: ['推荐算法'],
        sectionTitle: '模型结构',
        content: '双塔模型包含用户塔和物品塔。'
      },
      {
        id: 'other#0',
        postTitle: '其他文章',
        postUrl: '/other/',
        tags: [],
        categories: [],
        sectionTitle: '',
        content: '这里讨论别的主题。'
      }
    ]
  };
}

test('buildReport evaluates positive retrieval and no-answer behavior', () => {
  const dataset = {
    version: 1,
    cases: [
      {
        id: 'positive',
        category: 'exact',
        question: '双塔模型',
        relevantPostTitles: ['双塔模型']
      },
      {
        id: 'negative',
        category: 'no_answer',
        question: 'kubernetes',
        shouldReject: true
      }
    ]
  };

  const report = buildReport(dataset, makeCorpus());

  assert.equal(report.summary.recallAt5, 1);
  assert.equal(report.summary.mrrAt20, 1);
  assert.equal(report.summary.noAnswerAccuracy, 1);
  assert.equal(report.failedCases.length, 0);
});

test('validateDataset rejects labels that are absent from the corpus', () => {
  const postsByTitle = new Map([['双塔模型', { title: '双塔模型' }]]);
  const dataset = {
    cases: [{
      id: 'bad-label',
      category: 'exact',
      question: '不存在',
      relevantPostTitles: ['不存在的文章']
    }]
  };

  assert.throws(
    () => validateDataset(dataset, postsByTitle),
    /Unknown relevant title/
  );
});
