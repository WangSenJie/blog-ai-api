'use strict';

const {
  getQuestionTerms,
  isIndexableChunk,
  normalizePostUrl,
  normalizeText,
  rankChunks
} = require('./retrieval-core');
const {
  cosineSimilarity,
  embedText,
  isFiniteVector
} = require('./embedding');

const HYBRID_CONFIG = Object.freeze({
  bm25TopK: 20,
  vectorTopK: 20,
  rrfK: 60,
  rerankTopK: 20,
  minimumVectorScore: 0.17,
  maxChunksPerPost: 3
});

function vectorMapForChunks(chunks, vectors) {
  const chunksById = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
  const vectorMap = new Map();

  for (const vector of vectors || []) {
    const chunk = chunksById.get(vector && vector.id);
    if (!chunk || vector.contentHash !== chunk.contentHash) continue;
    if (!isFiniteVector(vector.values, vector.values.length)) continue;
    vectorMap.set(chunk.id, vector.values);
  }
  return vectorMap;
}

function rankVectorChunks(chunks, vectors, question, mode, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const vectorMap = vectorMapForChunks(chunks, vectors);
  if (!vectorMap.size) return [];

  const queryEmbedding = embedText(question);
  const pageUrl = normalizePostUrl(page && page.url);
  const ranked = [];

  for (const [position, chunk] of (chunks || []).entries()) {
    if (!isIndexableChunk(chunk)) continue;
    if (mode === 'page_summary' && pageUrl && normalizePostUrl(chunk.postUrl) !== pageUrl) {
      continue;
    }
    const values = vectorMap.get(chunk.id);
    if (!values || values.length !== queryEmbedding.length) continue;
    const score = cosineSimilarity(queryEmbedding, values);
    if (score < settings.minimumVectorScore) continue;
    ranked.push({ chunk, score, position });
  }

  if (mode === 'page_summary' && pageUrl) {
    return ranked.sort((left, right) => left.position - right.position);
  }
  return ranked
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .slice(0, settings.vectorTopK);
}

function candidateText(chunk) {
  if (String(chunk && chunk.retrievalText || '').trim()) {
    return normalizeText(chunk.retrievalText);
  }
  return normalizeText([
    chunk && chunk.postTitle,
    chunk && (chunk.tags || []).join(' '),
    chunk && (chunk.categories || []).join(' '),
    chunk && (chunk.headingPath || []).join(' '),
    chunk && chunk.sectionTitle,
    chunk && chunk.content
  ].join(' '));
}

function lexicalCoverage(chunk, question) {
  const terms = getQuestionTerms(question);
  if (!terms.length) return 0;
  const text = candidateText(chunk);
  return terms.filter(term => text.includes(normalizeText(term))).length / terms.length;
}

function exactTitleMatch(chunk, question) {
  const title = normalizeText(chunk && chunk.postTitle);
  const normalizedQuestion = normalizeText(question);
  if (!title || !normalizedQuestion) return false;
  return title === normalizedQuestion ||
    (normalizedQuestion.length >= 3 && title.includes(normalizedQuestion));
}

function mergeRrfCandidates(bm25, vector, question, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const byId = new Map();
  const add = (item, kind, rank) => {
    const id = item.chunk.id;
    if (!byId.has(id)) {
      byId.set(id, {
        chunk: item.chunk,
        position: item.position,
        bm25Rank: null,
        bm25Score: 0,
        vectorRank: null,
        vectorScore: 0,
        rrfScore: 0
      });
    }
    const candidate = byId.get(id);
    candidate.rrfScore += 1 / (settings.rrfK + rank);
    if (kind === 'bm25') {
      candidate.bm25Rank = rank;
      candidate.bm25Score = item.score;
    } else {
      candidate.vectorRank = rank;
      candidate.vectorScore = item.score;
    }
  };

  bm25.slice(0, settings.bm25TopK).forEach((item, index) => add(item, 'bm25', index + 1));
  vector.slice(0, settings.vectorTopK).forEach((item, index) => add(item, 'vector', index + 1));

  const pageUrl = normalizePostUrl(page && page.url);
  return [...byId.values()].map(candidate => {
    const coverage = lexicalCoverage(candidate.chunk, question);
    const semantic = Math.max(0, candidate.vectorScore);
    const titleBoost = exactTitleMatch(candidate.chunk, question) ? 0.025 : 0;
    const pageBoost = pageUrl && normalizePostUrl(candidate.chunk.postUrl) === pageUrl
      ? 0.007
      : 0;
    const rerankScore = candidate.rrfScore +
      coverage * 0.008 +
      semantic * 0.008 +
      titleBoost +
      pageBoost;
    return Object.assign(candidate, {
      lexicalCoverage: coverage,
      rerankScore: Number(rerankScore.toFixed(8))
    });
  });
}

function dedupeAndDiversify(candidates, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const pageUrl = normalizePostUrl(page && page.url);
  const sorted = candidates.slice().sort((left, right) => (
    right.rerankScore - left.rerankScore ||
    right.rrfScore - left.rrfScore ||
    Math.min(left.bm25Rank || Infinity, left.vectorRank || Infinity) -
      Math.min(right.bm25Rank || Infinity, right.vectorRank || Infinity) ||
    left.position - right.position
  ));
  const selected = [];
  const seenContent = new Set();
  const chunksPerPost = new Map();

  function add(candidate, force) {
    const contentKey = normalizeText(candidate.chunk.content);
    const postUrl = normalizePostUrl(candidate.chunk.postUrl);
    const count = chunksPerPost.get(postUrl) || 0;
    if (!force && (seenContent.has(contentKey) || count >= settings.maxChunksPerPost)) {
      return;
    }
    if (selected.some(item => item.chunk.id === candidate.chunk.id)) return;
    selected.push(candidate);
    seenContent.add(contentKey);
    chunksPerPost.set(postUrl, count + 1);
  }

  // Keep a retrieved current-page section available for page-aware questions;
  // this is deliberately an addition, not a filter that can erase site results.
  if (pageUrl) {
    const currentPageCandidate = sorted.find(candidate => (
      normalizePostUrl(candidate.chunk.postUrl) === pageUrl
    ));
    if (currentPageCandidate) add(currentPageCandidate, true);
  }

  for (const candidate of sorted) add(candidate, false);
  return selected.slice(0, settings.rerankTopK).map((candidate, index) => (
    Object.assign(candidate, { rank: index + 1, score: candidate.rerankScore })
  ));
}

function hybridRankChunks(chunks, vectors, question, mode, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const bm25 = rankChunks(chunks, question, mode, page);
  const vector = rankVectorChunks(chunks, vectors, question, mode, page, settings);

  if (!vector.length) {
    return {
      strategy: 'bm25',
      ranked: bm25.slice(0, settings.rerankTopK).map((item, index) => ({
        chunk: item.chunk,
        position: item.position,
        bm25Rank: index + 1,
        bm25Score: item.score,
        vectorRank: null,
        vectorScore: 0,
        rrfScore: 1 / (settings.rrfK + index + 1),
        lexicalCoverage: lexicalCoverage(item.chunk, question),
        rerankScore: item.score,
        score: item.score,
        rank: index + 1
      })),
      stats: {
        bm25Candidates: bm25.length,
        vectorCandidates: 0,
        fusedCandidates: bm25.length,
        rerankedCandidates: Math.min(bm25.length, settings.rerankTopK),
        fallback: 'vectors_unavailable_or_below_threshold'
      }
    };
  }

  const fused = mergeRrfCandidates(bm25, vector, question, page, settings);
  const ranked = dedupeAndDiversify(fused, page, settings);
  return {
    strategy: 'hybrid_rrf_rerank',
    ranked,
    stats: {
      bm25Candidates: bm25.length,
      vectorCandidates: vector.length,
      fusedCandidates: fused.length,
      rerankedCandidates: ranked.length,
      fallback: null
    }
  };
}

module.exports = {
  HYBRID_CONFIG,
  dedupeAndDiversify,
  hybridRankChunks,
  lexicalCoverage,
  rankVectorChunks,
  vectorMapForChunks
};
