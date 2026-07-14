'use strict';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(value, maxLength) {
  const condensed = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (condensed.length <= maxLength) return condensed;
  return `${condensed.slice(0, maxLength).trim()}...`;
}

const searchIndexes = new WeakMap();
const questionNoiseTerms = new Set([
  '什么', '么是', '什么是', '是什', '介绍', '一下', '解释',
  '如何', '怎么', '为啥', '为什么', '请问', '告诉'
]);

function tokenize(value) {
  const normalized = normalizeText(value);
  const terms = normalized.match(/[a-z0-9][a-z0-9_.+#-]*/g) || [];
  const hanSequences = normalized.match(/[\u4e00-\u9fff]+/g) || [];

  for (const sequence of hanSequences) {
    if (sequence.length === 1) {
      terms.push(sequence);
      continue;
    }

    for (let index = 0; index < sequence.length - 1; index += 1) {
      terms.push(sequence.slice(index, index + 2));
    }
  }

  return terms;
}

function countTerms(value) {
  const frequency = new Map();

  for (const term of tokenize(value)) {
    frequency.set(term, (frequency.get(term) || 0) + 1);
  }

  return frequency;
}

function buildSearchIndex(chunks) {
  const documents = [];
  const documentFrequency = new Map();
  let totalLength = 0;

  for (const [position, chunk] of (chunks || []).entries()) {
    const termFrequency = countTerms(chunk.content);
    const length = Math.max(
      Array.from(termFrequency.values()).reduce((total, count) => total + count, 0),
      1
    );
    totalLength += length;

    for (const term of termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }

    documents.push({ chunk, position, termFrequency, length });
  }

  return {
    documents,
    documentFrequency,
    averageLength: documents.length ? totalLength / documents.length : 1
  };
}

function getSearchIndex(chunks) {
  if (!chunks || typeof chunks !== 'object') {
    return buildSearchIndex([]);
  }

  if (!searchIndexes.has(chunks)) {
    searchIndexes.set(chunks, buildSearchIndex(chunks));
  }

  return searchIndexes.get(chunks);
}

function detectMode(question) {
  const text = String(question || '');
  if (/总结|概括|摘要/.test(text)) return 'page_summary';
  if (/这篇|本文|本页|当前页|这一页/.test(text)) return 'page';
  return 'site';
}

function isDefinitionQuestion(question) {
  return /什么是|是什么|定义|指什么|指的是/.test(String(question || ''));
}

function scoreChunk(document, searchIndex, question, mode, page) {
  const { chunk, termFrequency, length } = document;
  const title = normalizeText(chunk.postTitle);
  const metadata = normalizeText([
    (chunk.tags || []).join(' '),
    (chunk.categories || []).join(' '),
    chunk.sectionTitle
  ].join(' '));
  const content = normalizeText(chunk.content);
  const normalizedQuestion = normalizeText(question);
  const terms = [...new Set(tokenize(question))]
    .filter(term => !questionNoiseTerms.has(term));
  let score = 0;

  if (normalizedQuestion && content.includes(normalizedQuestion)) {
    score += 8;
  }
  if (normalizedQuestion && title.includes(normalizedQuestion)) {
    score += 12;
  }

  if (isDefinitionQuestion(question)) {
    if (/定义|简介|概述/.test(chunk.sectionTitle || '')) {
      score += 5;
    }
    if (/是一种|指的是|称为/.test(content)) {
      score += 6;
    }
  }

  for (const term of terms) {
    const frequency = termFrequency.get(term) || 0;
    if (frequency) {
      const documentsWithTerm = searchIndex.documentFrequency.get(term) || 0;
      const inverseDocumentFrequency = Math.log(
        1 + (searchIndex.documents.length - documentsWithTerm + 0.5) /
          (documentsWithTerm + 0.5)
      );
      const k1 = 1.2;
      const b = 0.75;
      const normalization = k1 * (1 - b + b * (length / searchIndex.averageLength));
      score += inverseDocumentFrequency * (
        (frequency * (k1 + 1)) / (frequency + normalization)
      );
    }
    if (title.includes(term)) {
      score += 4;
    }
    if (metadata.includes(term)) {
      score += 2;
    }
  }

  if (page && page.url && chunk.postUrl === page.url) {
    score += mode === 'page_summary' ? 20 : 8;
  }

  return score;
}

function rankChunks(chunks, question, mode, page) {
  const searchIndex = getSearchIndex(chunks);
  const ranked = [];

  for (const document of searchIndex.documents) {
    const { chunk } = document;
    const score = scoreChunk(document, searchIndex, question, mode, page);

    if (mode === 'page_summary' && page && page.url) {
      if (chunk.postUrl === page.url) {
        ranked.push({ chunk, score, position: document.position });
      }
      continue;
    }

    if (score > 0) {
      ranked.push({ chunk, score, position: document.position });
    }
  }

  if (mode === 'page_summary' && page && page.url) {
    ranked.sort((left, right) => left.position - right.position);
  } else {
    ranked.sort((left, right) => right.score - left.score);
  }
  return ranked;
}

function uniqueCitations(ranked, limit) {
  const seen = new Set();
  const citations = [];

  for (const item of ranked) {
    const chunk = item.chunk;
    const key = `${chunk.postUrl}::${chunk.content.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      title: chunk.postTitle,
      url: chunk.postUrl,
      snippet: snippet(chunk.content, 140)
    });
    if (citations.length >= limit) break;
  }

  return citations;
}

function uniqueRelated(ranked, page, limit) {
  const seen = new Set();
  const related = [];

  for (const item of ranked) {
    const chunk = item.chunk;
    if (!chunk.postUrl || seen.has(chunk.postUrl) || (page && chunk.postUrl === page.url)) {
      continue;
    }

    seen.add(chunk.postUrl);
    related.push({
      title: chunk.postTitle,
      url: chunk.postUrl
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
