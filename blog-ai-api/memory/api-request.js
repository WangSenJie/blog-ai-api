'use strict';

const { REQUEST_LIMITS, RequestValidationError } = require('./session');

const MEMORY_API_BODY_LIMIT = 4 * 1024;

function fail(message, statusCode) {
  throw new RequestValidationError(message, statusCode || 400);
}

function parseBody(rawBody) {
  let body = rawBody;
  let serialized;
  if (typeof rawBody === 'string') {
    serialized = rawBody;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch (error) {
      fail('Invalid JSON body');
    }
  } else {
    try {
      serialized = JSON.stringify(rawBody || {});
    } catch (error) {
      fail('Invalid JSON body');
    }
    body = rawBody || {};
  }
  if (Buffer.byteLength(serialized, 'utf8') > MEMORY_API_BODY_LIMIT) {
    fail('Request body is too large', 413);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('Invalid JSON body');
  }
  return body;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) fail(`Missing ${field}`);
  const text = value.trim();
  if (text.length > maxLength) fail(`${field} is too long`);
  return text;
}

function memoryToken(value, optional) {
  if ((value === undefined || value === null || value === '') && optional) return '';
  return requiredString(value, 'memoryToken', REQUEST_LIMITS.maxMemoryTokenChars);
}

function uuid(value, field) {
  const text = requiredString(value, field, REQUEST_LIMITS.maxRequestIdChars);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    fail(`Invalid ${field}`);
  }
  return text;
}

function version(value) {
  if (!Number.isInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    fail('Invalid expectedMemoryVersion');
  }
  return value;
}

function normalizeSessionRequest(rawBody, method) {
  const body = parseBody(rawBody);
  if (method === 'POST') {
    return { memoryToken: memoryToken(body.memoryToken, true) };
  }
  return {
    memoryToken: memoryToken(body.memoryToken, false),
    requestId: uuid(body.requestId, 'requestId')
  };
}

function normalizeThreadRequest(rawBody) {
  const body = parseBody(rawBody);
  const currentThreadId = requiredString(
    body.currentThreadId,
    'currentThreadId',
    REQUEST_LIMITS.maxThreadIdChars
  );
  if (!/^thread_[0-9a-f-]{36}$/i.test(currentThreadId)) {
    fail('Invalid currentThreadId');
  }
  return {
    memoryToken: memoryToken(body.memoryToken, false),
    currentThreadId,
    expectedMemoryVersion: version(body.expectedMemoryVersion),
    requestId: uuid(body.requestId, 'requestId')
  };
}

module.exports = {
  MEMORY_API_BODY_LIMIT,
  normalizeSessionRequest,
  normalizeThreadRequest
};
