'use strict';

const {
  normalizeText
} = require('../../lib/retrieval-core');
const {
  ROUTES,
  hasExplicitLearningTopic
} = require('./route');

const CHINESE_NUMBERS = Object.freeze({
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
});

function parseOrdinal(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return CHINESE_NUMBERS[value] || 0;
}

function replaceReferenceExpressions(question, references) {
  let unresolved = false;
  let rewritten = String(question || '');
  const selectedReferences = [];

  function select(reference) {
    if (
      reference &&
      !selectedReferences.some(item => item.url === reference.url)
    ) {
      selectedReferences.push(reference);
    }
    return reference;
  }

  rewritten = rewritten.replace(
    /第\s*([一二两三四五六七八九十\d]+)\s*篇/g,
    (match, number) => {
      const reference = references[parseOrdinal(number) - 1];
      if (!reference) {
        unresolved = true;
        return match;
      }
      select(reference);
      return `《${reference.title}》`;
    }
  );

  rewritten = rewritten.replace(/上一篇(?:文章)?/g, match => {
    if (!references[0]) {
      unresolved = true;
      return match;
    }
    select(references[0]);
    return `《${references[0].title}》`;
  });

  rewritten = rewritten.replace(/前者/g, () => {
    if (!references[0]) {
      unresolved = true;
      return '前者';
    }
    select(references[0]);
    return `《${references[0].title}》`;
  });
  rewritten = rewritten.replace(/后者/g, () => {
    if (!references[1]) {
      unresolved = true;
      return '后者';
    }
    select(references[1]);
    return `《${references[1].title}》`;
  });

  return { rewritten, unresolved, selectedReferences };
}

function hasExplicitRelatedTopic(question) {
  const remaining = String(question || '')
    .toLowerCase()
    .replace(
      /相关文章|相关推荐|延伸阅读|类似文章|下一篇|推荐|文章|几篇|一些|我|请|帮我|给我|应该|想要|想看|看看|阅读|读|看|什么|哪些|一下|有|吗/g,
      ''
    )
    .replace(
      /可以|能否|麻烦/g,
      ''
    )
    .replace(/[\s，。；：！？?、,.!]/g, '');
  return remaining.length >= 2;
}

function rewriteStandaloneQuery(state) {
  const pageReference = state.history.pageRef;
  const articleReferences = state.history.articleRefs || [];
  const currentQuestionRefs = state.currentQuestionRefs || [];
  const normalizedQuestion = normalizeText(state.question);
  const firstReferenceExpression = normalizedQuestion.match(
    /第\s*[一二两三四五六七八九十\d]+\s*篇|上一篇(?:文章)?|前者|后者|这两篇|它们|两者|这篇文章|这篇|那篇|该文|本文|本页|当前页|这一页|它|这个/
  );
  const firstPronounIndex = firstReferenceExpression
    ? firstReferenceExpression.index
    : -1;
  const currentAntecedents = currentQuestionRefs
    .map(reference => {
      const mentionIndexes = reference.mentionIndexes ||
        [reference.mentionIndex];
      const priorMentions = mentionIndexes.filter(
        mentionIndex => mentionIndex < firstPronounIndex
      );
      if (!priorMentions.length) return null;
      return Object.assign({}, reference, {
        mentionIndex: priorMentions[priorMentions.length - 1]
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.mentionIndex - right.mentionIndex);
  const currentAntecedent = currentAntecedents.length
    ? currentAntecedents[currentAntecedents.length - 1]
    : null;
  const explicitCurrentAnchor = currentQuestionRefs.length === 1
    ? currentQuestionRefs[0]
    : null;
  const ordinalExpression = normalizedQuestion.match(
    /第\s*([一二两三四五六七八九十\d]+)\s*篇/
  );
  const requiredExpressionReferences = ordinalExpression
    ? parseOrdinal(ordinalExpression[1])
    : firstReferenceExpression && firstReferenceExpression[0] === '后者'
      ? 2
      : 1;
  const expressionReferences = (
    requiredExpressionReferences > 0 &&
    currentAntecedents.length >= requiredExpressionReferences
  )
    ? currentAntecedents
    : articleReferences;
  const pageAnchor = currentAntecedent ||
    explicitCurrentAnchor ||
    pageReference ||
    articleReferences[0] ||
    null;
  const conversationalAnchor = currentAntecedent ||
    articleReferences[0] ||
    pageReference ||
    null;
  const ordinalResult = replaceReferenceExpressions(
    state.question,
    expressionReferences
  );
  let standaloneQuery = ordinalResult.rewritten;
  let unresolved = ordinalResult.unresolved;
  const resolvedArticleRefs = ordinalResult.selectedReferences.slice();
  if (
    state.route === ROUTES.PAGE_QA &&
    ordinalResult.selectedReferences.length === 1
  ) {
    const selectedMarker = `《${ordinalResult.selectedReferences[0].title}》`;
    const selectedMarkerIndex = standaloneQuery.indexOf(selectedMarker);
    if (selectedMarkerIndex >= 0) {
      standaloneQuery = standaloneQuery.slice(selectedMarkerIndex);
    }
  }
  const resolveReference = reference => {
    if (
      reference &&
      !resolvedArticleRefs.some(item => item.url === reference.url)
    ) {
      resolvedArticleRefs.push(reference);
    }
  };
  if (
    explicitCurrentAnchor &&
    [
      ROUTES.PAGE_SUMMARY,
      ROUTES.PAGE_QA,
      ROUTES.RELATED_ARTICLES,
      ROUTES.LEARNING_PATH,
      ROUTES.CODE_EXPLANATION
    ].includes(state.route)
  ) {
    resolveReference(explicitCurrentAnchor);
  }

  if (/这两篇(?:文章)?|它们|两者/.test(standaloneQuery)) {
    const pluralReferences = currentAntecedents.length >= 2
      ? currentAntecedents
      : articleReferences;
    if (pluralReferences.length >= 2) {
      for (const reference of pluralReferences.slice(0, 2)) {
        resolveReference(reference);
      }
      standaloneQuery = standaloneQuery.replace(
        /这两篇(?:文章)?|它们|两者/g,
        `《${pluralReferences[0].title}》和《${pluralReferences[1].title}》`
      );
    } else {
      unresolved = true;
    }
  }

  const pagePronoun = /这篇文章|这篇|那篇|该文|本文|本页|当前页|这一页/g;
  if (pagePronoun.test(standaloneQuery)) {
    pagePronoun.lastIndex = 0;
    if (pageAnchor) {
      resolveReference(pageAnchor);
      standaloneQuery = standaloneQuery.replace(
        pagePronoun,
        `《${pageAnchor.title}》`
      );
    } else {
      unresolved = true;
    }
  }

  if (/(?<!其)它/.test(standaloneQuery)) {
    if (conversationalAnchor) {
      resolveReference(conversationalAnchor);
      standaloneQuery = standaloneQuery.replace(
        /(?<!其)它/g,
        `《${conversationalAnchor.title}》`
      );
    } else {
      unresolved = true;
    }
  }

  if (/这个(?=模型|方法|算法|框架|概念)/.test(standaloneQuery)) {
    if (conversationalAnchor) {
      resolveReference(conversationalAnchor);
      standaloneQuery = standaloneQuery.replace(
        /这个(?=模型|方法|算法|框架|概念)/g,
        `《${conversationalAnchor.title}》`
      );
    } else {
      unresolved = true;
    }
  }

  if (/继续|接着|展开|再讲|再说|再解释|进一步|详细说说/.test(state.question)) {
    const previousTopic = state.history.previousStandaloneQuery ||
      conversationalAnchor && conversationalAnchor.title ||
      '';
    if (previousTopic) {
      resolveReference(conversationalAnchor);
      const remainingDetail = state.question
        .replace(/继续|接着|展开|再讲|再说|再解释|进一步|详细说说|解释|讲讲|说说|一下/g, '')
        .replace(/它|这个|那个|上述|前面(?:的)?/g, '')
        .replace(/[\s，。；：！？?、,.!呢吧呀啊]/g, '');
      standaloneQuery = remainingDetail
        ? `${previousTopic} ${standaloneQuery}`
        : previousTopic;
    } else {
      unresolved = true;
    }
  }

  standaloneQuery = standaloneQuery
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, state.budget.limits.maxStandaloneQueryChars);

  if (
    state.route === ROUTES.RELATED_ARTICLES &&
    !pageReference &&
    !articleReferences.length &&
    !hasExplicitRelatedTopic(state.question)
  ) {
    unresolved = true;
  }
  if (
    state.route === ROUTES.LEARNING_PATH &&
    !pageReference &&
    !articleReferences.length &&
    !explicitCurrentAnchor &&
    !hasExplicitLearningTopic(state.question)
  ) {
    unresolved = true;
  }

  return {
    standaloneQuery: standaloneQuery || state.question,
    resolvedArticleRefs,
    needsClarification: unresolved,
    clarificationReason: unresolved
      ? state.route === ROUTES.RELATED_ARTICLES
        ? 'missing_related_topic'
        : state.route === ROUTES.LEARNING_PATH
          ? 'missing_learning_topic_or_anchor'
        : 'unresolved_reference'
      : ''
  };
}

function cleanComparisonTarget(value) {
  return String(value || '')
    .replace(
      /^[，。；：！？?\s]*(?:(?:请|帮我|给我)?\s*(?:推荐|比较|对比|说说|解释|总结|概括|分析|说明)(?:一下)?\s*)?/g,
      ''
    )
    .replace(
      /\s*(有什么|有何|的)?(区别|差异|异同|比较|相比如何|哪个好|哪个更好|哪个更适合.*)?[，。；：！？?\s]*$/g,
      ''
    )
    .replace(/[《》]/g, '')
    .trim();
}

function mentionedCorpusTitles(query, posts) {
  const normalizedQuery = normalizeText(query);
  const matches = [];

  for (const post of posts || []) {
    const title = String(post && post.title || '').trim();
    const normalizedTitle = normalizeText(title);
    if (normalizedTitle.length < 2) continue;

    let start = normalizedQuery.indexOf(normalizedTitle);
    while (start >= 0) {
      matches.push({
        title,
        normalizedTitle,
        start,
        end: start + normalizedTitle.length
      });
      start = normalizedQuery.indexOf(
        normalizedTitle,
        start + normalizedTitle.length
      );
    }
  }

  matches.sort((left, right) => (
    right.normalizedTitle.length - left.normalizedTitle.length ||
    left.start - right.start
  ));
  const nonOverlapping = [];
  for (const match of matches) {
    const overlapsLongerTitle = nonOverlapping.some(selected => (
      match.start < selected.end && match.end > selected.start
    ));
    if (!overlapsLongerTitle) nonOverlapping.push(match);
  }
  nonOverlapping.sort((left, right) => left.start - right.start);

  const seen = new Set();
  return nonOverlapping
    .filter(match => {
      if (seen.has(match.normalizedTitle)) return false;
      seen.add(match.normalizedTitle);
      return true;
    })
    .map(match => match.title);
}

function splitStandaloneQuery(state, posts) {
  const query = state.standaloneQuery;
  const maxSubqueries = state.budget.limits.maxSubqueries;
  const maxLength = state.budget.limits.maxSubqueryChars;
  const candidates = [];
  const targetQueries = [];

  if (state.route === ROUTES.ARTICLE_COMPARE) {
    const explicitTitles = (state.currentQuestionRefs || [])
      .slice()
      .sort((left, right) => left.mentionIndex - right.mentionIndex)
      .map(reference => reference.title);
    const quoted = [...query.matchAll(/《([^》]{1,300})》/g)]
      .map(match => cleanComparisonTarget(match[1]));
    const titles = mentionedCorpusTitles(query, posts);
    const comparisonMatch = query.match(
      /([^；;？?！!。]{1,100}?)\s*(?:与|和|及|vs\.?|versus)\s*([^；;？?！!。]{1,100}?)(?:的?(?:区别|差异|异同|比较)|相比如何|哪个(?:更好|更适合[^？?！!。]*|好|适合[^？?！!。]*)|[？?！!。]|$)/i
    );
    const parsed = comparisonMatch
      ? [
        cleanComparisonTarget(comparisonMatch[1]),
        cleanComparisonTarget(comparisonMatch[2])
      ]
      : [];

    for (const target of titles.concat(explicitTitles, quoted, parsed)) {
      if (!target) continue;
      if (!targetQueries.some(item => normalizeText(item) === normalizeText(target))) {
        targetQueries.push(target);
      }
      if (targetQueries.length >= 2) break;
    }

    candidates.push(...targetQueries, query);
  } else {
    const parts = query
      .split(/[；;]|[？?](?=.+)/)
      .map(part => part.trim())
      .filter(Boolean);
    if (parts.length > maxSubqueries) {
      candidates.push(
        ...parts.slice(0, maxSubqueries - 1),
        parts.slice(maxSubqueries - 1).join('；')
      );
    } else {
      candidates.push(...(parts.length > 1 ? parts : [query]));
    }
  }

  const seen = new Set();
  const subqueries = [];
  for (const candidate of candidates) {
    const bounded = String(candidate || '').trim().slice(0, maxLength);
    const key = normalizeText(bounded);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    subqueries.push(bounded);
    if (subqueries.length >= maxSubqueries) break;
  }

  return {
    subqueries: subqueries.length ? subqueries : [query.slice(0, maxLength)],
    targetQueries: targetQueries.slice(0, 2)
  };
}

function rewriteForRetry(state) {
  const anchors = []
    .concat(state.history.pageRef || [])
    .concat(state.history.articleRefs || [])
    .map(reference => reference.title)
    .filter(Boolean);
  const anchorSuffix = anchors.find(title => (
    !normalizeText(state.standaloneQuery).includes(normalizeText(title))
  ));
  const suffix = anchorSuffix || '相关内容';
  const retryQueries = state.subqueries.map(query => (
    `${query} ${suffix}`.trim().slice(0, state.budget.limits.maxSubqueryChars)
  ));
  const previous = new Set(state.subqueries.map(normalizeText));
  const changed = retryQueries.some(query => !previous.has(normalizeText(query)));

  return changed ? retryQueries : [];
}

module.exports = {
  hasExplicitRelatedTopic,
  parseOrdinal,
  replaceReferenceExpressions,
  rewriteForRetry,
  rewriteStandaloneQuery,
  splitStandaloneQuery
};
