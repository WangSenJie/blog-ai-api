'use strict';

(function exposeRetrievalCore(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  root.BlogAIRetrieval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRetrievalCore() {
  const BM25_CONFIG = Object.freeze({
    k1: 1.2,
    b: 0.75
  });
  const BLOG_ORIGIN = 'https://wangsenjie.github.io';
  const searchIndexes = new WeakMap();
  const questionNoiseTerms = new Set([
    '什么', '么是', '什么是', '是什', '介绍', '一下', '解释',
    '如何', '怎么', '为啥', '为什么', '请问', '告诉'
  ]);

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isAllowedPostUrl(value) {
    const raw = String(value || '').trim();
    const hasAllowedForm = raw.startsWith('/') || /^https:\/\//i.test(raw);
    if (!raw || !hasAllowedForm || raw.startsWith('//') || raw.includes('\\')) return false;

    try {
      const url = new URL(raw, BLOG_ORIGIN);
      return url.protocol === 'https:' &&
        url.origin === BLOG_ORIGIN &&
        !url.username &&
        !url.password;
    } catch (error) {
      return false;
    }
  }

  function normalizePostUrl(value) {
    const raw = String(value || '').trim();
    if (!isAllowedPostUrl(raw)) return '';

    const url = new URL(raw, BLOG_ORIGIN);
    const pathname = url.pathname === '/'
      ? '/'
      : `${url.pathname.replace(/\/+$/, '')}/`;
    return `${BLOG_ORIGIN}${pathname}`;
  }

  function snippet(value, maxLength) {
    const condensed = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (condensed.length <= maxLength) return condensed;
    return `${condensed.slice(0, maxLength).trim()}...`;
  }

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

  function getQuestionTerms(question) {
    return [...new Set(tokenize(question))]
      .filter(term => !questionNoiseTerms.has(term));
  }

  function isDefinitionQuestion(question) {
    return /什么是|是什么|定义|指什么|指的是/.test(String(question || ''));
  }

  function isIndexableChunk(chunk) {
    return Boolean(
      chunk &&
      String(chunk.id || '').trim() &&
      String(chunk.postTitle || '').trim() &&
      normalizePostUrl(chunk.postUrl) &&
      String(chunk.content || '').trim()
    );
  }

  function filterIndexableChunks(chunks) {
    return (chunks || []).filter(isIndexableChunk);
  }

  function buildSearchIndex(chunks) {
    const documents = [];
    const documentFrequency = new Map();
    let totalLength = 0;

    for (const [position, chunk] of (chunks || []).entries()) {
      if (!isIndexableChunk(chunk)) continue;

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
    const terms = getQuestionTerms(question);
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
        const normalization = BM25_CONFIG.k1 * (
          1 - BM25_CONFIG.b + BM25_CONFIG.b * (length / searchIndex.averageLength)
        );
        score += inverseDocumentFrequency * (
          (frequency * (BM25_CONFIG.k1 + 1)) / (frequency + normalization)
        );
      }
      if (title.includes(term)) {
        score += 4;
      }
      if (metadata.includes(term)) {
        score += 2;
      }
    }

    const pageUrl = normalizePostUrl(page && page.url);
    if (pageUrl && normalizePostUrl(chunk.postUrl) === pageUrl) {
      score += mode === 'page_summary' ? 20 : 8;
    }

    return score;
  }

  function rankChunks(chunks, question, mode, page) {
    const searchIndex = getSearchIndex(chunks);
    const ranked = [];
    const pageUrl = normalizePostUrl(page && page.url);

    for (const document of searchIndex.documents) {
      const { chunk } = document;
      const score = scoreChunk(document, searchIndex, question, mode, page);

      if (mode === 'page_summary' && pageUrl) {
        if (normalizePostUrl(chunk.postUrl) === pageUrl) {
          ranked.push({ chunk, score, position: document.position });
        }
        continue;
      }

      if (score > 0) {
        ranked.push({ chunk, score, position: document.position });
      }
    }

    if (mode === 'page_summary' && pageUrl) {
      ranked.sort((left, right) => left.position - right.position);
    } else {
      ranked.sort((left, right) => (
        right.score - left.score || left.position - right.position
      ));
    }
    return ranked;
  }

  return {
    BLOG_ORIGIN,
    BM25_CONFIG,
    buildSearchIndex,
    detectMode,
    filterIndexableChunks,
    getQuestionTerms,
    isAllowedPostUrl,
    isDefinitionQuestion,
    isIndexableChunk,
    normalizePostUrl,
    normalizeText,
    rankChunks,
    snippet,
    tokenize
  };
});
