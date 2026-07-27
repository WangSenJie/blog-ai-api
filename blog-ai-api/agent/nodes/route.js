'use strict';

const ROUTES = Object.freeze({
  DIRECT: 'direct',
  PAGE_SUMMARY: 'page_summary',
  PAGE_QA: 'page_qa',
  RELATED_ARTICLES: 'related_articles',
  ARTICLE_COMPARE: 'article_compare',
  LEARNING_PATH: 'learning_path',
  CODE_EXPLANATION: 'code_explanation',
  SITE_QA: 'site_qa'
});

const ORDINALS = Object.freeze({
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

function ordinalNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return ORDINALS[value] || 0;
}

function normalizedQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasResolvableArticleSelection(state) {
  const question = normalizedQuestion(state && state.question);
  const expression = question.match(
    /第\s*([一二两三四五六七八九十\d]+)\s*篇|前者|后者/
  );
  if (!expression) return false;

  const expressionIndex = expression.index;
  const currentReferences = (state.currentQuestionRefs || [])
    .filter(reference => (
      (reference.mentionIndexes || [reference.mentionIndex])
        .some(index => index < expressionIndex)
    ))
    .sort((left, right) => left.mentionIndex - right.mentionIndex);
  const historicalReferences = state.history &&
    Array.isArray(state.history.articleRefs)
    ? state.history.articleRefs
    : [];
  const requiredCount = expression[1]
    ? ordinalNumber(expression[1])
    : expression[0] === '后者'
      ? 2
      : 1;

  return requiredCount > 0 && (
    currentReferences.length >= requiredCount ||
    historicalReferences.length >= requiredCount
  );
}

function isDirectQuestion(question) {
  const text = String(question || '').trim().toLowerCase();
  return /^(你好|您好|嗨|哈喽|hello|hi|你是谁|你能做什么|怎么使用|如何使用)[呀啊呢？?!！。.]*$/.test(text);
}

function isRelatedArticlesQuestion(question) {
  const text = String(question || '');
  if (/相关文章|相关推荐|延伸阅读|类似文章/.test(text)) {
    return true;
  }

  return (
    /(?:请|帮我|给我|能否|可以|我想(?:看|读))[^。！？?!]{0,20}推荐/.test(text) ||
    /推荐(?:给我)?\s*(?:几|一|两|三|一些|若干)(?:篇|个|本)?/.test(text) ||
    /推荐(?:给我)?\s*(?:文章|阅读|一下)/.test(text)
  );
}

function isNextArticleQuestion(question) {
  return /下一篇|下一步(?:该)?(?:看|学|读)|接下来(?:该)?(?:看|学|读)|后续(?:该)?(?:看|学|读)/.test(
    String(question || '')
  );
}

function isLearningPathQuestion(question) {
  const text = String(question || '');
  return /学习路径|学习路线|阅读顺序|学习计划|从零(?:开始)?(?:学|学习)|(?:先|应该先)(?:看|学|读)|(?:学|学习).{0,12}之前(?:先)?(?:看|学|读)|怎么(?:学|学习)|如何(?:学|学习)/.test(text);
}

function hasExplicitLearningTopic(question) {
  const remaining = String(question || '')
    .toLowerCase()
    .replace(
      /学习路径|学习路线|阅读顺序|学习计划|从零(?:开始)?|下一篇|下一步|接下来|后续|推荐|文章|我|想|要|请|帮我|给我|应该|先|再|看|学|读|怎么|如何|什么|哪些|一下|之前|吗|呢/g,
      ''
    )
    .replace(/[\s，。；：！？?、,.!]/g, '');
  return remaining.length >= 2;
}

function isCodeExplanationQuestion(question) {
  return /代码块|这段代码|该段代码|第\s*[一二两三四五六七八九十\d]+\s*段代码|解释.{0,30}代码|代码.{0,20}(?:解释|含义|作用|怎么(?:写|运行))|逐行(?:解释|讲解)/.test(
    String(question || '')
  );
}

function isComparisonQuestion(question, state) {
  const text = String(question || '');
  const hasComparisonCue = (
    /对比|比较|区别(?!度)|差异(?!化)|异同|相比|哪个(?:更|好|适合|应该)|哪篇更|如何选择/.test(text) ||
    /\bvs\.?\b|versus/i.test(text)
  );
  if (!hasComparisonCue) return false;

  const hasNamedPair = (
    /[^，。；：！？?]{1,100}(?:与|和|及|\bvs\.?\b|versus)[^，。；：！？?]{1,100}/i.test(text) ||
    /[^，。；：！？?]{1,100}相比[^，。；：！？?]{1,100}/.test(text)
  );
  const hasPluralReference = /这两篇(?:文章)?|两者|前者|后者/.test(text);
  const hasHistoryPair = Boolean(
    state &&
    state.history &&
    Array.isArray(state.history.articleRefs) &&
    state.history.articleRefs.length >= 2
  );
  const hasCurrentQuestionPair = Boolean(
    state &&
    Array.isArray(state.currentQuestionRefs) &&
    state.currentQuestionRefs.length >= 2
  );

  return hasNamedPair ||
    hasPluralReference ||
    hasHistoryPair ||
    hasCurrentQuestionPair;
}

function routeQuestion(state) {
  const question = String(state.question || '');
  const hasArticleSelection = hasResolvableArticleSelection(state);
  const hasPageAnchor = Boolean(
    state.history.pageRef ||
    state.history.articleRefs.length ||
    state.currentQuestionRefs && state.currentQuestionRefs.length === 1 ||
    hasArticleSelection
  );

  if (isDirectQuestion(question)) return ROUTES.DIRECT;
  if (isComparisonQuestion(question, state)) {
    return ROUTES.ARTICLE_COMPARE;
  }
  if (isCodeExplanationQuestion(question) && hasPageAnchor) {
    return ROUTES.CODE_EXPLANATION;
  }
  if (isNextArticleQuestion(question) || isLearningPathQuestion(question)) {
    return ROUTES.LEARNING_PATH;
  }
  if (
    (state.legacyMode === 'page_summary' || /总结|概括|摘要/.test(question)) &&
    hasPageAnchor
  ) {
    return ROUTES.PAGE_SUMMARY;
  }
  if (isRelatedArticlesQuestion(question)) {
    return ROUTES.RELATED_ARTICLES;
  }
  if (
    (
      state.legacyMode === 'page' ||
      /这篇|本文|本页|当前页|这一页|该文/.test(question) ||
      hasArticleSelection
    ) &&
    hasPageAnchor
  ) {
    return ROUTES.PAGE_QA;
  }
  return ROUTES.SITE_QA;
}

module.exports = {
  ROUTES,
  hasResolvableArticleSelection,
  isComparisonQuestion,
  isCodeExplanationQuestion,
  isDirectQuestion,
  hasExplicitLearningTopic,
  isLearningPathQuestion,
  isNextArticleQuestion,
  isRelatedArticlesQuestion,
  routeQuestion
};
