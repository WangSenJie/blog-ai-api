'use strict';

const { randomUUID } = require('crypto');

const MEMORY_LIMITS = Object.freeze({
  maxRecordBytes: 32 * 1024,
  maxRecentMessages: 12,
  maxMessageChars: 2000,
  maxSummaryChars: 2000,
  maxTopics: 20,
  maxLearningProgress: 50,
  maxResponsePreferences: 20,
  maxArticleRefs: 8
});

class MemoryRecordError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MemoryRecordError';
    this.code = code || 'MEMORY_RECORD_INVALID';
    this.statusCode = 400;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function timestamp(value) {
  return new Date(value).toISOString();
}

function boundedText(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  let result = text.slice(0, maxLength);
  const finalCodeUnit = result.charCodeAt(result.length - 1);
  if (finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF) {
    result = result.slice(0, -1);
  }
  return result;
}

function assertRecordSize(record) {
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
  if (bytes > MEMORY_LIMITS.maxRecordBytes) {
    throw new MemoryRecordError(
      'Memory record exceeds the storage limit',
      'MEMORY_RECORD_TOO_LARGE'
    );
  }
  return bytes;
}

function createThread(now) {
  const createdAt = timestamp(now);
  return {
    threadId: `thread_${randomUUID()}`,
    createdAt,
    updatedAt: createdAt,
    summary: '',
    recentMessages: [],
    activeTopic: '',
    articleRefs: [],
    lastStandaloneQuery: ''
  };
}

function createMemoryRecord(options) {
  const settings = options || {};
  const now = settings.now === undefined ? Date.now() : settings.now;
  const ttlSeconds = settings.ttlSeconds;
  const createdAt = timestamp(now);
  const record = {
    schemaVersion: 1,
    version: 1,
    memoryId: `memory_${randomUUID()}`,
    createdAt,
    updatedAt: createdAt,
    expiresAt: timestamp(now + ttlSeconds * 1000),
    activeThread: createThread(now),
    longTerm: {
      summary: '',
      topics: [],
      learningProgress: [],
      responsePreferences: []
    }
  };
  assertRecordSize(record);
  return record;
}

function startNewThread(record, options) {
  const settings = options || {};
  const now = settings.now === undefined ? Date.now() : settings.now;
  const ttlSeconds = settings.ttlSeconds;
  const next = clone(record);
  next.version = record.version + 1;
  next.updatedAt = timestamp(now);
  next.expiresAt = timestamp(now + ttlSeconds * 1000);
  next.longTerm = Object.assign({
    summary: '',
    topics: [],
    learningProgress: [],
    responsePreferences: []
  }, next.longTerm || {});
  const threadSummary = boundedText(
    next.activeThread && next.activeThread.summary,
    MEMORY_LIMITS.maxSummaryChars
  );
  if (threadSummary && !next.longTerm.summary.includes(threadSummary)) {
    next.longTerm.summary = boundedText(
      [next.longTerm.summary, threadSummary].filter(Boolean).join(' '),
      MEMORY_LIMITS.maxSummaryChars
    );
  }
  next.activeThread = createThread(now);
  assertRecordSize(next);
  return next;
}

function normalizeCitation(citation) {
  if (!citation || typeof citation !== 'object') return null;
  const url = boundedText(citation.url, 2000);
  if (!url) return null;
  return {
    chunkId: boundedText(citation.chunkId, 300),
    title: boundedText(citation.title, 300),
    url,
    section: boundedText(citation.section, 300)
  };
}

function appendTurn(record, input, payload, options) {
  const settings = options || {};
  const now = settings.now === undefined ? Date.now() : settings.now;
  const ttlSeconds = settings.ttlSeconds;
  const next = clone(record);
  const createdAt = timestamp(now);
  const requestId = boundedText(settings.requestId, 64);
  const citations = (payload.citations || [])
    .slice(0, MEMORY_LIMITS.maxArticleRefs)
    .map(normalizeCitation)
    .filter(Boolean);
  const memoryDelta = settings.memoryDelta &&
    typeof settings.memoryDelta === 'object'
    ? settings.memoryDelta
    : null;
  const userMessage = {
    role: 'user',
    content: boundedText(input.question, MEMORY_LIMITS.maxMessageChars),
    createdAt,
    requestId
  };
  const assistantMessage = {
    role: 'assistant',
    content: boundedText(payload.answer, MEMORY_LIMITS.maxMessageChars),
    citations,
    indexVersion: boundedText(payload.meta && payload.meta.indexVersion, 128),
    standaloneQuery: boundedText(
      payload.meta && payload.meta.standaloneQuery || input.question,
      1000
    ),
    createdAt,
    requestId
  };

  next.version = record.version + 1;
  next.updatedAt = createdAt;
  next.expiresAt = timestamp(now + ttlSeconds * 1000);
  next.activeThread.updatedAt = createdAt;
  next.activeThread.recentMessages = next.activeThread.recentMessages
    .concat([userMessage, assistantMessage])
    .slice(-MEMORY_LIMITS.maxRecentMessages);
  next.activeThread.lastStandaloneQuery = boundedText(
    payload.meta && payload.meta.standaloneQuery || input.question,
    1000
  );
  next.activeThread.articleRefs = citations;
  next.longTerm = Object.assign({
    summary: '',
    topics: [],
    learningProgress: [],
    responsePreferences: []
  }, next.longTerm || {});
  if (memoryDelta) {
    const activeTopic = boundedText(memoryDelta.activeTopic, 200);
    const summaryUpdate = boundedText(
      memoryDelta.summaryUpdate,
      MEMORY_LIMITS.maxSummaryChars
    );
    if (activeTopic) {
      next.activeThread.activeTopic = activeTopic;
      const topic = {
        name: activeTopic,
        lastDiscussedAt: createdAt,
        articleUrls: [...new Set(citations.map(citation => citation.url))]
      };
      next.longTerm.topics = (next.longTerm.topics || [])
        .filter(item => item && item.name !== activeTopic)
        .concat([topic])
        .slice(-MEMORY_LIMITS.maxTopics);
    }
    if (summaryUpdate) {
      next.activeThread.summary = summaryUpdate;
      next.longTerm.summary = boundedText(
        [next.longTerm.summary, summaryUpdate]
          .filter(Boolean)
          .filter((value, index, values) => values.indexOf(value) === index)
          .join(' '),
        MEMORY_LIMITS.maxSummaryChars
      );
    }
    for (const item of memoryDelta.explicitLearningProgress || []) {
      if (!item || typeof item !== 'object') continue;
      const articleUrl = boundedText(item.articleUrl, 2000);
      const status = boundedText(item.status, 40);
      if (!articleUrl || !['completed', 'in_progress', 'planned'].includes(status)) {
        continue;
      }
      next.longTerm.learningProgress = (next.longTerm.learningProgress || [])
        .filter(progress => progress && progress.articleUrl !== articleUrl)
        .concat([{
          articleUrl,
          articleTitle: boundedText(item.articleTitle, 300),
          status,
          source: 'explicit_user_statement',
          updatedAt: createdAt
        }])
        .slice(-MEMORY_LIMITS.maxLearningProgress);
    }
    for (const item of memoryDelta.responsePreferences || []) {
      if (!item || typeof item !== 'object') continue;
      const kind = boundedText(item.kind, 80);
      const value = boundedText(item.value, 120);
      if (!kind || !value) continue;
      next.longTerm.responsePreferences = (next.longTerm.responsePreferences || [])
        .filter(preference => preference && preference.kind !== kind)
        .concat([{
          kind,
          value,
          source: 'explicit_user_statement',
          updatedAt: createdAt
        }])
        .slice(-MEMORY_LIMITS.maxResponsePreferences);
    }
  }
  assertRecordSize(next);
  return next;
}

function trustedMessages(record) {
  if (!record || !record.activeThread) return [];
  return (record.activeThread.recentMessages || [])
    .filter(message => message && (
      message.role === 'user' || message.role === 'assistant'
    ))
    .map(message => {
      const normalized = {
        role: message.role,
        content: boundedText(message.content, MEMORY_LIMITS.maxMessageChars)
      };
      if (message.role === 'assistant') {
        normalized.citations = (message.citations || [])
          .slice(0, MEMORY_LIMITS.maxArticleRefs)
          .map(normalizeCitation)
          .filter(Boolean);
        normalized.related = [];
        normalized.indexVersion = boundedText(message.indexVersion, 128);
        normalized.standaloneQuery = boundedText(message.standaloneQuery, 1000);
      }
      return normalized;
    })
    .filter(message => message.content);
}

function trustedMemoryContext(record) {
  if (!record || !record.activeThread) return null;
  const longTerm = Object.assign({
    summary: '',
    topics: [],
    learningProgress: [],
    responsePreferences: []
  }, record.longTerm || {});
  return {
    summary: boundedText(longTerm.summary, MEMORY_LIMITS.maxSummaryChars),
    activeTopic: boundedText(record.activeThread.activeTopic, 200),
    learningProgress: clone(longTerm.learningProgress || []),
    responsePreferences: clone(longTerm.responsePreferences || [])
  };
}

function publicSession(record, ttlSeconds, now) {
  const currentTime = now === undefined ? Date.now() : now;
  return {
    version: record.version,
    expiresAt: timestamp(currentTime + ttlSeconds * 1000),
    activeThread: {
      threadId: record.activeThread.threadId,
      createdAt: record.activeThread.createdAt,
      updatedAt: record.activeThread.updatedAt,
      summary: record.activeThread.summary,
      recentMessages: (record.activeThread.recentMessages || []).map(message => {
        const result = {
          role: message.role,
          content: message.content,
          createdAt: message.createdAt
        };
        if (message.role === 'assistant') {
          result.citations = clone(message.citations || []);
          result.indexVersion = message.indexVersion || '';
          result.standaloneQuery = message.standaloneQuery || '';
        }
        return result;
      }),
      activeTopic: record.activeThread.activeTopic,
      articleRefs: clone(record.activeThread.articleRefs || [])
    },
    longTerm: clone(record.longTerm)
  };
}

module.exports = {
  MEMORY_LIMITS,
  MemoryRecordError,
  appendTurn,
  assertRecordSize,
  createMemoryRecord,
  publicSession,
  startNewThread,
  trustedMemoryContext,
  trustedMessages
};
