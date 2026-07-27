'use strict';

const { runAgent } = require('../agent/run');
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
  normalizeAskRequest,
  REQUEST_LIMITS,
  RequestValidationError
} = require('../memory/session');

function buildMeta(trace, values) {
  return Object.assign({}, values, {
    traceId: trace.traceId,
    timings: trace.snapshot()
  });
}

module.exports = async (req, res) => {
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

    const corpusStartedAt = trace.start();
    const corpus = loadCorpus();
    trace.end('corpusMs', corpusStartedAt);

    const payload = await runAgent(input, {
      corpus,
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion,
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
        : null
    }));

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
        citationVerification: payload.meta.citationVerification &&
          payload.meta.citationVerification.status,
        feedbackEnabled: Boolean(payload.feedback),
        timings: payload.meta.timings
      });
    }

    sendJson(res, 200, payload);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      sendJson(res, error.statusCode, {
        error: error.message,
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
