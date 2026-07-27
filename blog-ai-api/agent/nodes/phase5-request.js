'use strict';

const {
  normalizePostUrl,
  normalizeText
} = require('../../lib/retrieval-core');

const CHINESE_ORDINALS = Object.freeze({
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

function ordinal(value) {
  if (/^\d+$/.test(value)) return Number(value);
  return CHINESE_ORDINALS[value] || 0;
}

function uniqueReferences(state) {
  const seen = new Set();
  const references = [];
  const candidates = []
    .concat(state.resolvedArticleRefs || [])
    .concat(state.currentQuestionRefs || [])
    .concat(state.history && state.history.pageRef || [])
    .concat(state.history && state.history.articleRefs || []);
  for (const reference of candidates) {
    const url = normalizePostUrl(reference && reference.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    references.push(Object.assign({}, reference, { url }));
  }
  return references;
}

function comparisonDimensions(question) {
  const text = String(question || '');
  const dimensions = [];
  const add = value => {
    if (!dimensions.includes(value)) dimensions.push(value);
  };
  if (/实现|代码|公式|算法|机制|原理/.test(text)) add('implementation');
  if (/流程|步骤|线上|离线|训练|调用/.test(text)) add('workflow');
  if (/场景|适合|适用|应用/.test(text)) add('scenario');
  if (/优点|优势|特点|好处/.test(text)) add('strengths');
  if (/缺点|不足|局限|风险|注意/.test(text)) add('limitations');
  if (!dimensions.length) add('core');
  return dimensions.slice(0, 3);
}

function learningLevel(question) {
  const text = String(question || '');
  if (/专家|高级进阶|研究/.test(text)) return 'advanced';
  if (/高级|深入|进阶|有基础|熟悉/.test(text)) return 'intermediate';
  return 'beginner';
}

function learningGoal(question) {
  const match = String(question || '').match(
    /(?:为了|目标是|想要|希望|用于)\s*([^，。；！？?]{2,120})/
  );
  return match ? match[1].trim() : '';
}

function completedUrls(question, references) {
  const text = String(question || '');
  const completed = [];
  for (const reference of references) {
    const title = String(reference.title || '').trim();
    if (!title) continue;
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:学过|看过|读过|完成(?:了)?|已(?:经)?学完)\\s*(?:《)?${escaped}`).test(text)) {
      completed.push(reference.url);
    }
  }
  return [...new Set(completed)];
}

function codeSelector(question) {
  const text = String(question || '');
  const blockId = text.match(/\b(code_[a-f0-9]{24})\b/);
  if (blockId) return { blockId: blockId[1], ordinal: 0 };
  const ordinalMatch = text.match(/第\s*([一二两三四五六七八九十\d]+)\s*段代码/);
  return {
    blockId: '',
    ordinal: ordinalMatch ? ordinal(ordinalMatch[1]) : 0
  };
}

function createPhase5Request(state) {
  const references = uniqueReferences(state);
  const primary = references[0] || null;
  const question = state.standaloneQuery || state.question;
  return {
    comparison: {
      urls: references.slice(0, 4).map(reference => reference.url),
      dimensions: comparisonDimensions(question)
    },
    learning: {
      topic: question,
      goal: learningGoal(question),
      level: learningLevel(question),
      currentPostUrl: primary ? primary.url : '',
      completedUrls: completedUrls(state.question, references)
    },
    code: Object.assign({
      url: primary ? primary.url : '',
      query: question
    }, codeSelector(state.question))
  };
}

module.exports = {
  codeSelector,
  comparisonDimensions,
  completedUrls,
  createPhase5Request,
  learningGoal,
  learningLevel,
  uniqueReferences
};
