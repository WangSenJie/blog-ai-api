'use strict';

const {
  buildResponse
} = require('../../lib/retrieve');
const {
  isIndexableChunk,
  normalizePostUrl,
  normalizeText,
  snippet
} = require('../../lib/retrieval-core');
const {
  ROUTES
} = require('./route');

function citationFromCandidate(candidate) {
  const chunk = candidate && candidate.chunk;
  if (!isIndexableChunk(chunk)) return null;

  return {
    chunkId: chunk.id,
    title: chunk.postTitle,
    url: normalizePostUrl(chunk.postUrl),
    section: chunk.sectionTitle || '',
    snippet: snippet(chunk.content, 160)
  };
}

function citationsFromCandidates(candidates, limit) {
  const citations = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const citation = citationFromCandidate(candidate);
    if (!citation || seen.has(citation.chunkId)) continue;
    seen.add(citation.chunkId);
    citations.push(citation);
    if (citations.length >= limit) break;
  }
  return citations;
}

function relatedFromCandidates(candidates, page, limit) {
  const related = [];
  const seen = new Set();
  const pageUrl = normalizePostUrl(page && page.url);

  for (const candidate of candidates) {
    const chunk = candidate.chunk;
    const url = normalizePostUrl(chunk && chunk.postUrl);
    if (!url || url === pageUrl || seen.has(url)) continue;
    seen.add(url);
    related.push({ title: chunk.postTitle, url });
    if (related.length >= limit) break;
  }
  return related;
}

function buildCompareAnswer(state) {
  const byUrl = new Map();

  for (const candidate of state.selectedChunks) {
    const url = normalizePostUrl(candidate.chunk.postUrl);
    if (!byUrl.has(url)) byUrl.set(url, candidate);
  }

  const articles = [...byUrl.values()].slice(
    0,
    state.targetQueries.length >= 2 ? 2 : 3
  );
  const articleUrls = new Set(
    articles.map(candidate => normalizePostUrl(candidate.chunk.postUrl))
  );
  const comparisonCandidates = state.selectedChunks.filter(candidate => (
    articleUrls.has(normalizePostUrl(candidate.chunk.postUrl))
  ));
  const lines = articles.map(candidate => (
    `- 《${candidate.chunk.postTitle}》：${snippet(candidate.chunk.content, 220)}`
  ));

  return {
    answer: `我先按站内证据把这几篇内容并列整理一下：\n${lines.join('\n')}`,
    citations: citationsFromCandidates(comparisonCandidates, 5),
    related: articles.map(candidate => ({
      title: candidate.chunk.postTitle,
      url: normalizePostUrl(candidate.chunk.postUrl)
    }))
  };
}

function buildRelatedAnswer(state) {
  const related = relatedFromCandidates(
    state.selectedChunks,
    state.page,
    5
  );
  const titles = related.map(item => `《${item.title}》`).join('、');

  return {
    answer: titles
      ? `可以继续看看这些站内文章：${titles}。`
      : '站内暂时没有找到足够贴近的延伸阅读。',
    citations: citationsFromCandidates(state.selectedChunks, 5),
    related
  };
}

function buildCompoundAnswer(state) {
  const lines = [];

  for (const query of state.subqueries) {
    const normalizedQuery = normalizeText(query);
    const candidate = state.selectedChunks.find(item => (
      item.matchedQueries.some(matchedQuery => (
        normalizeText(matchedQuery) === normalizedQuery ||
        normalizeText(matchedQuery).startsWith(`${normalizedQuery} `)
      ))
    ));
    if (!candidate) continue;
    lines.push(
      `- ${query}：《${candidate.chunk.postTitle}》中提到：` +
      snippet(candidate.chunk.content, 220)
    );
  }

  return {
    answer: `我按子问题分别整理如下：\n${lines.join('\n')}`,
    citations: citationsFromCandidates(state.selectedChunks, 5),
    related: relatedFromCandidates(state.selectedChunks, state.page, 3)
  };
}

function buildDeterministicResponse(state) {
  if (state.route === ROUTES.DIRECT) {
    return {
      answer: '你好呀！我可以检索这个博客、总结当前文章、推荐相关文章，也能结合最近几轮对话继续追问。',
      citations: [],
      related: []
    };
  }

  if (state.needsClarification) {
    return {
      answer: '我还不能确定你指的是哪篇文章。请补充文章标题，或先从上一轮结果中明确选择第几篇。',
      citations: [],
      related: []
    };
  }

  if (state.evidenceStatus !== 'sufficient') {
    return {
      answer: '站内暂时没有足够信息可靠回答这个问题。你可以补充文章标题、当前页面或更具体的关键词。',
      citations: [],
      related: []
    };
  }

  if (state.route === ROUTES.ARTICLE_COMPARE) return buildCompareAnswer(state);
  if (state.route === ROUTES.RELATED_ARTICLES) return buildRelatedAnswer(state);
  if (state.subqueries.length > 1) return buildCompoundAnswer(state);

  const ranked = state.selectedChunks.map(candidate => ({
    chunk: candidate.chunk,
    score: candidate.score
  }));
  const legacyMode = state.route === ROUTES.PAGE_SUMMARY
    ? 'page_summary'
    : state.route === ROUTES.PAGE_QA
      ? 'page'
      : 'site';
  const response = buildResponse(
    state.standaloneQuery,
    ranked,
    state.page,
    legacyMode
  );
  response.citations = citationsFromCandidates(state.selectedChunks, 5);
  response.related = relatedFromCandidates(state.selectedChunks, state.page, 3);
  return response;
}

module.exports = {
  buildCompareAnswer,
  buildCompoundAnswer,
  buildDeterministicResponse,
  citationFromCandidate,
  citationsFromCandidates,
  relatedFromCandidates
};
