'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { getModelConfig } = require('../lib/generate');

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
