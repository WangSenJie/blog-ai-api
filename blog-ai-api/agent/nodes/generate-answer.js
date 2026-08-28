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
const {
  candidateCoverage
} = require('./grade-evidence');

function compactSourceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sourceSentences(value) {
  return compactSourceText(value)
    .split(/[。！？\n]+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 6);
}

function quoteFromChunk(chunk, query, limit) {
  const maximum = Number.isFinite(limit) ? limit : 280;
  const content = compactSourceText(chunk && chunk.content);
  if (!content) return '';

  const normalizedQuery = normalizeText(query);
  const queryTerms = normalizedQuery
    ? normalizedQuery.split(/\s+/).filter(term => term.length >= 2)
    : [];
  const sentences = sourceSentences(content);
  const bestSentence = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: queryTerms.reduce((total, term) => (
        normalizeText(sentence).includes(term) ? total + 1 : total
      ), 0)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  const selected = bestSentence && bestSentence.sentence ||
    sentences[0] ||
    content;

  return selected.length <= maximum
    ? selected
    : selected.slice(0, maximum).trim();
}

function hasUsableQuote(candidate, query) {
  const chunk = candidate && candidate.chunk;
  return isIndexableChunk(chunk) && quoteFromChunk(chunk, query).length >= 6;
}

function claimFromCandidate(candidate, query, values) {
  const settings = Object.assign({ prefix: '' }, values);
  const chunk = candidate && candidate.chunk;
  if (!isIndexableChunk(chunk)) return null;
  const quote = quoteFromChunk(chunk, query);
  if (!quote) return null;

  return {
    text: `${settings.prefix || ''}${quote}`,
    citationIds: [chunk.id],
    quote
  };
}

function bestEvidenceCandidate(candidates, query, calibration, rankingQuery) {
  const normalizedQuery = normalizeText(rankingQuery || query);
  return (candidates || [])
    .filter(candidate => hasUsableQuote(candidate, query))
    .slice()
    .sort((left, right) => {
      const leftTitle = normalizeText(left.chunk.postTitle);
      const rightTitle = normalizeText(right.chunk.postTitle);
      const leftTitleMatch = leftTitle && normalizedQuery.includes(leftTitle)
        ? leftTitle.length
        : 0;
      const rightTitleMatch = rightTitle && normalizedQuery.includes(rightTitle)
        ? rightTitle.length
        : 0;
      return rightTitleMatch - leftTitleMatch ||
        candidateCoverage(right, query, calibration) -
          candidateCoverage(left, query, calibration) ||
        (right.score || 0) - (left.score || 0) ||
        (left.rank || Number.MAX_SAFE_INTEGER) -
          (right.rank || Number.MAX_SAFE_INTEGER);
    })[0] || null;
}

function claimsFromSummaryCandidates(candidates) {
  const claims = [];

  for (const candidate of candidates) {
    const chunk = candidate && candidate.chunk;
    if (!isIndexableChunk(chunk)) continue;
    for (const sentence of sourceSentences(chunk.content)) {
      claims.push({
        text: sentence,
        citationIds: [chunk.id],
        quote: sentence
      });
      if (claims.length >= 3) return claims;
    }
  }

  return claims;
}

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

function proseQuoteFromChunk(chunk, query, limit) {
  const maximum = Number.isFinite(limit) ? limit : 280;
  const lines = String(chunk && chunk.content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length >= 6 && /[\u4e00-\u9fff]/.test(line))
    .filter(line => !/^(?:from |import |def |class |return |if |else\b|for |while |#)/i.test(line));
  const normalizedQuery = normalizeText(query);
  const selected = lines
    .map((line, index) => ({
      line,
      index,
      score: normalizedQuery && normalizeText(line).includes(normalizedQuery) ? 1 : 0
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];
  const quote = selected && selected.line || '';
  return quote.length <= maximum ? quote : quote.slice(0, maximum).trim();
}

function codeContextClaim(candidate, query) {
  const chunk = candidate && candidate.chunk;
  if (!isIndexableChunk(chunk)) return null;
  const quote = proseQuoteFromChunk(chunk, query);
  if (!quote) return null;
  return {
    text: quote,
    citationIds: [chunk.id],
    quote
  };
}

function buildAlignedComparisonAnswer(state) {
  const result = state.specialistResults && state.specialistResults.comparison;
  if (!result || !result.comparison || !Array.isArray(result.comparison.rows)) {
    return null;
  }
  const candidatesById = new Map(
    state.selectedChunks.map(candidate => [candidate.chunk.id, candidate])
  );
  const articlesByUrl = new Map((result.articles || []).map(article => [
    normalizePostUrl(article && article.url),
    article
  ]));
  const claims = [];
  const rows = result.comparison.rows.map(row => ({
    id: row.id,
    label: row.label,
    cells: (row.cells || []).map(cell => {
      const article = articlesByUrl.get(normalizePostUrl(cell.articleUrl));
      const candidate = cell.available && candidatesById.get(cell.chunkId);
      const claim = candidate
        ? claimFromCandidate(candidate, row.label, {
          prefix: `《${candidate.chunk.postTitle}》：`
        })
        : null;
      if (claim && claims.length < 6) claims.push(claim);
      return {
        articleUrl: normalizePostUrl(cell.articleUrl),
        articleTitle: article && article.title || '',
        available: Boolean(claim),
        citationId: claim && claim.citationIds[0] || '',
        text: claim && claim.text || '',
        quote: claim && claim.quote || ''
      };
    })
  }));
  const related = (result.articles || []).map(article => ({
    title: article.title,
    url: normalizePostUrl(article.url)
  })).filter(item => item.title && item.url);
  return {
    answer: '我按相同维度并列展示站内原文证据；没有原文证据的单元格不会补写推断。',
    citations: citationsFromCandidates(state.selectedChunks, 6),
    related,
    claims,
    comparison: {
      articles: related,
      rows
    }
  };
}

function buildLearningPathAnswer(state) {
  const result = state.specialistResults && state.specialistResults.learningPath;
  const path = result && result.learningPath;
  const steps = path && Array.isArray(path.steps) ? path.steps : [];
  const terminal = result && result.status === 'terminal';
  return {
    answer: terminal
      ? '这篇文章在已配置的站内学习图谱中已经没有下一步；你可以换一个主题继续规划。'
      : '已按作者维护的站内学习图谱整理阅读顺序。这个顺序是导航元数据，不由相关文章相似度推断。',
    citations: [],
    related: steps.map(step => ({ title: step.title, url: step.url })),
    claims: [],
    learningPath: path ? Object.assign({}, path, {
      steps: steps.map(step => Object.assign({}, step))
    }) : null,
    navigationOnly: true
  };
}

function buildCodeExplanationAnswer(state) {
  const result = state.specialistResults && state.specialistResults.codeExplanation;
  const explanation = result && result.codeExplanation;
  const block = explanation && explanation.block;
  const candidate = state.selectedChunks.find(item => (
    item && item.chunk && item.chunk.id === (explanation && explanation.contextChunkId)
  )) || state.selectedChunks[0];
  const claim = codeContextClaim(candidate, state.standaloneQuery);
  return {
    answer: '以下代码逐字来自站内文章；正文说明只展示同一文章中可追溯的原文，不执行代码，也不补充站外语义。',
    citations: citationsFromCandidates(candidate ? [candidate] : [], 1),
    related: [],
    claims: claim ? [claim] : [],
    codeExplanation: block ? {
      block: Object.assign({}, block),
      contextChunkId: explanation && explanation.contextChunkId || ''
    } : null
  };
}

function buildCompareAnswer(state) {
  const aligned = buildAlignedComparisonAnswer(state);
  if (aligned) return aligned;
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
  const claims = articles
    .map(candidate => claimFromCandidate(
      candidate,
      state.standaloneQuery,
      { prefix: `《${candidate.chunk.postTitle}》：` }
    ))
    .filter(Boolean);

  return {
    answer: `我先按站内证据把这几篇内容并列整理一下：\n${lines.join('\n')}`,
    citations: citationsFromCandidates(comparisonCandidates, 5),
    related: articles.map(candidate => ({
      title: candidate.chunk.postTitle,
      url: normalizePostUrl(candidate.chunk.postUrl)
    })),
    claims
  };
}

function buildRelatedAnswer(state) {
  const related = relatedFromCandidates(
    state.selectedChunks,
    state.page,
    5
  );
  const titles = related.map(item => `《${item.title}》`).join('、');
  const candidatesByUrl = new Map();
  for (const candidate of state.selectedChunks) {
    const url = normalizePostUrl(candidate && candidate.chunk && candidate.chunk.postUrl);
    if (url && !candidatesByUrl.has(url)) candidatesByUrl.set(url, candidate);
  }
  const claims = related
    .map(item => {
      const candidate = candidatesByUrl.get(normalizePostUrl(item.url));
      return candidate
        ? claimFromCandidate(candidate, state.standaloneQuery, {
          prefix: `《${candidate.chunk.postTitle}》：`
        })
        : null;
    })
    .filter(Boolean);

  return {
    answer: titles
      ? `可以继续看看这些站内文章：${titles}。`
      : '站内暂时没有找到足够贴近的延伸阅读。',
    citations: citationsFromCandidates(state.selectedChunks, 5),
    related,
    claims
  };
}

function buildCompoundAnswer(state) {
  const lines = [];
  const claims = [];

  for (const query of state.subqueries) {
    const normalizedQuery = normalizeText(query);
    const matchingCandidates = state.selectedChunks.filter(item => (
      item.matchedQueries.some(matchedQuery => (
        normalizeText(matchedQuery) === normalizedQuery ||
        normalizeText(matchedQuery).startsWith(`${normalizedQuery} `)
      ))
    ));
    const candidate = bestEvidenceCandidate(
      matchingCandidates,
      query,
      state.evidenceCalibration
    );
    if (!candidate) continue;
    lines.push(
      `- ${query}：《${candidate.chunk.postTitle}》中提到：` +
      snippet(candidate.chunk.content, 220)
    );
    const claim = claimFromCandidate(candidate, query);
    if (claim) claims.push(claim);
  }

  return {
    answer: `我按子问题分别整理如下：\n${lines.join('\n')}`,
    citations: citationsFromCandidates(state.selectedChunks, 5),
    related: relatedFromCandidates(state.selectedChunks, state.page, 3),
    claims
  };
}

function buildSingleEvidenceClaims(state) {
  if (state.route === ROUTES.PAGE_SUMMARY) {
    return claimsFromSummaryCandidates(state.selectedChunks);
  }

  const primaryReference = state.resolvedArticleRefs[0] ||
    state.history.pageRef ||
    null;
  const primaryUrl = normalizePostUrl(primaryReference && primaryReference.url);
  const anchoredCandidates = primaryUrl
    ? state.selectedChunks.filter(item => (
      normalizePostUrl(item && item.chunk && item.chunk.postUrl) === primaryUrl
    ))
    : [];
  const assignedIds = new Set((state.evidenceAssignments || [])
    .map(item => String(item && item.chunkId || '').trim())
    .filter(Boolean));
  const assignedCandidates = state.selectedChunks.filter(item => (
    assignedIds.has(String(item && item.chunk && item.chunk.id || ''))
  ));
  const candidate = bestEvidenceCandidate(
    anchoredCandidates.length
      ? anchoredCandidates
      : assignedCandidates.length
        ? assignedCandidates
        : state.selectedChunks,
    state.evidenceQuery || state.standaloneQuery,
    state.evidenceCalibration,
    state.standaloneQuery
  );
  if (!candidate || !candidate.chunk) return [];
  const titlePrefix = `《${candidate.chunk.postTitle}》：`;
  const claim = claimFromCandidate(
    candidate,
    state.evidenceQuery || state.standaloneQuery,
    { prefix: titlePrefix }
  );
  return claim ? [claim] : [];
}

function buildDeterministicResponse(state) {
  if (state.route === ROUTES.DIRECT) {
    return {
      answer: '你好呀！我可以检索这个博客、总结当前文章、推荐相关文章，也能结合最近几轮对话继续追问。',
      citations: [],
      related: [],
      claims: []
    };
  }

  if (state.needsClarification) {
    return {
      answer: '我还不能确定你指的是哪个概念或哪篇文章。请补充主题或文章标题，或者明确选择上一轮的第几篇。',
      citations: [],
      related: [],
      claims: []
    };
  }

  if (state.evidenceStatus !== 'sufficient') {
    return {
      answer: '站内暂时没有足够信息可靠回答这个问题。你可以补充文章标题、当前页面或更具体的关键词。',
      citations: [],
      related: [],
      claims: []
    };
  }

  if (state.route === ROUTES.ARTICLE_COMPARE) return buildCompareAnswer(state);
  if (state.route === ROUTES.LEARNING_PATH) return buildLearningPathAnswer(state);
  if (state.route === ROUTES.CODE_EXPLANATION) return buildCodeExplanationAnswer(state);
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
  response.claims = buildSingleEvidenceClaims(state);
  return response;
}

module.exports = {
  buildAlignedComparisonAnswer,
  buildCompareAnswer,
  buildCompoundAnswer,
  buildCodeExplanationAnswer,
  buildDeterministicResponse,
  buildLearningPathAnswer,
  bestEvidenceCandidate,
  claimFromCandidate,
  claimsFromSummaryCandidates,
  citationFromCandidate,
  citationsFromCandidates,
  hasUsableQuote,
  quoteFromChunk,
  proseQuoteFromChunk,
  relatedFromCandidates
};
