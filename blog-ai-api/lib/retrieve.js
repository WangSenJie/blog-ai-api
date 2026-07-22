'use strict';

const {
  detectMode,
  getQuestionTerms,
  isDefinitionQuestion,
  isIndexableChunk,
  normalizePostUrl,
  normalizeText,
  rankChunks,
  snippet
} = require('./retrieval-core');

function uniqueCitations(ranked, limit) {
  const seen = new Set();
  const citations = [];

  for (const item of ranked) {
    const chunk = item.chunk;
    if (!isIndexableChunk(chunk) || seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    citations.push({
      chunkId: chunk.id,
      title: chunk.postTitle,
      url: normalizePostUrl(chunk.postUrl),
      section: chunk.sectionTitle || '',
      snippet: snippet(chunk.content, 140)
    });
    if (citations.length >= limit) break;
  }

  return citations;
}

function uniqueRelated(ranked, page, limit) {
  const seen = new Set();
  const related = [];
  const pageUrl = normalizePostUrl(page && page.url);

  for (const item of ranked) {
    const chunk = item.chunk;
    const postUrl = normalizePostUrl(chunk && chunk.postUrl);
    if (!isIndexableChunk(chunk) || seen.has(postUrl) || postUrl === pageUrl) {
      continue;
    }

    seen.add(postUrl);
    related.push({
      title: chunk.postTitle,
      url: postUrl
    });

    if (related.length >= limit) break;
  }

  return related;
}

function buildSummaryAnswer(ranked) {
  const sentences = [];

  for (const item of ranked) {
    const parts = String(item.chunk.content || '')
      .split(/[。！？\n]+/)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      if (part.length < 8) continue;
      sentences.push(part);
      if (sentences.length >= 3) break;
    }

    if (sentences.length >= 3) break;
  }

  if (!sentences.length) {
    return '唔，这页内容有点绕，不过我已经帮你找到原文线索啦，可以先看下面的引用。';
  }

  return `嘿嘿，我先给你划个重点：\n- ${sentences.join('\n- ')}`;
}

function definitionSnippet(chunk, question) {
  const terms = getQuestionTerms(question);
  const sentences = String(chunk.content || '')
    .split(/[。！？\n]+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 8);
  const includesQuestionTerm = sentence => {
    const normalizedSentence = normalizeText(sentence);
    return terms.some(term => normalizedSentence.includes(term));
  };
  const definition = sentences.find(sentence => (
    includesQuestionTerm(sentence) && /是一种|指的是|称为/.test(sentence)
  )) || sentences.find(includesQuestionTerm) || sentences[0] || chunk.content;

  return snippet(definition, 280);
}

function buildSearchAnswer(question, ranked) {
  const top = ranked[0] && ranked[0].chunk;
  const relatedCount = Math.min(ranked.length, 3);

  if (!top) {
    return '欸？这次我还没翻到特别贴近的内容呢。你可以换个关键词试试，或者直接把文章标题、标签、主题词丢给我呀。';
  }

  const lead = snippet(top.content, 180);
  if (/推荐|下一篇|延伸/.test(question)) {
    return `让我看看哦...我帮你翻到几篇更贴近的文章啦。排在最前面的是《${top.postTitle}》，内容重点大致是：${lead}`;
  }

  if (isDefinitionQuestion(question)) {
    return `《${top.postTitle}》中介绍：${definitionSnippet(top, question)}`;
  }

  return `锵锵，我在站内翻到了 ${relatedCount} 篇比较相关的内容。最贴近的是《${top.postTitle}》，先给你一个小结：${lead}`;
}

function buildResponse(question, ranked, page, mode) {
  if (!ranked.length) {
    return {
      answer: '欸？这次我还没翻到特别贴近的内容呢。你可以换个关键词试试，或者直接把文章标题、标签、主题词丢给我呀。',
      citations: [],
      related: []
    };
  }

  return {
    answer: mode === 'page_summary'
      ? buildSummaryAnswer(ranked)
      : buildSearchAnswer(question, ranked),
    citations: uniqueCitations(ranked, 3),
    related: uniqueRelated(ranked, page, 3)
  };
}

module.exports = {
  buildResponse,
  detectMode,
  rankChunks
};
