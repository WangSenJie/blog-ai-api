'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  generateGroundedV2Answer,
  getModelConfig,
  getModelDiagnostic
} = require('../lib/generate');

async function withMockedModel(fetchImplementation, operation) {
  const originalFetch = global.fetch;
  const originalEnvironment = {
    LLM_API_BASE_URL: process.env.LLM_API_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL
  };
  process.env.LLM_API_BASE_URL = 'https://model.invalid/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
  global.fetch = fetchImplementation;
  try {
    return await operation();
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('model timeout uses a bounded default and clamps configured values', () => {
  const originalTimeout = process.env.LLM_TIMEOUT_MS;

  try {
    delete process.env.LLM_TIMEOUT_MS;
    assert.equal(getModelConfig().timeoutMs, 15000);

    process.env.LLM_TIMEOUT_MS = '50';
    assert.equal(getModelConfig().timeoutMs, 1000);

    process.env.LLM_TIMEOUT_MS = '120000';
    assert.equal(getModelConfig().timeoutMs, 60000);

    process.env.LLM_TIMEOUT_MS = 'not-a-number';
    assert.equal(getModelConfig().timeoutMs, 15000);
  } finally {
    if (originalTimeout === undefined) {
      delete process.env.LLM_TIMEOUT_MS;
    } else {
      process.env.LLM_TIMEOUT_MS = originalTimeout;
    }
  }
});

test('model output tokens use a bounded default and clamp configured values', () => {
  const originalValue = process.env.LLM_MAX_OUTPUT_TOKENS;

  try {
    delete process.env.LLM_MAX_OUTPUT_TOKENS;
    assert.equal(getModelConfig().maxOutputTokens, 700);

    process.env.LLM_MAX_OUTPUT_TOKENS = '20';
    assert.equal(getModelConfig().maxOutputTokens, 128);

    process.env.LLM_MAX_OUTPUT_TOKENS = '5000';
    assert.equal(getModelConfig().maxOutputTokens, 1200);
  } finally {
    if (originalValue === undefined) {
      delete process.env.LLM_MAX_OUTPUT_TOKENS;
    } else {
      process.env.LLM_MAX_OUTPUT_TOKENS = originalValue;
    }
  }
});

test('phase 10 generation requests deterministic compact JSON and records safe diagnostics', async () => {
  let requestBody;
  const result = await withMockedModel(async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                claims: [],
                unansweredSubquestions: ['sq_1']
              })
            }
          }]
        };
      }
    };
  }, () => generateGroundedV2Answer({
    question: '站内证据足够吗？',
    subquestions: [{ id: 'sq_1', question: '站内证据足够吗？' }],
    evidence: []
  }));

  assert.equal(requestBody.temperature, 0);
  assert.equal(requestBody.response_format.type, 'json_object');
  assert.doesNotMatch(requestBody.messages[1].content, /draftAnswer/);
  assert.deepEqual(result, {
    claims: [],
    unansweredSubquestions: ['sq_1']
  });
  const diagnostic = getModelDiagnostic(result);
  assert.equal(diagnostic.errorCode, '');
  assert.equal(diagnostic.finishReason, 'stop');
  assert.ok(diagnostic.contentChars > 0);
  assert.equal(JSON.stringify(result).includes('finishReason'), false);
});

test('phase 10 generation distinguishes invalid JSON from an invalid schema', async () => {
  await assert.rejects(
    withMockedModel(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: 'length',
            message: { content: '{"claims":' }
          }]
        };
      }
    }), () => generateGroundedV2Answer({ question: '测试', evidence: [] })),
    error => error &&
      error.code === 'provider_invalid_json' &&
      error.modelDiagnostic.finishReason === 'length' &&
      error.modelDiagnostic.contentChars === 10
  );

  await assert.rejects(
    withMockedModel(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: 'stop',
            message: { content: '{"claims":[{"id":"claim_1"}]}' }
          }]
        };
      }
    }), () => generateGroundedV2Answer({ question: '测试', evidence: [] })),
    error => error &&
      error.code === 'invalid_generation_schema' &&
      error.modelDiagnostic.finishReason === 'stop'
  );
});
