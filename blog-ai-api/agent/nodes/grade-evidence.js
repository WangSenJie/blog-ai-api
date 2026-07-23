'use strict';

const {
  getQuestionTerms,
  normalizePostUrl,
  normalizeText
} = require('../../lib/retrieval-core');
const {
  estimateTokens
} = require('../config');
const {
  ROUTES
} = require('./route');

function searchableCandidateText(candidate) {
  const chunk = candidate.chunk;
  return normalizeText([
    chunk.postTitle,
    chunk.sectionTitle,
    (chunk.tags || []).join(' '),
    (chunk.categories || []).join(' '),
    chunk.content
  ].join(' '));
}

function meaningfulTerms(query) {
  return getQuestionTerms(query)
    .filter(term => !/^(文章|相关|内容|博客|继续|展开)$/.test(term));
}

function candidateCoverage(candidate, query) {
  const terms = meaningfulTerms(query);
  if (!terms.length) return candidate ? 1 : 0;
  const text = searchableCandidateText(candidate);
  const covered = terms.filter(term => text.includes(normalizeText(term)));
  return covered.length / terms.length;
}

function bestCoverage(candidates, query) {
  return candidates.reduce(
    (best, candidate) => Math.max(best, candidateCoverage(candidate, query)),
    0
  );
}

function matchingQueryCandidates(candidates, query) {
  const normalizedQuery = normalizeText(query);
  return candidates.filter(candidate => candidate.matchedQueries.some(
    matchedQuery => (
      normalizeText(matchedQuery) === normalizedQuery ||
      normalizeText(matchedQuery).startsWith(`${normalizedQuery} `)
    )
  ));
}

function bestQueryCandidate(candidates, query) {
  return matchingQueryCandidates(candidates, query)
    .slice()
    .sort((left, right) => (
      candidateCoverage(right, query) - candidateCoverage(left, query) ||
      (right.score || 0) - (left.score || 0) ||
      (left.rank || Number.MAX_SAFE_INTEGER) -
        (right.rank || Number.MAX_SAFE_INTEGER)
    ))[0] || null;
}

function bestTargetCandidate(candidates, target) {
  const normalizedTarget = normalizeText(target);
  return candidates
    .filter(candidate => candidateCoverage(candidate, target) >= 0.45)
    .sort((left, right) => {
      const leftTitle = normalizeText(left.chunk.postTitle);
      const rightTitle = normalizeText(right.chunk.postTitle);
      const leftExact = leftTitle === normalizedTarget ? 1 : 0;
      const rightExact = rightTitle === normalizedTarget ? 1 : 0;
      const leftContains = leftTitle.includes(normalizedTarget) ? 1 : 0;
      const rightContains = rightTitle.includes(normalizedTarget) ? 1 : 0;
      return rightExact - leftExact ||
        rightContains - leftContains ||
        candidateCoverage(right, target) - candidateCoverage(left, target) ||
        right.score - left.score ||
        left.rank - right.rank;
    })[0] || null;
}

function gradeEvidence(state) {
  const candidates = state.retrievedChunks;
  const primaryReference = state.resolvedArticleRefs[0] ||
    state.history.pageRef ||
    state.history.articleRefs[0] ||
    null;
  const primaryUrl = normalizePostUrl(primaryReference && primaryReference.url);

  if (!candidates.length) {
    return { status: 'insufficient', reason: 'no_candidates' };
  }

  if (state.route === ROUTES.PAGE_SUMMARY) {
    const hasPage = candidates.some(candidate => (
      normalizePostUrl(candidate.chunk.postUrl) === primaryUrl
    ));
    return hasPage
      ? { status: 'sufficient', reason: 'current_article_loaded' }
      : { status: 'insufficient', reason: 'current_article_missing' };
  }

  if (state.route === ROUTES.PAGE_QA) {
    const pageCandidates = candidates.filter(candidate => (
      normalizePostUrl(candidate.chunk.postUrl) === primaryUrl
    ));
    const coverage = bestCoverage(pageCandidates, state.standaloneQuery);
    const genericArticleQuestion = (
      primaryReference &&
      normalizeText(state.standaloneQuery).includes(
        normalizeText(primaryReference.title)
      ) &&
      /有什么特点|有何特点|主要(?:内容|特点)|讲了?什么|介绍一下|核心观点|适合(?:谁|什么)|做什么/.test(
        state.standaloneQuery
      )
    );
    return pageCandidates.length && (
      coverage >= 0.35 ||
      genericArticleQuestion
    )
      ? { status: 'sufficient', reason: 'current_page_terms_covered' }
      : { status: 'insufficient', reason: 'current_page_terms_not_covered' };
  }

  if (state.route === ROUTES.RELATED_ARTICLES) {
    const urls = new Set(
      candidates
        .map(candidate => normalizePostUrl(candidate.chunk.postUrl))
        .filter(url => url && url !== primaryUrl)
    );
    return urls.size
      ? { status: 'sufficient', reason: 'related_articles_found' }
      : { status: 'insufficient', reason: 'related_articles_missing' };
  }

  if (state.route === ROUTES.ARTICLE_COMPARE) {
    const targets = state.targetQueries.length
      ? state.targetQueries.slice(0, 2)
      : state.subqueries.slice(0, 2);
    const targetCandidates = targets.map(target => bestTargetCandidate(
      candidates.filter(candidate => candidate.matchedQueries.some(query => (
        normalizeText(query) === normalizeText(target) ||
        normalizeText(query).startsWith(`${normalizeText(target)} `)
      ))),
      target
    ));
    const distinctUrls = new Set(
      targetCandidates
        .filter(Boolean)
        .map(candidate => normalizePostUrl(candidate.chunk.postUrl))
    );
    const allTargetsCovered = targets.length >= 2 &&
      targetCandidates.every(Boolean);

    return distinctUrls.size >= 2 && allTargetsCovered
      ? { status: 'sufficient', reason: 'comparison_targets_covered' }
      : { status: 'insufficient', reason: 'comparison_target_missing' };
  }

  if (state.subqueries.length > 1) {
    const allSubqueriesCovered = state.subqueries.every(query => (
      bestCoverage(matchingQueryCandidates(candidates, query), query) >= 0.23
    ));
    return allSubqueriesCovered
      ? { status: 'sufficient', reason: 'all_subqueries_covered' }
      : { status: 'insufficient', reason: 'subquery_evidence_missing' };
  }

  const coverage = bestCoverage(candidates.slice(0, 5), state.standaloneQuery);
  return coverage >= 0.23
    ? { status: 'sufficient', reason: 'query_terms_covered' }
    : { status: 'insufficient', reason: 'query_terms_not_covered' };
}

function selectContext(state) {
  const selected = [];
  const seen = new Set();
  let characters = 0;
  const limits = state.budget.limits;

  function add(candidate) {
    if (!candidate || seen.has(candidate.chunk.id)) return;
    const chunkCharacters = String(candidate.chunk.content || '').length;
    const nextCharacters = characters + chunkCharacters;
    const nextTokens = estimateTokens(nextCharacters);
    if (
      selected.length >= limits.maxContextChunks ||
      nextCharacters > limits.maxContextChars ||
      nextTokens > limits.maxContextTokens
    ) {
      return;
    }
    seen.add(candidate.chunk.id);
    selected.push(candidate);
    characters = nextCharacters;
  }

  if (state.route === ROUTES.ARTICLE_COMPARE) {
    for (const target of state.targetQueries.slice(0, 2)) {
      add(bestTargetCandidate(
        state.retrievedChunks.filter(candidate => (
          candidate.matchedQueries.some(query => (
            normalizeText(query) === normalizeText(target) ||
            normalizeText(query).startsWith(`${normalizeText(target)} `)
          ))
        )),
        target
      ));
    }
  } else if (state.subqueries.length > 1) {
    for (const query of state.subqueries) {
      add(bestQueryCandidate(state.retrievedChunks, query));
    }
  }

  for (const candidate of state.retrievedChunks) add(candidate);

  state.budget.used.contextChunks = selected.length;
  state.budget.used.contextChars = characters;
  state.budget.used.estimatedContextTokens = estimateTokens(characters);
  return selected;
}

module.exports = {
  bestCoverage,
  bestQueryCandidate,
  bestTargetCandidate,
  candidateCoverage,
  gradeEvidence,
  meaningfulTerms,
  matchingQueryCandidates,
  selectContext
};
