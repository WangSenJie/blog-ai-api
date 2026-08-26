'use strict';

const { randomUUID } = require('crypto');

const {
  normalizePostUrl
} = require('../lib/retrieval-core');

const REQUEST_LIMITS = Object.freeze({
  maxBodyBytes: 32 * 1024,
  maxQuestionChars: 1000,
  maxRawMessages: 16,
  maxHistoryMessages: 8,
  maxMessageChars: 2000,
  maxHistoryChars: 8000,
  maxSessionIdChars: 128,
  maxPageTitleChars: 300,
  maxPageDescriptionChars: 1000,
  maxHistoryRefs: 6,
  maxReferenceTitleChars: 300,
  maxReferenceSectionChars: 300,
  maxChunkIdChars: 300,
  maxStandaloneQueryChars: 1000,
  maxMemoryTokenChars: 160,
  maxThreadIdChars: 64,
  maxRequestIdChars: 36
});

const ALLOWED_MESSAGE_ROLES = new Set(['user', 'assistant']);
const ALLOWED_LEGACY_MODES = new Set([
  'site',
  'page',
  'page_summary'
]);

class RequestValidationError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'RequestValidationError';
    this.statusCode = statusCode || 400;
  }
}

function validationError(message, statusCode) {
  throw new RequestValidationError(message, statusCode);
}

function boundedString(value, field, maxLength, options) {
  const settings = Object.assign({
    optional: false,
    allowEmpty: false
  }, options);

  if (value === undefined || value === null) {
    if (settings.optional) return '';
    validationError(`Missing ${field}`);
  }

  if (typeof value !== 'string') {
    validationError(`Invalid ${field}`);
  }

  const text = value.trim();
  if (!text && !settings.allowEmpty) {
    if (settings.optional) return '';
    validationError(`Missing ${field}`);
  }
  if (text.length > maxLength) {
    validationError(`${field} is too long`);
  }
  return text;
}

function sanitizeReference(raw, kind) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const url = normalizePostUrl(raw.url);
  if (!url) return null;

  const reference = {
    title: boundedString(
      raw.title,
      `${kind} title`,
      REQUEST_LIMITS.maxReferenceTitleChars,
      { optional: true }
    ),
    url
  };

  if (kind === 'citation') {
    reference.chunkId = boundedString(
      raw.chunkId,
      'citation chunkId',
      REQUEST_LIMITS.maxChunkIdChars,
      { optional: true }
    );
    reference.section = boundedString(
      raw.section,
      'citation section',
      REQUEST_LIMITS.maxReferenceSectionChars,
      { optional: true }
    );
  }

  return reference;
}

function sanitizeReferenceList(value, kind) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) validationError(`Invalid ${kind} list`);

  return value
    .slice(0, REQUEST_LIMITS.maxHistoryRefs)
    .map(item => sanitizeReference(item, kind))
    .filter(Boolean);
}

function normalizeMessage(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    validationError(`Invalid message at index ${index}`);
  }

  const role = boundedString(raw.role, `message role at index ${index}`, 20);
  if (!ALLOWED_MESSAGE_ROLES.has(role)) {
    validationError(`Unsupported message role: ${role}`);
  }

  const message = {
    role,
    content: boundedString(
      raw.content,
      `message content at index ${index}`,
      REQUEST_LIMITS.maxMessageChars
    )
  };

  if (role === 'assistant') {
    message.citations = sanitizeReferenceList(raw.citations, 'citation');
    message.related = sanitizeReferenceList(raw.related, 'related');
    message.indexVersion = boundedString(
      raw.indexVersion,
      'message indexVersion',
      128,
      { optional: true }
    );
    message.standaloneQuery = boundedString(
      raw.standaloneQuery,
      'message standaloneQuery',
      REQUEST_LIMITS.maxStandaloneQueryChars,
      { optional: true }
    );
  }

  return message;
}

function trimConversation(messages) {
  const kept = [];
  let characters = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (kept.length >= REQUEST_LIMITS.maxHistoryMessages) break;
    if (kept.length && characters + message.content.length > REQUEST_LIMITS.maxHistoryChars) {
      break;
    }
    kept.unshift(message);
    characters += message.content.length;
  }

  while (kept.length > 1 && kept[0].role === 'assistant') {
    kept.shift();
  }

  return kept;
}

function normalizeMessages(rawMessages, explicitQuestion) {
  if (rawMessages === undefined || rawMessages === null) {
    rawMessages = [];
  }
  if (!Array.isArray(rawMessages)) validationError('Invalid messages');
  if (rawMessages.length > REQUEST_LIMITS.maxRawMessages) {
    validationError('Too many messages');
  }

  const messages = rawMessages.map(normalizeMessage);
  const warnings = [];
  const latestUser = [...messages].reverse().find(message => message.role === 'user');
  const lastMessage = messages[messages.length - 1];
  if (
    !explicitQuestion &&
    messages.length &&
    (!lastMessage || lastMessage.role !== 'user')
  ) {
    validationError('messages must end with the current user question');
  }
  let question = explicitQuestion || (latestUser && latestUser.content) || '';

  if (!question) validationError('Missing question');
  if (question.length > REQUEST_LIMITS.maxQuestionChars) {
    validationError('question is too long');
  }

  if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== question) {
    if (lastMessage && latestUser && explicitQuestion && latestUser.content !== question) {
      warnings.push('question_appended_to_history');
    }
    messages.push({ role: 'user', content: question });
  }

  return {
    messages: trimConversation(messages),
    question,
    warnings
  };
}

function normalizeSessionId(value) {
  if (value === undefined || value === null || value === '') {
    return `session_${randomUUID()}`;
  }

  const sessionId = boundedString(
    value,
    'sessionId',
    REQUEST_LIMITS.maxSessionIdChars
  );
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    validationError('Invalid sessionId');
  }
  return sessionId;
}

function normalizePage(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    validationError('Invalid page context');
  }

  const rawUrl = boundedString(value.url, 'page url', 2000, { optional: true });
  const url = rawUrl ? normalizePostUrl(rawUrl) : '';
  if (rawUrl && !url) validationError('Invalid page url');

  const page = {
    title: boundedString(
      value.title,
      'page title',
      REQUEST_LIMITS.maxPageTitleChars,
      { optional: true }
    ),
    url,
    description: boundedString(
      value.description,
      'page description',
      REQUEST_LIMITS.maxPageDescriptionChars,
      { optional: true }
    )
  };

  return page.title || page.url || page.description ? page : null;
}

function normalizeUuid(value, field) {
  const uuid = boundedString(value, field, REQUEST_LIMITS.maxRequestIdChars);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    validationError(`Invalid ${field}`);
  }
  return uuid;
}

function normalizeMemoryContext(body) {
  const hasMemoryFields = [
    'memoryToken',
    'threadId',
    'expectedMemoryVersion',
    'requestId'
  ].some(field => body[field] !== undefined && body[field] !== null);
  if (!hasMemoryFields) {
    return {
      memoryToken: '',
      threadId: '',
      expectedMemoryVersion: null,
      requestId: ''
    };
  }

  const memoryToken = boundedString(
    body.memoryToken,
    'memoryToken',
    REQUEST_LIMITS.maxMemoryTokenChars
  );
  const threadId = boundedString(
    body.threadId,
    'threadId',
    REQUEST_LIMITS.maxThreadIdChars
  );
  if (!/^thread_[0-9a-f-]{36}$/i.test(threadId)) {
    validationError('Invalid threadId');
  }
  if (
    !Number.isInteger(body.expectedMemoryVersion) ||
    body.expectedMemoryVersion < 1 ||
    body.expectedMemoryVersion > Number.MAX_SAFE_INTEGER
  ) {
    validationError('Invalid expectedMemoryVersion');
  }

  return {
    memoryToken,
    threadId,
    expectedMemoryVersion: body.expectedMemoryVersion,
    requestId: normalizeUuid(body.requestId, 'requestId')
  };
}

function parseRawBody(rawBody) {
  let serialized;

  if (typeof rawBody === 'string') {
    serialized = rawBody;
  } else {
    try {
      serialized = JSON.stringify(rawBody || {});
    } catch (error) {
      validationError('Invalid JSON body');
    }
  }

  if (Buffer.byteLength(serialized, 'utf8') > REQUEST_LIMITS.maxBodyBytes) {
    validationError('Request body is too large', 413);
  }

  if (typeof rawBody !== 'string') return rawBody || {};

  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      validationError('Invalid JSON body');
    }
    return parsed;
  } catch (error) {
    if (error instanceof RequestValidationError) throw error;
    validationError('Invalid JSON body');
  }
}

function normalizeAskRequest(rawBody) {
  const body = parseRawBody(rawBody);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    validationError('Invalid JSON body');
  }

  const explicitQuestion = boundedString(
    body.question,
    'question',
    REQUEST_LIMITS.maxQuestionChars,
    { optional: true }
  );
  const conversation = normalizeMessages(body.messages, explicitQuestion);
  const rawMode = boundedString(body.mode, 'mode', 50, { optional: true });
  const memory = normalizeMemoryContext(body);

  return Object.assign({
    question: conversation.question,
    messages: conversation.messages,
    sessionId: normalizeSessionId(body.sessionId),
    page: normalizePage(body.page),
    mode: ALLOWED_LEGACY_MODES.has(rawMode) ? rawMode : '',
    compatibilityWarnings: conversation.warnings
  }, memory);
}

module.exports = {
  ALLOWED_MESSAGE_ROLES,
  REQUEST_LIMITS,
  RequestValidationError,
  normalizeAskRequest,
  normalizeMemoryContext,
  normalizeMessages,
  normalizePage,
  trimConversation
};
