'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ndcgAtK,
  recallAtK,
  reciprocalRankAtK,
  summarizeNegativeCases,
  summarizePositiveCases
} = require('../evals/metrics');

test('retrieval metrics use one-based relevant ranks', () => {
  const ranks = [2, 8];

  assert.equal(recallAtK(ranks, 2, 5), 0.5);
  assert.equal(recallAtK(ranks, 2, 20), 1);
  assert.equal(reciprocalRankAtK(ranks, 20), 0.5);
  assert.ok(ndcgAtK(ranks, 2, 20) > 0);
  assert.ok(ndcgAtK(ranks, 2, 20) < 1);
});

test('metric summaries average positive and no-answer cases', () => {
  const positives = [
    {
      metrics: {
        recallAt5: 1,
        recallAt20: 1,
        hitAt5: 1,
        reciprocalRankAt20: 1,
        ndcgAt20: 1
      }
    },
    {
      metrics: {
        recallAt5: 0,
        recallAt20: 1,
        hitAt5: 0,
        reciprocalRankAt20: 0.1,
        ndcgAt20: 0.2
      }
    }
  ];

  assert.deepEqual(summarizePositiveCases(positives), {
    cases: 2,
    recallAt5: 0.5,
    recallAt20: 1,
    hitRateAt5: 0.5,
    mrrAt20: 0.55,
    ndcgAt20: 0.6
  });
  assert.deepEqual(summarizeNegativeCases([
    { rejected: true },
    { rejected: false }
  ]), {
    cases: 2,
    rejectionAccuracy: 0.5
  });
});
