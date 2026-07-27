'use strict';

const {
  normalizeText,
  normalizePostUrl
} = require('../lib/retrieval-core');
const {
  createBudget
} = require('./config');

function corpusIndexes(corpus) {
  const chunksById = new Map();
  const chunksByUrl = new Map();
  const postsByUrl = new Map();

  for (const post of corpus.posts || []) {
    const url = normalizePostUrl(post && post.url);
    if (url && !postsByUrl.has(url)) postsByUrl.set(url, post);
  }

  for (const chunk of corpus.chunks || []) {
    const chunkId = String(chunk && chunk.id || '').trim();
    const url = normalizePostUrl(chunk && chunk.postUrl);
    if (chunkId && !chunksById.has(chunkId)) chunksById.set(chunkId, chunk);
    if (url) {
      if (!chunksByUrl.has(url)) chunksByUrl.set(url, []);
      chunksByUrl.get(url).push(chunk);
    }
  }

  return { chunksById, chunksByUrl, postsByUrl };
}

function truthFromReference(reference, indexes) {
  const referencedChunk = reference.chunkId
    ? indexes.chunksById.get(reference.chunkId)
    : null;
  const referencedUrl = normalizePostUrl(
    referencedChunk ? referencedChunk.postUrl : reference.url
  );
  if (!referencedUrl || !indexes.chunksByUrl.has(referencedUrl)) return null;

  const post = indexes.postsByUrl.get(referencedUrl);
  const fallbackChunk = referencedChunk || indexes.chunksByUrl.get(referencedUrl)[0];

  return {
    chunkId: referencedChunk ? referencedChunk.id : '',
    title: post && post.title ? post.title : fallbackChunk.postTitle,
    url: referencedUrl,
    section: referencedChunk ? referencedChunk.sectionTitle || '' : ''
  };
}

function trustedConversationContext(input, corpus, indexVersion) {
  const indexes = corpusIndexes(corpus);
  const messages = input.messages || [];
  const currentPageUrl = normalizePostUrl(input.page && input.page.url);
  let previousStandaloneQuery = '';
  let previousUserQuestion = '';
  let articleRefs = [];
  let latestAssistantSeen = false;

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (!previousUserQuestion && message.role === 'user') {
      previousUserQuestion = message.content;
    }
    if (message.role !== 'assistant' || latestAssistantSeen) continue;
    latestAssistantSeen = true;
    if (message.standaloneQuery) {
      previousStandaloneQuery = message.standaloneQuery;
    }

    const versionMatches = !message.indexVersion ||
      !indexVersion ||
      message.indexVersion === indexVersion;
    const rawReferences = []
      .concat(versionMatches ? message.citations || [] : [])
      .concat(message.related || []);
    const seenUrls = new Set();

    articleRefs = rawReferences
      .map(reference => truthFromReference(reference, indexes))
      .filter(reference => {
        if (!reference || seenUrls.has(reference.url)) return false;
        seenUrls.add(reference.url);
        return true;
      });
  }

  if (!previousStandaloneQuery) previousStandaloneQuery = previousUserQuestion;

  let pageRef = null;
  if (currentPageUrl && indexes.chunksByUrl.has(currentPageUrl)) {
    const post = indexes.postsByUrl.get(currentPageUrl);
    const chunk = indexes.chunksByUrl.get(currentPageUrl)[0];
    pageRef = {
      chunkId: '',
      title: post && post.title ? post.title : chunk.postTitle,
      url: currentPageUrl,
      section: '',
      description: post && post.description ? post.description : ''
    };
  }

  return {
    articleRefs,
    pageRef,
    previousStandaloneQuery,
    previousUserQuestion
  };
}

function currentQuestionReferences(question, corpus) {
  const normalizedQuestion = normalizeText(question);
  const indexes = corpusIndexes(corpus);
  const matches = [];

  for (const post of corpus.posts || []) {
    const title = String(post && post.title || '').trim();
    const normalizedTitle = normalizeText(title);
    const url = normalizePostUrl(post && post.url);
    if (
      normalizedTitle.length < 2 ||
      !url ||
      !indexes.chunksByUrl.has(url)
    ) {
      continue;
    }

    let mentionIndex = normalizedQuestion.indexOf(normalizedTitle);
    while (mentionIndex >= 0) {
      matches.push({
        chunkId: '',
        title,
        url,
        section: '',
        mentionIndex,
        mentionEnd: mentionIndex + normalizedTitle.length
      });
      mentionIndex = normalizedQuestion.indexOf(
        normalizedTitle,
        mentionIndex + Math.max(1, normalizedTitle.length)
      );
    }
  }

  matches.sort((left, right) => (
    right.mentionEnd - right.mentionIndex -
      (left.mentionEnd - left.mentionIndex) ||
    left.mentionIndex - right.mentionIndex
  ));

  const nonOverlappingMatches = [];
  for (const reference of matches) {
    const overlapsLongerMatch = nonOverlappingMatches.some(selected => (
      reference.mentionIndex < selected.mentionEnd &&
      reference.mentionEnd > selected.mentionIndex
    ));
    if (!overlapsLongerMatch) nonOverlappingMatches.push(reference);
  }
  nonOverlappingMatches.sort((left, right) => (
    left.mentionIndex - right.mentionIndex
  ));

  const referencesByUrl = new Map();
  for (const reference of nonOverlappingMatches) {
    if (!referencesByUrl.has(reference.url)) {
      referencesByUrl.set(reference.url, Object.assign({}, reference, {
        mentionIndexes: []
      }));
    }
    referencesByUrl.get(reference.url).mentionIndexes.push(
      reference.mentionIndex
    );
  }

  return [...referencesByUrl.values()].map(reference => {
    delete reference.mentionEnd;
    return reference;
  });
}

function createAgentState(input, options) {
  const settings = options || {};
  const corpus = settings.corpus || { posts: [], chunks: [] };
  const limits = settings.limits;
  const indexVersion = settings.indexVersion || '';
  const history = trustedConversationContext(input, corpus, indexVersion);
  const page = history.pageRef
    ? {
      title: history.pageRef.title,
      url: history.pageRef.url,
      description: history.pageRef.description || ''
    }
    : input.page;

  return {
    sessionId: input.sessionId,
    messages: input.messages || [],
    question: input.question,
    page,
    legacyMode: input.mode || '',
    compatibilityWarnings: input.compatibilityWarnings || [],
    history,
    currentQuestionRefs: currentQuestionReferences(input.question, corpus),
    route: '',
    standaloneQuery: input.question,
    subqueries: [],
    targetQueries: [],
    resolvedArticleRefs: [],
    needsClarification: false,
    clarificationReason: '',
    retrievalAttempts: 0,
    toolCalls: [],
    retrievedChunks: [],
    selectedChunks: [],
    evidenceStatus: 'unknown',
    evidenceReason: '',
    evidenceCalibration: settings.evidenceCalibration || null,
    evidenceScore: null,
    evidenceThreshold: null,
    evidenceFeatures: {},
    evidenceQuery: '',
    answer: '',
    citations: [],
    claims: [],
    related: [],
    deterministicResponse: null,
    modelResponse: null,
    citationVerification: null,
    stopReason: '',
    model: {
      attempted: false,
      answered: false,
      accepted: false,
      rejectionReason: ''
    },
    llmFallback: false,
    budget: createBudget(limits, settings.costControls),
    startedAtMs: Date.now(),
    deadlineAtMs: Date.now() + (limits && limits.overallTimeoutMs || 17000)
  };
}

module.exports = {
  corpusIndexes,
  createAgentState,
  currentQuestionReferences,
  trustedConversationContext
};
