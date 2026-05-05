'use strict';

const { loadCorpus } = require('../lib/corpus');
const { canUseModel, generateAnswer, getModelConfig } = require('../lib/generate');
const { buildResponse, detectMode, rankChunks } = require('../lib/retrieve');

function applyCors(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://wangsenjie.github.io';
  const requestOrigin = req.headers.origin;

  if (!requestOrigin || requestOrigin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});
    const question = String(body.question || '').trim();
    const page = body.page || null;
    const mode = body.mode || detectMode(question);

    if (!question) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Missing question' }));
      return;
    }

    const { chunks } = loadCorpus();
    const ranked = rankChunks(chunks, question, mode, page);
    const payload = buildResponse(question, ranked, page, mode);

    if (payload.citations.length && canUseModel()) {
      try {
        const generated = await generateAnswer(question, mode, page, payload.citations);
        if (generated) {
          payload.answer = generated;
        }
      } catch (error) {
        const modelConfig = getModelConfig();
        console.error('LLM fallback triggered', {
          message: error && error.message ? error.message : 'Unknown LLM error',
          apiBaseUrl: modelConfig.apiBaseUrl,
          apiPath: modelConfig.apiPath,
          model: modelConfig.model,
          hasApiKey: Boolean(modelConfig.apiKey)
        });
        payload.meta = Object.assign({}, payload.meta, {
          llmFallback: true
        });
      }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error('ask.js failed', {
      message: error && error.message ? error.message : 'Unknown error',
      stack: error && error.stack ? error.stack : null
    });
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: error && error.message ? error.message : 'Unknown error'
    }));
  }
};
