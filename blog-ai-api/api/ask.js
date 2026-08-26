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
        replayed: true
      }));
      replay.memory = publicMemoryMeta(memoryContext);
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
        console.error('LLM fallback triggered', {
          traceId: trace.traceId,
          message: error && error.message ? error.message : 'Unknown LLM error',
          apiBaseUrl: modelConfig.apiBaseUrl,
          apiPath: modelConfig.apiPath,
          model: modelConfig.model,
          hasApiKey: Boolean(modelConfig.apiKey)
        });
      }
    });

    payload.meta = buildMeta(trace, Object.assign({}, payload.meta, {
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion
        ? corpus.manifest.corpusVersion
        : null,
      memoryStatus: memoryContext.status
    }));
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
      console.info('ask.js completed', {
        traceId: trace.traceId,
        sessionPresent: Boolean(input.sessionId),
        route: payload.meta.route,
        mode: payload.meta.mode,
        citations: payload.citations.length,
        candidates: payload.meta.retrieval.candidates,
        retrievalAttempts: payload.meta.retrievalAttempts,
        modelAttempted: payload.meta.model.attempted,
        modelAnswered: payload.meta.model.answered,
        generationSchemaValid: payload.meta.model.generationSchemaValid,
        verificationAttempted: payload.meta.model.verificationAttempted,
        verificationSchemaValid: payload.meta.model.verificationSchemaValid,
        citationVerification: payload.meta.citationVerification &&
          payload.meta.citationVerification.status,
        claims: (payload.claims || []).length,
        unansweredSubquestions: (payload.unansweredSubquestions || []).length,
        subquestionCoverage: payload.meta.citationVerification &&
          payload.meta.citationVerification.subquestionCoverage,
        phase10Enabled: payload.meta.phase10 &&
          payload.meta.phase10.groundedSynthesisEnabled,
        feedbackEnabled: Boolean(payload.feedback),
        memoryStatus: payload.memory.status,
        memoryWriteStatus: payload.memory.writeStatus,
        timings: payload.meta.timings
      });
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

    console.error('ask.js failed', {
      traceId: trace.traceId,
      message: error && error.message ? error.message : 'Unknown error',
      stack: error && error.stack ? error.stack : null
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
