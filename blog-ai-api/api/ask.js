'use strict';

const {
  INTERNAL_MEMORY_DELTA,
  runAgent
} = require('../agent/run');
const { loadCorpus } = require('../lib/corpus');
const { getModelConfig } = require('../lib/generate');
const { issueFeedbackReceipt } = require('../lib/feedback-receipt');
const { feedbackCollectionConfigured } = require('../lib/feedback-sink');
const {
  applyCors,
  contentType,
  declaredContentLength,
  sendJson
} = require('../lib/http');
const {
  buildAskMetrics,
  emitOperationalEvent,
  safeErrorCode
} = require('../lib/observability');
const { publicReleaseFlags } = require('../lib/release-flags');
const { createRequestTrace } = require('../lib/trace');
const {
  MemoryServiceError,
  getMemoryService
} = require('../memory/service');
const {
  normalizeAskRequest,
  REQUEST_LIMITS,
  RequestValidationError,
  trimConversation
} = require('../memory/session');

function buildMeta(trace, values) {
  return Object.assign({}, values, {
    traceId: trace.traceId,
    timings: trace.snapshot()
  });
}

function publicMemoryMeta(context) {
  const source = context || {};
  const result = {
    status: source.status || 'disabled',
    writeStatus: source.writeStatus || 'not_attempted'
  };
  if (source.reason) result.reason = source.reason;
  if (source.threadId) result.threadId = source.threadId;
  if (source.version) result.version = source.version;
  if (source.expiresAt) result.expiresAt = source.expiresAt;
  if (source.replayed !== undefined) result.replayed = source.replayed;
  return result;
}

function trustedConversation(context, question) {
  if (!context || context.status !== 'active') return null;
  return trimConversation((context.trustedMessages || []).concat([{
    role: 'user',
    content: question
  }]));
}

function createAskHandler(options) {
  const settings = options || {};
  const executeAgent = settings.runAgent || runAgent;
  const logger = settings.logger || console;

  return async (req, res) => {
  const trace = createRequestTrace();
  const originAllowed = applyCors(req, res);
  res.setHeader('X-Trace-Id', trace.traceId);

  if (req.method === 'OPTIONS') {
    if (!originAllowed) {
      sendJson(res, 403, {
        error: 'Origin is not allowed',
        meta: buildMeta(trace, {})
      });
    } else {
      res.statusCode = 200;
      res.end();
    }
    return;
  }

  if (!originAllowed) {
    sendJson(res, 403, {
      error: 'Origin is not allowed',
      meta: buildMeta(trace, {})
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'Method not allowed',
      meta: buildMeta(trace, {})
    });
    return;
  }

  if (contentType(req) !== 'application/json') {
    sendJson(res, 415, {
      error: 'Content-Type must be application/json',
      meta: buildMeta(trace, {})
    });
    return;
  }

  const contentLength = declaredContentLength(req);
  if (
    Number.isFinite(contentLength) &&
    contentLength > REQUEST_LIMITS.maxBodyBytes
  ) {
    sendJson(res, 413, {
      error: 'Request body is too large',
      meta: buildMeta(trace, {})
    });
    return;
  }

  try {
    const input = normalizeAskRequest(req.body || {});
    const memoryService = settings.memoryService || getMemoryService();
    const memoryContext = await memoryService.prepareAsk(input);

    if (memoryContext.replayed && memoryContext.responseSnapshot) {
      const replay = clonePayload(memoryContext.responseSnapshot);
      replay.meta = buildMeta(trace, Object.assign({}, replay.meta, {
        replayed: true,
        releaseFlags: publicReleaseFlags()
      }));
      replay.memory = publicMemoryMeta(memoryContext);
      if (process.env.NODE_ENV !== 'test') {
        emitOperationalEvent(
          logger,
          'ask.completed.v1',
          buildAskMetrics(replay, {
            releaseFlags: replay.meta.releaseFlags
          })
        );
      }
      sendJson(res, 200, replay);
      return;
    }

    const storedConversation = trustedConversation(memoryContext, input.question);
    if (storedConversation) input.messages = storedConversation;
    if (memoryContext.status === 'active' && memoryContext.trustedMemory) {
      input.trustedMemory = memoryContext.trustedMemory;
    }

    const corpusStartedAt = trace.start();
    const corpus = loadCorpus();
    trace.end('corpusMs', corpusStartedAt);

    const payload = await executeAgent(input, {
      corpus,
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion,
      rolloutKey: memoryContext.tokenDigest || input.requestId || input.sessionId,
      trace,
      onModelError(error) {
        const modelConfig = getModelConfig();
        logger.error('model.fallback.v1', {
          traceId: trace.traceId,
          code: safeErrorCode(error, 'MODEL_REQUEST_FAILED'),
          model: modelConfig.model,
          providerConfigured: Boolean(modelConfig.apiBaseUrl && modelConfig.apiKey)
        });
      }
    });

    payload.meta = buildMeta(trace, Object.assign({}, payload.meta, {
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion
        ? corpus.manifest.corpusVersion
        : null,
      memoryStatus: memoryContext.status
    }));
    payload.meta.releaseFlags = publicReleaseFlags();
    payload.memory = publicMemoryMeta(memoryContext);

    if (feedbackCollectionConfigured()) {
      const feedback = issueFeedbackReceipt({
        traceId: trace.traceId,
        indexVersion: payload.meta.indexVersion,
        route: payload.meta.route,
        evidenceStatus: payload.meta.evidenceStatus,
        verificationStatus: payload.meta.citationVerification &&
          payload.meta.citationVerification.status,
        retrievalStrategy: payload.meta.retrieval && payload.meta.retrieval.strategy,
        citationChunkIds: payload.citations.map(citation => citation.chunkId),
        modelAnswered: payload.meta.model && payload.meta.model.answered,
        answer: payload.answer,
        reviewQuestion: input.question
      });
      if (feedback) payload.feedback = feedback;
    }

    const memoryResult = await memoryService.completeAsk(
      memoryContext,
      input,
      payload,
      payload[INTERNAL_MEMORY_DELTA]
    );
    payload.memory = publicMemoryMeta(memoryResult);

    if (process.env.NODE_ENV !== 'test') {
      emitOperationalEvent(
        logger,
        'ask.completed.v1',
        buildAskMetrics(payload, {
          releaseFlags: payload.meta.releaseFlags
        })
      );
    }

    sendJson(res, 200, payload);
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof MemoryServiceError) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      sendJson(res, error.statusCode, {
        error: error.message,
        code: error.code,
        meta: buildMeta(trace, {})
      });
      return;
    }

    logger.error('ask.failed.v1', {
      traceId: trace.traceId,
      code: safeErrorCode(error, 'ASK_INTERNAL_ERROR')
    });
    sendJson(res, 500, {
      error: 'Internal server error',
      meta: buildMeta(trace, {})
    });
  }
  };
}

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

const handler = createAskHandler();
handler.createAskHandler = createAskHandler;
module.exports = handler;
