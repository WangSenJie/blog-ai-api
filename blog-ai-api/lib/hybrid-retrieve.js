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
  isFiniteVector,
  providerForManifest,
  providerFromEnvironment,
  providerMetadata,
  queryInput
} = require('./embedding');

const HYBRID_CONFIG = Object.freeze({
  bm25TopK: 20,
  vectorTopK: 20,
  rrfK: 60,
  rerankTopK: 20,
  minimumVectorScore: 0.17,
  maxChunksPerPost: 3
});

function vectorMapForChunks(chunks, vectors, expectedFingerprint) {
  const chunksById = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
  const vectorMap = new Map();

  for (const vector of vectors || []) {
    const chunk = chunksById.get(vector && vector.id);
    if (!chunk || vector.contentHash !== chunk.contentHash) continue;
    if (expectedFingerprint && vector.fingerprint !== expectedFingerprint) continue;
    if (!isFiniteVector(vector.values, vector.values.length)) continue;
    vectorMap.set(chunk.id, vector.values);
  }
  return vectorMap;
}

function rankVectorChunksWithEmbedding(chunks, vectors, queryEmbedding, mode, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const vectorMap = vectorMapForChunks(chunks, vectors, settings.expectedFingerprint);
  if (!vectorMap.size) return [];
  if (!isFiniteVector(queryEmbedding, queryEmbedding && queryEmbedding.length)) return [];
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

function rankVectorChunks(chunks, vectors, question, mode, page, options) {
  return rankVectorChunksWithEmbedding(
    chunks,
    vectors,
    embedText(queryInput(question)),
    mode,
    page,
    options
  );
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

function passageCoverage(chunk, question) {
  const terms = getQuestionTerms(question);
  if (!terms.length) return 0;
  const text = normalizeText([
    chunk && chunk.sectionTitle,
    chunk && chunk.content
  ].join(' '));
  return terms.filter(term => text.includes(normalizeText(term))).length / terms.length;
}

function exactTitleMatch(chunk, question) {
  const title = normalizeText(chunk && chunk.postTitle);
  const normalizedQuestion = normalizeText(question);
  if (!title || !normalizedQuestion) return false;
  return title === normalizedQuestion ||
    (normalizedQuestion.length >= 3 && (
      title.includes(normalizedQuestion) || normalizedQuestion.includes(title)
    ));
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
    const contentCoverage = passageCoverage(candidate.chunk, question);
    const semantic = Math.max(0, candidate.vectorScore);
    const titleMatched = exactTitleMatch(candidate.chunk, question);
    const titleBoost = titleMatched ? 0.025 : 0;
    const pageBoost = pageUrl && normalizePostUrl(candidate.chunk.postUrl) === pageUrl
      ? 0.007
      : 0;
    const rerankScore = candidate.rrfScore +
      coverage * 0.008 +
      (titleMatched ? contentCoverage * 0.12 : 0) +
      semantic * 0.008 +
      titleBoost +
      pageBoost;
    return Object.assign(candidate, {
      lexicalCoverage: coverage,
      passageCoverage: contentCoverage,
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

function bm25Fallback(bm25, question, settings, reason, errorCode) {
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
      parentExpandedCandidates: 0,
      fallback: reason,
      fallbackCode: errorCode || null
    }
  };
}

function expandParentContext(chunks, ranked, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const byParent = new Map();
  for (const chunk of chunks || []) {
    const parentId = String(chunk && chunk.parentId || '').trim();
    if (!parentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(chunk);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => Number(left.childOrdinal) - Number(right.childOrdinal));
  }

  const primaryBoundary = Math.min(8, ranked.length);
  const primary = ranked.slice(0, primaryBoundary);
  const remainder = ranked.slice(primaryBoundary);
  const seen = new Set(ranked.map(item => item.chunk.id));
  const perPost = new Map(primary.map(item => normalizePostUrl(item.chunk.postUrl)).map(url => [url, 0]));
  for (const item of primary) {
    const url = normalizePostUrl(item.chunk.postUrl);
    perPost.set(url, (perPost.get(url) || 0) + 1);
  }
  const expanded = [];
  for (const seed of primary.slice(0, 4)) {
    const siblings = byParent.get(String(seed.chunk.parentId || '')) || [];
    const index = siblings.findIndex(chunk => chunk.id === seed.chunk.id);
    for (const neighborIndex of [index - 1, index + 1]) {
      const chunk = siblings[neighborIndex];
      if (!chunk || seen.has(chunk.id) || !isIndexableChunk(chunk)) continue;
      const url = normalizePostUrl(chunk.postUrl);
      if ((perPost.get(url) || 0) >= settings.maxChunksPerPost) continue;
      seen.add(chunk.id);
      perPost.set(url, (perPost.get(url) || 0) + 1);
      expanded.push(Object.assign({}, seed, {
        chunk,
        position: Number(chunk.chunkIndex) || seed.position,
        bm25Rank: null,
        bm25Score: 0,
        vectorRank: null,
        vectorScore: 0,
        contextExpansion: 'adjacent_child',
        expandedFrom: seed.chunk.id,
        score: Math.max(0, Number(seed.score) - 0.000001)
      }));
    }
  }
  return primary.concat(expanded, remainder)
    .slice(0, settings.rerankTopK)
    .map((item, index) => Object.assign({}, item, { rank: index + 1 }));
}

function hybridRankChunks(chunks, vectors, question, mode, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const bm25 = rankChunks(chunks, question, mode, page);
  const vector = rankVectorChunks(chunks, vectors, question, mode, page, settings);

  if (!vector.length) {
    return bm25Fallback(bm25, question, settings, 'vectors_unavailable_or_below_threshold');
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

async function hybridRankChunksAsync(chunks, vectors, question, mode, page, options) {
  const settings = Object.assign({}, HYBRID_CONFIG, options || {});
  const bm25 = rankChunks(chunks, question, mode, page);
  if (
    settings.retrievalMode === 'bm25' ||
    String(process.env.RAG_RETRIEVAL_MODE || '').toLowerCase() === 'bm25'
  ) {
    return bm25Fallback(bm25, question, settings, 'bm25_feature_flag');
  }

  try {
    const manifest = settings.manifest || null;
    const provider = settings.provider || (manifest
      ? providerForManifest(manifest, settings.providerOptions)
      : providerFromEnvironment(Object.assign({ provider: 'local' }, settings.providerOptions)));
    const metadata = providerMetadata(provider);
    const expectedFingerprint = manifest && manifest.embedding
      ? String(manifest.embedding.fingerprint || '')
      : '';
    if (expectedFingerprint && metadata.fingerprint !== expectedFingerprint) {
      return bm25Fallback(bm25, question, settings, 'embedding_fingerprint_mismatch', 'EMBEDDING_FINGERPRINT_MISMATCH');
    }
    const vectorMap = vectorMapForChunks(chunks, vectors, expectedFingerprint);
    const expectedVectorCount = (chunks || []).filter(isIndexableChunk).length;
    if (!vectorMap.size || vectorMap.size !== expectedVectorCount) {
      return bm25Fallback(bm25, question, settings, 'vector_index_incomplete', 'EMBEDDING_INDEX_INCOMPLETE');
    }
    const queryEmbedding = await provider.embedQuery(queryInput(question), { signal: settings.signal });
    if (!isFiniteVector(queryEmbedding, metadata.dimensions) || !queryEmbedding.some(value => value !== 0)) {
      return bm25Fallback(bm25, question, settings, 'empty_query_vector', 'EMBEDDING_EMPTY_VECTOR');
    }
    const vector = rankVectorChunksWithEmbedding(
      chunks,
      vectors,
      queryEmbedding,
      mode,
      page,
      Object.assign({}, settings, { expectedFingerprint })
    );
    if (!vector.length) {
      return bm25Fallback(bm25, question, settings, 'vectors_below_threshold');
    }
    const fused = mergeRrfCandidates(bm25, vector, question, page, settings);
    const primary = dedupeAndDiversify(fused, page, settings);
    const ranked = expandParentContext(chunks, primary, settings);
    return {
      strategy: 'hybrid_rrf_rerank',
      ranked,
      stats: {
        bm25Candidates: bm25.length,
        vectorCandidates: vector.length,
        fusedCandidates: fused.length,
        rerankedCandidates: ranked.length,
        parentExpandedCandidates: ranked.filter(item => item.contextExpansion).length,
        embeddingProvider: metadata.provider,
        embeddingFingerprint: metadata.fingerprint,
        fallback: null,
        fallbackCode: null
      }
    };
  } catch (error) {
    const code = String(error && error.code || 'EMBEDDING_QUERY_FAILED');
    const reason = code === 'EMBEDDING_TIMEOUT'
      ? 'embedding_timeout'
      : code === 'EMBEDDING_RATE_LIMITED'
        ? 'embedding_rate_limited'
        : code === 'EMBEDDING_FINGERPRINT_MISMATCH'
          ? 'embedding_fingerprint_mismatch'
          : 'embedding_error';
    return bm25Fallback(bm25, question, settings, reason, code);
  }
}

module.exports = {
  HYBRID_CONFIG,
  dedupeAndDiversify,
  expandParentContext,
  hybridRankChunks,
  hybridRankChunksAsync,
  lexicalCoverage,
  passageCoverage,
  rankVectorChunks,
  rankVectorChunksWithEmbedding,
  vectorMapForChunks
};
