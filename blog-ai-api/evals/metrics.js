'use strict';

function round(value, digits) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits === undefined ? 4 : digits));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function recallAtK(relevantRanks, relevantCount, k) {
  if (!relevantCount) return 0;
  const retrieved = relevantRanks.filter(rank => rank <= k).length;
  return retrieved / relevantCount;
}

function reciprocalRankAtK(relevantRanks, k) {
  const first = relevantRanks
    .filter(rank => rank <= k)
    .sort((left, right) => left - right)[0];
  return first ? 1 / first : 0;
}

function ndcgAtK(relevantRanks, relevantCount, k) {
  if (!relevantCount) return 0;

  const dcg = relevantRanks
    .filter(rank => rank <= k)
    .reduce((total, rank) => total + (1 / Math.log2(rank + 1)), 0);
  const idealCount = Math.min(relevantCount, k);
  let idealDcg = 0;

  for (let rank = 1; rank <= idealCount; rank += 1) {
    idealDcg += 1 / Math.log2(rank + 1);
  }

  return idealDcg ? dcg / idealDcg : 0;
}

function summarizePositiveCases(results) {
  if (!results.length) {
    return {
      cases: 0,
      recallAt5: 0,
      recallAt20: 0,
      hitRateAt5: 0,
      mrrAt20: 0,
      ndcgAt20: 0
    };
  }

  return {
    cases: results.length,
    recallAt5: round(mean(results.map(result => result.metrics.recallAt5))),
    recallAt20: round(mean(results.map(result => result.metrics.recallAt20))),
    hitRateAt5: round(mean(results.map(result => result.metrics.hitAt5))),
    mrrAt20: round(mean(results.map(result => result.metrics.reciprocalRankAt20))),
    ndcgAt20: round(mean(results.map(result => result.metrics.ndcgAt20)))
  };
}

function summarizeNegativeCases(results) {
  return {
    cases: results.length,
    rejectionAccuracy: results.length
      ? round(mean(results.map(result => result.rejected ? 1 : 0)))
      : 0
  };
}

module.exports = {
  ndcgAtK,
  recallAtK,
  reciprocalRankAtK,
  round,
  summarizeNegativeCases,
  summarizePositiveCases
};
