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

function getTerms(question) {
  const asciiTerms = normalizeText(question).match(/[a-z0-9]+/g) || [];
  const hanChars = String(question || '').match(/[\u4e00-\u9fff]/g) || [];
  const terms = new Set(asciiTerms);

  for (let index = 0; index < hanChars.length - 1; index += 1) {
    terms.add(`${hanChars[index]}${hanChars[index + 1]}`);
  }

  if (hanChars.length === 1) {
    terms.add(hanChars[0]);
  }

  if (hanChars.length > 1) {
    terms.add(hanChars.join(''));
  }

  return Array.from(terms).filter(Boolean);
}

function detectMode(question) {
  const text = String(question || '');
  if (/总结|概括|摘要/.test(text)) return 'page_summary';
  if (/这篇|本文|本页|当前页|这一页/.test(text)) return 'page';
  return 'site';
}

function scoreChunk(chunk, question, mode, page) {
  const haystack = normalizeText([
    chunk.postTitle,
    (chunk.tags || []).join(' '),
    (chunk.categories || []).join(' '),
    chunk.content
  ].join(' '));

  const title = normalizeText(chunk.postTitle);
  const normalizedQuestion = normalizeText(question);
  const terms = getTerms(question);
  let score = 0;

  if (normalizedQuestion && haystack.includes(normalizedQuestion)) {
    score += 12;
  }

  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;
    if (haystack.includes(normalizedTerm)) {
      score += normalizedTerm.length > 1 ? 3 : 1;
    }
    if (title.includes(normalizedTerm)) {
      score += 3;
    }
  }

  if (page && page.url && chunk.postUrl === page.url) {
    score += mode === 'page_summary' ? 20 : 8;
  }

  return score;
}

function rankChunks(chunks, question, mode, page) {
  const ranked = [];

  for (const chunk of chunks || []) {
    const score = scoreChunk(chunk, question, mode, page);

    if (mode === 'page_summary' && page && page.url) {
      if (chunk.postUrl === page.url) {
        ranked.push({ chunk, score });
      }
      continue;
    }

    if (score > 0) {
      ranked.push({ chunk, score });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
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
