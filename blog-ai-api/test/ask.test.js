'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../api/ask');
const { loadCorpus } = require('../lib/corpus');
const { verifyFeedbackReceipt } = require('../lib/feedback-receipt');
const { REQUEST_LIMITS } = require('../memory/session');

const MODEL_ENV_KEYS = [
  'LLM_API_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_API_PATH',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_WORKSPACE_ID',
  'DASHSCOPE_BASE_URL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'RAG_RETRIEVAL_MODE',
  'FEEDBACK_RECEIPT_SECRET',
  'FEEDBACK_REVIEW_CONTEXT_SECRET',
  'FEEDBACK_INCLUDE_REVIEW_CONTEXT',
  'FEEDBACK_WEBHOOK_URL',
  'FEEDBACK_WEBHOOK_SECRET',
  'FEEDBACK_WEBHOOK_TIMEOUT_MS'
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

test('successful ask response includes trace metadata and safe embedding fallback', async () => {
  const req = {
    method: 'POST',
    headers: {
      origin: 'http://localhost:4000',
      'content-type': 'application/json'
    },
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
  assert.deepEqual(payload.meta.model, {
    attempted: false,
    answered: false,
    accepted: false,
    rejectionReason: ''
  });
  assert.equal(payload.meta.llmFallback, false);
  assert.ok(payload.citations.length > 0);
  assert.ok(payload.claims.length > 0);
  assert.equal(payload.meta.citationVerification.status, 'verified');
  assert.equal(payload.meta.citationVerification.citationCompleteness, 1);
  assert.equal(typeof payload.citations[0].chunkId, 'string');
  assert.equal(typeof payload.citations[0].section, 'string');

  for (const value of Object.values(payload.meta.timings)) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0);
  }
});

test('ask returns a signed feedback receipt only for a configured collection', async () => {
  const receiptSecret = 'ask-feedback-receipt-secret-for-tests-1234';
  const webhookSecret = 'ask-feedback-webhook-secret-for-tests-1234';
  const question = '双塔模型如何用于线上召回？';
  process.env.FEEDBACK_RECEIPT_SECRET = receiptSecret;
  process.env.FEEDBACK_WEBHOOK_URL = 'https://feedback.example.test/collect';
  process.env.FEEDBACK_WEBHOOK_SECRET = webhookSecret;

  try {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { question }
    }, res);
    const payload = parseBody(res);
    const receiptPayload = JSON.parse(Buffer.from(
      payload.feedback.receipt.split('.')[1],
      'base64url'
    ).toString('utf8'));
    const receipt = verifyFeedbackReceipt(payload.feedback.receipt, {
      secret: receiptSecret
    });

    assert.equal(res.statusCode, 200);
    assert.ok(payload.feedback);
    assert.match(payload.feedback.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.hasOwn(receiptPayload, 'reviewContext'), false);
    assert.equal(JSON.stringify(receiptPayload).includes(question), false);
    assert.equal(receipt.traceId, payload.meta.traceId);
    assert.equal(receipt.reviewQuestion, '');
  } finally {
    delete process.env.FEEDBACK_RECEIPT_SECRET;
    delete process.env.FEEDBACK_WEBHOOK_URL;
    delete process.env.FEEDBACK_WEBHOOK_SECRET;
  }
});

test('messages API resolves a trusted multi-turn reference and exposes Agent metadata', async () => {
  const corpus = loadCorpus();
  const towerChunk = corpus.chunks.find(chunk => chunk.postTitle === '双塔模型');
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'session_api_multiturn',
      messages: [
        { role: 'user', content: '什么是双塔模型？' },
        {
          role: 'assistant',
          content: '双塔模型由两个塔组成。',
          citations: [{
            chunkId: towerChunk.id,
            title: '客户端伪造标题',
            url: towerChunk.postUrl
          }],
          indexVersion: corpus.manifest.corpusVersion,
          standaloneQuery: '双塔模型'
        },
        { role: 'user', content: '它如何用于线上召回？' }
      ]
    }
  };
  const res = makeResponse();

  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 200);
  assert.equal(payload.meta.sessionId, 'session_api_multiturn');
  assert.equal(payload.meta.route, 'site_qa');
  assert.match(payload.meta.standaloneQuery, /双塔模型/);
  assert.ok(payload.meta.retrievalAttempts <= 2);
  assert.equal(payload.meta.evidenceGrading, 'calibrated_structural_v1');
  assert.equal(payload.meta.evidenceCalibration.version, 'phase4-v1');
  assert.ok(payload.meta.toolCalls.some(call => call.name === 'search_blog'));
  assert.ok(payload.citations.some(citation => citation.title === '双塔模型'));
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'messages'), false);
});

test('successful structured model generation is traced and citation-verified', async () => {
  const originalFetch = global.fetch;
  process.env.LLM_API_BASE_URL = 'https://model.invalid/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://model.invalid/v1/chat/completions');
    assert.ok(options.signal);
    const request = JSON.parse(options.body);
    const prompt = request.messages[1].content;
    const chunkId = prompt.match(/chunkId: ([^\n]+)/)[1].trim();
    const evidence = prompt.match(/正文:\n([\s\S]*?)\n<\/evidence>/)[1]
      .trim();
    const quote = evidence.split(/[。！？\n]+/)
      .find(sentence => sentence.trim().length >= 6)
      .trim();
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                claims: [{
                  text: quote,
                  citationIds: [chunkId],
                  quote
                }]
              })
            }
          }]
        };
      }
    };
  };

  try {
    const res = makeResponse();
    await handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { question: '双塔模型' }
    }, res);
    const payload = parseBody(res);

    assert.equal(res.statusCode, 200);
    assert.match(payload.answer, /\[1\]/);
    assert.deepEqual(payload.meta.model, {
      attempted: true,
      answered: true,
      accepted: true,
      rejectionReason: ''
    });
    assert.equal(payload.meta.llmFallback, false);
    assert.equal(payload.meta.citationVerification.status, 'verified');
    assert.equal(payload.meta.citationVerification.source, 'model');
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
      headers: { 'content-type': 'application/json' },
      body: { question: '双塔模型' }
    }, res);
    const payload = parseBody(res);

    assert.equal(res.statusCode, 200);
    assert.match(payload.answer, /双塔模型/);
    assert.deepEqual(payload.meta.model, {
      attempted: true,
      answered: false,
      accepted: false,
      rejectionReason: ''
    });
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
    headers: { 'content-type': 'application/json' },
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

test('declared request bodies above the wire-size limit return 413 before parsing', async () => {
  const res = makeResponse();
  await handler({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(REQUEST_LIMITS.maxBodyBytes + 1)
    },
    body: { question: '双塔模型' }
  }, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 413);
  assert.equal(payload.error, 'Request body is too large');
  assert.match(payload.meta.traceId, /^trace_/);
});

test('missing questions and unsupported methods return trace metadata', async () => {
  const missingQuestionResponse = makeResponse();
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {}
  }, missingQuestionResponse);
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

test('disallowed browser origins and simple text requests are rejected', async () => {
  const disallowedOriginResponse = makeResponse();
  await handler({
    method: 'POST',
    headers: {
      origin: 'https://attacker.example',
      'content-type': 'application/json'
    },
    body: { question: '双塔模型' }
  }, disallowedOriginResponse);
  const disallowedOriginPayload = parseBody(disallowedOriginResponse);

  assert.equal(disallowedOriginResponse.statusCode, 403);
  assert.equal(disallowedOriginPayload.error, 'Origin is not allowed');
  assert.equal(
    disallowedOriginResponse.getHeader('access-control-allow-origin'),
    undefined
  );

  const textRequestResponse = makeResponse();
  await handler({
    method: 'POST',
    headers: {
      origin: 'http://localhost:4000',
      'content-type': 'text/plain'
    },
    body: JSON.stringify({ question: '双塔模型' })
  }, textRequestResponse);
  const textRequestPayload = parseBody(textRequestResponse);

  assert.equal(textRequestResponse.statusCode, 415);
  assert.equal(
    textRequestPayload.error,
    'Content-Type must be application/json'
  );
});
