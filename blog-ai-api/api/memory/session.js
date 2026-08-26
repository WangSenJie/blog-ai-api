'use strict';

const {
  applyCors,
  contentType,
  declaredContentLength,
  sendJson
} = require('../../lib/http');
const { createRequestTrace } = require('../../lib/trace');
const {
  MEMORY_API_BODY_LIMIT,
  normalizeSessionRequest
} = require('../../memory/api-request');
const {
  MemoryServiceError,
  getMemoryService
} = require('../../memory/service');
const { MemoryStoreError } = require('../../memory/store');
const { RequestValidationError } = require('../../memory/session');

function meta(trace, values) {
  return Object.assign({}, values, {
    traceId: trace.traceId,
    timings: trace.snapshot()
  });
}

function publicMemory(result) {
  const session = result.session;
  return {
    memory: {
      status: 'active',
      version: session.version,
      threadId: session.activeThread.threadId,
      expiresAt: session.expiresAt,
      restored: !result.created
    },
    context: {
      summary: session.activeThread.summary,
      activeTopic: session.activeThread.activeTopic,
      recentMessages: session.activeThread.recentMessages,
      articleRefs: session.activeThread.articleRefs
    }
  };
}

function createSessionHandler(options) {
  const settings = options || {};
  return async (req, res) => {
    const trace = createRequestTrace();
    const originAllowed = applyCors(req, res);
    res.setHeader('X-Trace-Id', trace.traceId);

    if (req.method === 'OPTIONS') {
      if (!originAllowed) {
        sendJson(res, 403, { error: 'Origin is not allowed', meta: meta(trace) });
      } else {
        res.statusCode = 200;
        res.end();
      }
      return;
    }
    if (!originAllowed) {
      sendJson(res, 403, { error: 'Origin is not allowed', meta: meta(trace) });
      return;
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      sendJson(res, 405, { error: 'Method not allowed', meta: meta(trace) });
      return;
    }
    if (contentType(req) !== 'application/json') {
      sendJson(res, 415, {
        error: 'Content-Type must be application/json',
        meta: meta(trace)
      });
      return;
    }
    const length = declaredContentLength(req);
    if (Number.isFinite(length) && length > MEMORY_API_BODY_LIMIT) {
      sendJson(res, 413, { error: 'Request body is too large', meta: meta(trace) });
      return;
    }

    const service = settings.memoryService || getMemoryService();
    try {
      const input = normalizeSessionRequest(req.body || {}, req.method);
      if (req.method === 'DELETE') {
        await service.deleteSession(input.memoryToken);
        res.statusCode = 204;
        res.end();
        return;
      }

      const result = input.memoryToken
        ? await service.restoreSession(input.memoryToken)
        : await service.createSession();
      const payload = Object.assign(
        {},
        result.created ? { memoryToken: result.memoryToken } : {},
        publicMemory(result),
        { meta: meta(trace) }
      );
      sendJson(res, result.created ? 201 : 200, payload);
    } catch (error) {
      if (error instanceof RequestValidationError || error instanceof MemoryServiceError) {
        if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
        const payload = {
          error: error.message,
          code: error.code,
          meta: meta(trace)
        };
        if (error.statusCode === 503) {
          payload.memory = {
            status: service.enabled ? 'degraded' : 'disabled'
          };
        }
        sendJson(res, error.statusCode || 400, payload);
        return;
      }
      if (error instanceof MemoryStoreError) {
        sendJson(res, 503, {
          error: 'Memory service is temporarily unavailable',
          code: error.code,
          memory: { status: 'degraded' },
          meta: meta(trace)
        });
        return;
      }

      console.error('memory session failed', {
        traceId: trace.traceId,
        code: error && error.code || 'UNKNOWN'
      });
      sendJson(res, 500, { error: 'Internal server error', meta: meta(trace) });
    }
  };
}

const handler = createSessionHandler();
handler.createSessionHandler = createSessionHandler;
module.exports = handler;
