'use strict';

const {
  normalizePostUrl,
  normalizeText
} = require('../../lib/retrieval-core');
const {
  ROUTES
} = require('./route');

class AgentDeadlineError extends Error {
  constructor(message) {
    super(message || 'Agent deadline exceeded');
    this.name = 'AgentDeadlineError';
    this.code = 'AGENT_DEADLINE_EXCEEDED';
  }
}

function assertWithinDeadline(state) {
  if (Date.now() >= state.deadlineAtMs) {
    throw new AgentDeadlineError();
  }
}

function toolResultItems(result) {
  if (!result || typeof result !== 'object') return [];
  if (Array.isArray(result.items)) return result.items;
  if (Array.isArray(result.results)) return result.results;
  if (Array.isArray(result.chunks)) return result.chunks;
  return [];
}

function normalizeToolItem(item, query, toolName, fallbackRank) {
  const sourceChunk = item && item.chunk ? item.chunk : item;
  if (!sourceChunk) return null;

  const chunk = {
    id: String(sourceChunk.id || sourceChunk.chunkId || '').trim(),
    postId: String(sourceChunk.postId || '').trim(),
    postTitle: String(
      sourceChunk.postTitle || sourceChunk.title || ''
    ).trim(),
    postUrl: normalizePostUrl(sourceChunk.postUrl || sourceChunk.url),
    sectionTitle: String(
      sourceChunk.sectionTitle || sourceChunk.section || ''
    ).trim(),
    content: String(sourceChunk.content || '').trim(),
    tags: Array.isArray(sourceChunk.tags) ? sourceChunk.tags.slice() : [],
    categories: Array.isArray(sourceChunk.categories)
      ? sourceChunk.categories.slice()
      : []
  };
  if (!chunk.id || !chunk.postTitle || !chunk.postUrl || !chunk.content) {
    return null;
  }

  const rank = Math.max(
    1,
    Number(item.rank) || Number(fallbackRank) || 1
  );

  return {
    chunk,
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
    rank,
    sourcePosition: Number.isFinite(Number(item.position))
      ? Number(item.position)
      : rank - 1,
    ranking: {
      bm25Rank: Number.isFinite(Number(item.bm25Rank))
        ? Number(item.bm25Rank)
        : null,
      vectorRank: Number.isFinite(Number(item.vectorRank))
        ? Number(item.vectorRank)
        : null,
      vectorScore: Number.isFinite(Number(item.vectorScore))
        ? Number(item.vectorScore)
        : 0,
      rrfScore: Number.isFinite(Number(item.rrfScore))
        ? Number(item.rrfScore)
        : 0,
      rerankScore: Number.isFinite(Number(item.rerankScore))
        ? Number(item.rerankScore)
        : 0
    },
    matchedQueries: [String(item && item.query || query)],
    tools: [toolName]
  };
}

function captureSpecialistResult(state, name, result) {
  if (!state || !state.specialistResults || !result || typeof result !== 'object') {
    return;
  }
  if (name === 'compare_articles') {
    state.specialistResults.comparison = result;
  } else if (name === 'recommend_learning_path') {
    state.specialistResults.learningPath = result;
  } else if (name === 'explain_code_block') {
    state.specialistResults.codeExplanation = result;
  }
}

function mergeCandidates(existing, incoming) {
  const byChunkId = new Map();

  for (const candidate of existing.concat(incoming)) {
    const chunkId = candidate.chunk.id;
    if (!byChunkId.has(chunkId)) {
      byChunkId.set(chunkId, Object.assign({}, candidate, {
        matchedQueries: candidate.matchedQueries.slice(),
        tools: candidate.tools.slice(),
        ranking: Object.assign({}, candidate.ranking)
      }));
      continue;
    }

    const current = byChunkId.get(chunkId);
    current.score = Math.max(current.score, candidate.score);
    current.rank = Math.min(current.rank, candidate.rank);
    current.sourcePosition = Math.min(
      current.sourcePosition,
      candidate.sourcePosition
    );
    current.ranking = Object.assign({}, current.ranking, {
      bm25Rank: [current.ranking.bm25Rank, candidate.ranking.bm25Rank]
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0] || null,
      vectorRank: [current.ranking.vectorRank, candidate.ranking.vectorRank]
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0] || null,
      vectorScore: Math.max(current.ranking.vectorScore, candidate.ranking.vectorScore),
      rrfScore: Math.max(current.ranking.rrfScore, candidate.ranking.rrfScore),
      rerankScore: Math.max(current.ranking.rerankScore, candidate.ranking.rerankScore)
    });
    current.matchedQueries = [...new Set(
      current.matchedQueries.concat(candidate.matchedQueries)
    )];
    current.tools = [...new Set(current.tools.concat(candidate.tools))];
  }

  return [...byChunkId.values()].sort((left, right) => (
    right.matchedQueries.length - left.matchedQueries.length ||
    left.rank - right.rank ||
    right.score - left.score ||
    left.sourcePosition - right.sourcePosition
  ));
}

async function executeWithTimeout(tools, name, args, timeoutMs) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeoutId;

  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new AgentDeadlineError(`${name} timed out`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      Promise.resolve(tools.execute(name, args, { signal: controller.signal })),
      timeout
    ]);
    if (Date.now() - startedAt > timeoutMs) {
      controller.abort();
      throw new AgentDeadlineError(`${name} timed out`);
    }
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

function routeToolRequests(state, queries) {
  const currentReference = Array.isArray(state.currentQuestionRefs) &&
    state.currentQuestionRefs.length === 1
    ? state.currentQuestionRefs[0]
    : null;
  const primaryReference = state.resolvedArticleRefs[0] ||
    currentReference ||
    state.history.pageRef ||
    state.history.articleRefs[0] ||
    null;
  const pageUrl = primaryReference && primaryReference.url;
  const topK = Math.min(state.budget.limits.maxContextChunks * 2, 16);
  const phase5 = state.phase5Request || {};

  if (state.route === ROUTES.ARTICLE_COMPARE) {
    const comparison = phase5.comparison || {};
    return comparison.urls && comparison.urls.length >= 2
      ? [{
        name: 'compare_articles',
        args: {
          urls: comparison.urls,
          dimensions: comparison.dimensions,
          query: state.standaloneQuery,
          topK: Math.min(comparison.dimensions && comparison.dimensions.length || 1, 3)
        },
        query: state.standaloneQuery
      }]
      : [];
  }
  if (state.route === ROUTES.LEARNING_PATH) {
    const learning = phase5.learning || {};
    return learning.topic || learning.goal || learning.currentPostUrl
      ? [{
        name: 'recommend_learning_path',
        args: Object.assign({
          level: learning.level,
          completedUrls: learning.completedUrls,
          topK: Math.min(topK, 8)
        }, learning.topic ? { topic: learning.topic } : {},
        learning.goal ? { goal: learning.goal } : {},
        learning.currentPostUrl ? { currentPostUrl: learning.currentPostUrl } : {}),
        query: state.standaloneQuery
      }]
      : [];
  }
  if (state.route === ROUTES.CODE_EXPLANATION) {
    const code = phase5.code || {};
    return code.url
      ? [{
        name: 'explain_code_block',
        args: Object.assign(
          { url: code.url, query: code.query },
          code.blockId ? { blockId: code.blockId } : {},
          code.ordinal ? { ordinal: code.ordinal } : {}
        ),
        query: state.standaloneQuery
      }]
      : [];
  }

  if (state.route === ROUTES.PAGE_SUMMARY) {
    return pageUrl
      ? [{ name: 'get_article', args: { url: pageUrl, topK }, query: queries[0] }]
      : [];
  }
  if (state.route === ROUTES.PAGE_QA) {
    return pageUrl
      ? queries.map(query => ({
        name: 'search_blog',
        args: {
          query,
          currentPageOnly: true,
          pageUrl,
          topK
        },
        query
      }))
      : [];
  }
  if (state.route === ROUTES.RELATED_ARTICLES) {
    if (!pageUrl) {
      return queries.map(query => ({
        name: 'search_blog',
        args: { query, topK: Math.min(topK, 8) },
        query
      }));
    }
    return [{
      name: 'get_related_articles',
      args: Object.assign(
        { topic: state.standaloneQuery, topK: Math.min(topK, 8) },
        pageUrl ? { url: pageUrl } : {}
      ),
      query: queries[0]
    }];
  }

  const namedDefinitionQuestion = /什么是|是什么|何为|定义/.test(
    String(state.standaloneQuery || state.question || '')
  );
  if (
    state.route === ROUTES.SITE_QA &&
    currentReference &&
    pageUrl &&
    queries.length === 1 &&
    namedDefinitionQuestion
  ) {
    return [{
      name: 'get_article',
      args: { url: pageUrl, topK },
      query: queries[0]
    }];
  }

  return queries.map(query => ({
    name: 'search_blog',
    args: { query, topK },
    query
  }));
}

async function retrieveEvidence(state, tools, queries, attempt) {
  assertWithinDeadline(state);
  const requests = routeToolRequests(state, queries)
    .slice(0, Math.max(
      0,
      state.budget.limits.maxToolCalls - state.budget.used.toolCalls
    ));
  let roundCandidates = [];

  for (const request of requests) {
    assertWithinDeadline(state);
    if (state.budget.used.toolCalls >= state.budget.limits.maxToolCalls) break;

    const startedAt = Date.now();
    const summary = {
      name: request.name,
      attempt,
      query: request.query,
      status: 'ok',
      resultCount: 0,
      durationMs: 0
    };
    state.budget.used.toolCalls += 1;

    try {
      const remainingMs = Math.max(1, state.deadlineAtMs - Date.now());
      const result = await executeWithTimeout(
        tools,
        request.name,
        request.args,
        Math.min(
          state.budget.limits.retrievalRoundTimeoutMs,
          remainingMs
        )
      );
      const items = toolResultItems(result);
      captureSpecialistResult(state, request.name, result);
      summary.strategy = String(result && result.strategy || 'unknown');
      if (result && result.retrieval && typeof result.retrieval === 'object') {
        summary.retrieval = Object.assign({}, result.retrieval);
      }
      summary.resultCount = items.length;
      const normalized = items
        .map((item, index) => normalizeToolItem(
          item,
          request.query,
          request.name,
          index + 1
        ))
        .filter(Boolean);
      roundCandidates = mergeCandidates(roundCandidates, normalized);
    } catch (error) {
      summary.status = error && error.code === 'AGENT_DEADLINE_EXCEEDED'
        ? 'timeout'
        : 'error';
      summary.errorCode = error && error.code
        ? error.code
        : 'TOOL_EXECUTION_FAILED';
    } finally {
      summary.durationMs = Date.now() - startedAt;
      state.toolCalls.push(summary);
    }
  }

  return mergeCandidates(state.retrievedChunks, roundCandidates);
}

module.exports = {
  AgentDeadlineError,
  assertWithinDeadline,
  captureSpecialistResult,
  mergeCandidates,
  normalizeToolItem,
  retrieveEvidence,
  routeToolRequests
};
