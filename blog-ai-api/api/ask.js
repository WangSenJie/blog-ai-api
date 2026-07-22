'use strict';

const { loadCorpus } = require('../lib/corpus');
const { canUseModel, generateAnswer, getModelConfig } = require('../lib/generate');
const { buildResponse, detectMode, rankChunks } = require('../lib/retrieve');
const { createRequestTrace } = require('../lib/trace');

function applyCors(req, res) {
  const configuredOrigins = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || 'https://wangsenjie.github.io';
  const allowedOrigins = configuredOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  allowedOrigins.push('http://localhost:4000', 'http://127.0.0.1:4000');
  const requestOrigin = req.headers.origin;

  if (!requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  } else if (allowedOrigins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Trace-Id');
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
  applyCors(req, res);
  res.setHeader('X-Trace-Id', trace.traceId);

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: 'Method not allowed',
      meta: buildMeta(trace, {})
    });
    return;
  }

  try {
    let body = req.body || {};
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body || '{}');
      } catch (error) {
        sendJson(res, 400, {
          error: 'Invalid JSON body',
          meta: buildMeta(trace, {})
        });
        return;
      }
    }

    const question = String(body.question || '').trim();
    const page = body.page || null;
    const mode = body.mode || detectMode(question);

    if (!question) {
      sendJson(res, 400, {
        error: 'Missing question',
        meta: buildMeta(trace, { mode })
      });
      return;
    }

    const corpusStartedAt = trace.start();
    const { chunks, manifest } = loadCorpus();
    trace.end('corpusMs', corpusStartedAt);

    const retrievalStartedAt = trace.start();
    const ranked = rankChunks(chunks, question, mode, page);
    trace.end('retrievalMs', retrievalStartedAt);

    const responseStartedAt = trace.start();
    const payload = buildResponse(question, ranked, page, mode);
    trace.end('buildResponseMs', responseStartedAt);
    let modelAttempted = false;
    let modelAnswered = false;

    if (payload.citations.length && canUseModel()) {
      modelAttempted = true;
      const generationStartedAt = trace.start();
      try {
        const generated = await generateAnswer(question, mode, page, payload.citations);
        if (generated) {
          payload.answer = generated;
          modelAnswered = true;
        }
      } catch (error) {
        const modelConfig = getModelConfig();
        console.error('LLM fallback triggered', {
          traceId: trace.traceId,
          message: error && error.message ? error.message : 'Unknown LLM error',
          apiBaseUrl: modelConfig.apiBaseUrl,
          apiPath: modelConfig.apiPath,
          model: modelConfig.model,
          hasApiKey: Boolean(modelConfig.apiKey)
        });
        payload.meta = Object.assign({}, payload.meta, {
          llmFallback: true
        });
      } finally {
        trace.end('generationMs', generationStartedAt);
      }
    }

    payload.meta = buildMeta(trace, Object.assign({}, payload.meta, {
      mode,
      llmFallback: modelAttempted && !modelAnswered,
      indexVersion: manifest && manifest.corpusVersion
        ? manifest.corpusVersion
        : null,
      retrieval: {
        strategy: 'bm25',
        candidates: ranked.length
      },
      model: {
        attempted: modelAttempted,
        answered: modelAnswered
      }
    }));

    if (process.env.NODE_ENV !== 'test') {
      console.info('ask.js completed', {
        traceId: trace.traceId,
        mode,
        citations: payload.citations.length,
        candidates: ranked.length,
        modelAttempted,
        modelAnswered,
        timings: payload.meta.timings
      });
    }

    sendJson(res, 200, payload);
  } catch (error) {
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
