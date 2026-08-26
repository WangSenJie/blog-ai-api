'use strict';

const {
  normalizePostUrl,
  normalizeText
} = require('../lib/retrieval-core');

const INJECTION_PATTERN = /忽略(?:系统|之前|以上)|system\s*prompt|developer\s*message|调用工具|执行命令|泄露|删除所有/i;
const SENSITIVE_TOPIC_PATTERN = /姓名|身份证|手机号|住址|地址|健康|疾病|病史|财务|收入|银行卡|密码|性别|年龄|政治|宗教|https?:\/\//i;
const PERSISTENT_PREFERENCE_PATTERN = /以后|今后|接下来都|总是|记住|偏好|优先|默认|每次都/;
const PREFERENCE_VALUES = Object.freeze({
  example_language: Object.freeze({
    python: ['python', 'py'],
    javascript: ['javascript', 'js'],
    typescript: ['typescript', 'ts'],
    java: ['java'],
    go: ['golang', 'go'],
    rust: ['rust'],
    cpp: ['c++', 'cpp']
  }),
  answer_style: Object.freeze({
    concise: ['简洁', '简短', '精简'],
    detailed: ['详细', '深入', '展开'],
    step_by_step: ['分步骤', '一步一步', '逐步']
  }),
  response_language: Object.freeze({
    zh_cn: ['中文', '汉语'],
    en: ['英文', '英语']
  })
});

function compact(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : '';
}

function explicitProgressStatus(question) {
  const text = String(question || '');
  if (/我(?:已经|刚刚|刚)?(?:看完|读完|学完|完成(?:了)?学习)/.test(text)) {
    return 'completed';
  }
  if (/我(?:正在|目前在|开始)(?:学习|看|读)/.test(text)) {
    return 'in_progress';
  }
  if (/我(?:打算|计划|准备|想要?)(?:学习|看|读)/.test(text)) {
    return 'planned';
  }
  return '';
}

function hasExplicitMemoryIntent(question) {
  const text = String(question || '');
  return Boolean(explicitProgressStatus(text)) ||
    PERSISTENT_PREFERENCE_PATTERN.test(text);
}

function canonicalPreference(kind, value, question) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const aliases = {
    code_language: 'example_language',
    examplelanguage: 'example_language',
    answerstyle: 'answer_style',
    language: 'response_language',
    responselanguage: 'response_language'
  };
  const canonicalKind = aliases[normalizedKind] || normalizedKind;
  const values = PREFERENCE_VALUES[canonicalKind];
  if (!values) return null;
  const normalizedValue = String(value || '').trim().toLowerCase();
  const candidate = Object.entries(values).find(([canonical, terms]) => (
    normalizedValue === canonical || terms.some(term => normalizedValue === term)
  ));
  if (!candidate) return null;
  const [, terms] = candidate;
  const normalizedQuestion = normalizeText(question);
  if (!terms.some(term => normalizedQuestion.includes(normalizeText(term)))) {
    return null;
  }
  return { kind: canonicalKind, value: candidate[0] };
}

function sanitizeMemoryDelta(delta, context) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return null;
  const settings = context || {};
  const question = compact(settings.question, 1000);
  if (!question || INJECTION_PATTERN.test(question)) return null;
  const citations = (settings.citations || []).map(citation => ({
    title: compact(citation && citation.title, 300),
    url: normalizePostUrl(citation && citation.url),
    chunkId: compact(citation && citation.chunkId, 300)
  })).filter(item => item.title && item.url);
  const citationsByUrl = new Map(citations.map(item => [item.url, item]));
  const result = {
    activeTopic: '',
    summaryUpdate: '',
    explicitLearningProgress: [],
    responsePreferences: []
  };

  const topic = compact(delta.activeTopic, 200);
  if (topic && !SENSITIVE_TOPIC_PATTERN.test(topic)) {
    const normalizedTopic = normalizeText(topic);
    const explicit = normalizeText(question).includes(normalizedTopic);
    const cited = citations.some(item => normalizeText(item.title) === normalizedTopic);
    if (explicit || cited) {
      result.activeTopic = topic;
      result.summaryUpdate = `用户正在了解${topic}。`;
    }
  }

  const explicitStatus = explicitProgressStatus(question);
  if (explicitStatus && Array.isArray(delta.explicitLearningProgress)) {
    for (const item of delta.explicitLearningProgress.slice(0, 10)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const articleUrl = normalizePostUrl(item.articleUrl);
      const citation = citationsByUrl.get(articleUrl);
      if (!citation || String(item.status || '') !== explicitStatus) continue;
      const mentionsArticle = normalizeText(question).includes(
        normalizeText(citation.title)
      );
      if (!mentionsArticle) continue;
      result.explicitLearningProgress.push({
        articleUrl,
        articleTitle: citation.title,
        status: explicitStatus,
        source: 'explicit_user_statement'
      });
    }
  }

  if (
    PERSISTENT_PREFERENCE_PATTERN.test(question) &&
    Array.isArray(delta.responsePreferences)
  ) {
    const seenKinds = new Set();
    for (const item of delta.responsePreferences.slice(0, 10)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const preference = canonicalPreference(item.kind, item.value, question);
      if (!preference || seenKinds.has(preference.kind)) continue;
      seenKinds.add(preference.kind);
      result.responsePreferences.push(Object.assign(preference, {
        source: 'explicit_user_statement'
      }));
    }
  }

  return result.activeTopic ||
    result.explicitLearningProgress.length ||
    result.responsePreferences.length
    ? result
    : null;
}

module.exports = {
  PREFERENCE_VALUES,
  canonicalPreference,
  explicitProgressStatus,
  hasExplicitMemoryIntent,
  sanitizeMemoryDelta
};
