'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../api/ask');

const MODEL_ENV_KEYS = [
  'LLM_API_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_API_PATH'
];
const savedEnvironment = {};

function makeResponse() {
  const headers = new Map();

  return {
    statusCode: 0,
    body: '',
    ended: false,

    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },

    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },

    end(value) {
      this.body = value === undefined ? '' : String(value);
      this.ended = true;
    }
  };
}

function parseBody(res) {
  return JSON.parse(res.body);
}

test.before(() => {
  savedEnvironment.NODE_ENV = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  for (const key of MODEL_ENV_KEYS) {
    savedEnvironment[key] = process.env[key];
    delete process.env[key];
  }
});

test.after(() => {
  if (savedEnvironment.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = savedEnvironment.NODE_ENV;
  }

  for (const key of MODEL_ENV_KEYS) {
    if (savedEnvironment[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnvironment[key];
    }
  }
});

test('successful ask response includes trace metadata and retrieval timings', async () => {
  const req = {
    method: 'POST',
    headers: { origin: 'http://localhost:4000' },
    body: { question: '双塔模型' }
  };
  const res = makeResponse();

  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('x-trace-id'), payload.meta.traceId);
  assert.equal(res.getHeader('access-control-expose-headers'), 'X-Trace-Id');
  assert.equal(payload.meta.mode, 'site');
  assert.match(payload.meta.indexVersion, /^[a-f0-9]{64}$/);
  assert.equal(payload.meta.retrieval.strategy, 'bm25');
  assert.ok(payload.meta.retrieval.candidates > 0);
  assert.deepEqual(payload.meta.model, { attempted: false, answered: false });
  assert.equal(payload.meta.llmFallback, false);
  assert.ok(payload.citations.length > 0);
  assert.equal(typeof payload.citations[0].chunkId, 'string');
  assert.equal(typeof payload.citations[0].section, 'string');

  for (const value of Object.values(payload.meta.timings)) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0);
  }
});

test('successful model generation is traced without changing citations', async () => {
  const originalFetch = global.fetch;
  process.env.LLM_API_BASE_URL = 'https://model.invalid/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://model.invalid/v1/chat/completions');
    assert.ok(options.signal);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: '这是模型基于引用生成的回答。' } }]
        };
      }
    };
  };

  try {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: { question: '双塔模型' }
    }, res);
    const payload = parseBody(res);

    assert.equal(res.statusCode, 200);
    assert.equal(payload.answer, '这是模型基于引用生成的回答。');
    assert.deepEqual(payload.meta.model, { attempted: true, answered: true });
    assert.equal(payload.meta.llmFallback, false);
    assert.ok(Number.isFinite(payload.meta.timings.generationMs));
    assert.ok(payload.citations.length > 0);
  } finally {
    global.fetch = originalFetch;
    delete process.env.LLM_API_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
  }
});

test('model failures keep the retrieval answer and set fallback metadata', async () => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  process.env.LLM_API_BASE_URL = 'https://model.invalid/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
  global.fetch = async () => {
    throw new Error('simulated provider failure');
  };
  console.error = () => {};

  try {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: {},
      body: { question: '双塔模型' }
    }, res);
    const payload = parseBody(res);

    assert.equal(res.statusCode, 200);
    assert.match(payload.answer, /双塔模型/);
    assert.deepEqual(payload.meta.model, { attempted: true, answered: false });
    assert.equal(payload.meta.llmFallback, true);
    assert.ok(Number.isFinite(payload.meta.timings.generationMs));
    assert.ok(payload.citations.length > 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
    delete process.env.LLM_API_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
  }
});

test('invalid JSON returns a traceable 400 without exposing parser details', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: '{not-json'
  };
  const res = makeResponse();

  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 400);
  assert.equal(payload.error, 'Invalid JSON body');
  assert.equal(res.getHeader('x-trace-id'), payload.meta.traceId);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'message'), false);
});

test('missing questions and unsupported methods return trace metadata', async () => {
  const missingQuestionResponse = makeResponse();
  await handler({ method: 'POST', headers: {}, body: {} }, missingQuestionResponse);
  const missingQuestionPayload = parseBody(missingQuestionResponse);

  assert.equal(missingQuestionResponse.statusCode, 400);
  assert.equal(missingQuestionPayload.error, 'Missing question');
  assert.match(missingQuestionPayload.meta.traceId, /^trace_/);

  const methodResponse = makeResponse();
  await handler({ method: 'GET', headers: {} }, methodResponse);
  const methodPayload = parseBody(methodResponse);

  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodPayload.error, 'Method not allowed');
  assert.match(methodPayload.meta.traceId, /^trace_/);
});
