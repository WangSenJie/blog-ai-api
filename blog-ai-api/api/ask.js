'use strict';

const { runAgent } = require('../agent/run');
const { loadCorpus } = require('../lib/corpus');
const { getModelConfig } = require('../lib/generate');
const { createRequestTrace } = require('../lib/trace');
const {
  normalizeAskRequest,
  REQUEST_LIMITS,
  RequestValidationError
} = require('../memory/session');

function applyCors(req, res) {
  const configuredOrigins = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || 'https://wangsenjie.github.io';
  const allowedOrigins = configuredOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  allowedOrigins.push('http://localhost:4000', 'http://127.0.0.1:4000');
  const requestOrigin = req.headers && req.headers.origin;
  const originAllowed = !requestOrigin || allowedOrigins.includes(requestOrigin);

  if (!requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  } else if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Trace-Id');
  return originAllowed;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

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

  const contentType = String(
    req.headers && req.headers['content-type'] || ''
  ).split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendJson(res, 415, {
      error: 'Content-Type must be application/json',
      meta: buildMeta(trace, {})
    });
    return;
  }

  const contentLength = Number(
    req.headers && req.headers['content-length']
  );
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

    if (process.env.NODE_ENV !== 'test') {
      console.info('ask.js completed', {
        traceId: trace.traceId,
        sessionId: input.sessionId,
        route: payload.meta.route,
        mode: payload.meta.mode,
        citations: payload.citations.length,
        candidates: payload.meta.retrieval.candidates,
        retrievalAttempts: payload.meta.retrievalAttempts,
        modelAttempted: payload.meta.model.attempted,
        modelAnswered: payload.meta.model.answered,
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
