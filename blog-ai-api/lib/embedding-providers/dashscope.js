'use strict';

const { normalizeVector } = require('./local');

const DEFAULT_MODEL = 'qwen3.7-text-embedding';
const DEFAULT_DIMENSIONS = 1024;
const MAX_BATCH_SIZE = 20;
const FALLBACK_BATCH_SIZE = 10;
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

class EmbeddingProviderError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'EmbeddingProviderError';
    this.code = code || 'EMBEDDING_PROVIDER_ERROR';
    Object.assign(this, details || {});
  }
}

function endpointFromConfig(config) {
  const explicit = String(config.baseUrl || '').trim().replace(/\/$/, '');
  if (explicit) return explicit.endsWith('/embeddings') ? explicit : `${explicit}/embeddings`;
  const workspaceId = String(config.workspaceId || '').trim();
  if (!workspaceId) {
    throw new EmbeddingProviderError(
      'DASHSCOPE_WORKSPACE_ID or DASHSCOPE_BASE_URL is required',
      'EMBEDDING_NOT_CONFIGURED'
    );
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings`;
}

function retryDelay(attempt, retryAfter) {
  const headerDelay = Number(retryAfter);
  if (Number.isFinite(headerDelay) && headerDelay >= 0) return Math.min(30000, headerDelay * 1000);
  return Math.min(8000, 250 * (2 ** attempt));
}

function batchSizeForModel(model) {
  return String(model || '').trim() === DEFAULT_MODEL
    ? MAX_BATCH_SIZE
    : FALLBACK_BATCH_SIZE;
}

function wait(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new EmbeddingProviderError('Embedding request aborted', 'EMBEDDING_ABORTED'));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    if (signal) signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new EmbeddingProviderError('Embedding request aborted', 'EMBEDDING_ABORTED'));
    }, { once: true });
  });
}

async function requestEmbeddings(config, inputs, options) {
  if (!String(config.apiKey || '').trim()) {
    throw new EmbeddingProviderError('DASHSCOPE_API_KEY is required', 'EMBEDDING_NOT_CONFIGURED');
  }
  const maxBatchSize = batchSizeForModel(config.model);
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > maxBatchSize) {
    throw new EmbeddingProviderError(
      `DashScope ${config.model} embedding batch must contain 1-${maxBatchSize} inputs`,
      'EMBEDDING_INVALID_INPUT'
    );
  }
  const timeoutMs = Math.max(100, Number(config.timeoutMs) || 8000);
  const maxRetries = Math.max(0, Number(config.maxRetries) || 0);
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new EmbeddingProviderError('fetch is unavailable', 'EMBEDDING_NOT_CONFIGURED');
  }
  const endpoint = endpointFromConfig(config);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options && options.signal;
    const abort = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          input: inputs,
          dimensions: config.dimensions,
          encoding_format: 'float'
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        if (retryable && attempt < maxRetries) {
          await wait(retryDelay(attempt, response.headers && response.headers.get('retry-after')), externalSignal);
          continue;
        }
        const code = response.status === 429
          ? 'EMBEDDING_RATE_LIMITED'
          : `EMBEDDING_HTTP_${response.status}`;
        throw new EmbeddingProviderError(
          payload?.error?.message || `DashScope embedding HTTP ${response.status}`,
          code,
          { status: response.status, retryable }
        );
      }
      const rows = Array.isArray(payload.data) ? payload.data.slice() : [];
      rows.sort((left, right) => Number(left.index) - Number(right.index));
      if (rows.length !== inputs.length) {
        throw new EmbeddingProviderError('DashScope returned an incomplete embedding batch', 'EMBEDDING_EMPTY_VECTOR');
      }
      const vectors = rows.map(row => normalizeVector(row.embedding || []));
      if (vectors.some(vector => (
        vector.length !== config.dimensions ||
        vector.some(value => !Number.isFinite(value)) ||
        !vector.some(value => value !== 0)
      ))) {
        throw new EmbeddingProviderError('DashScope returned an invalid embedding vector', 'EMBEDDING_EMPTY_VECTOR');
      }
      return {
        vectors,
        usage: {
          promptTokens: Number(payload?.usage?.prompt_tokens) || 0,
          totalTokens: Number(payload?.usage?.total_tokens) || 0
        },
        requestId: String(payload.id || '')
      };
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      const timedOut = controller.signal.aborted && !(externalSignal && externalSignal.aborted);
      if (externalSignal && externalSignal.aborted) {
        throw new EmbeddingProviderError('Embedding request aborted', 'EMBEDDING_ABORTED');
      }
      if (attempt < maxRetries) {
        await wait(retryDelay(attempt), externalSignal);
        continue;
      }
      throw new EmbeddingProviderError(
        timedOut ? 'DashScope embedding request timed out' : 'DashScope embedding request failed',
        timedOut ? 'EMBEDDING_TIMEOUT' : 'EMBEDDING_NETWORK_ERROR',
        { cause: error }
      );
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', abort);
    }
  }
  throw new EmbeddingProviderError('DashScope embedding request failed', 'EMBEDDING_PROVIDER_ERROR');
}

function createDashScopeProvider(options) {
  const settings = options || {};
  const config = {
    apiKey: settings.apiKey,
    workspaceId: settings.workspaceId,
    baseUrl: settings.baseUrl,
    model: settings.model || DEFAULT_MODEL,
    dimensions: Number(settings.dimensions) || DEFAULT_DIMENSIONS,
    timeoutMs: Number(settings.timeoutMs) || 8000,
    maxRetries: Number.isSafeInteger(Number(settings.maxRetries)) ? Number(settings.maxRetries) : 3,
    fetchImpl: settings.fetchImpl
  };
  const maxBatchSize = batchSizeForModel(config.model);
  return Object.freeze({
    name: 'dashscope',
    model: config.model,
    dimensions: config.dimensions,
    version: 1,
    normalization: 'l2-client-v1',
    maxBatchSize,
    async embedDocuments(inputs, requestOptions) {
      return requestEmbeddings(config, inputs, requestOptions);
    },
    async embedQuery(input, requestOptions) {
      const result = await requestEmbeddings(config, [input], requestOptions);
      return result.vectors[0];
    }
  });
}

module.exports = {
  DEFAULT_DIMENSIONS,
  DEFAULT_MODEL,
  EmbeddingProviderError,
  FALLBACK_BATCH_SIZE,
  MAX_BATCH_SIZE,
  batchSizeForModel,
  createDashScopeProvider,
  endpointFromConfig,
  requestEmbeddings,
  retryDelay
};
