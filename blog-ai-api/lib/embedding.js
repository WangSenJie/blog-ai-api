'use strict';

const crypto = require('crypto');
const { TOKENIZER_VERSION } = require('./tokenizer');
const {
  CONCEPT_GROUPS,
  DIMENSIONS: EMBEDDING_DIMENSIONS,
  MODEL: EMBEDDING_MODEL,
  VERSION: EMBEDDING_VERSION,
  createLocalProvider,
  embedText,
  normalizeVector
} = require('./embedding-providers/local');
const {
  DEFAULT_DIMENSIONS,
  DEFAULT_MODEL,
  EmbeddingProviderError,
  createDashScopeProvider
} = require('./embedding-providers/dashscope');

const DOCUMENT_TEMPLATE_VERSION = 'blog-document-v1';
const QUERY_TEMPLATE_VERSION = 'technical-blog-query-v1';
const QUERY_INSTRUCTION = 'Given a technical blog search query, retrieve passages that best answer it.';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function embeddingFingerprint(metadata) {
  const source = metadata || {};
  return `sha256:${sha256(stableJson({
    provider: source.provider,
    model: source.model,
    dimensions: source.dimensions,
    version: source.version,
    normalization: source.normalization,
    documentTemplateVersion: source.documentTemplateVersion,
    queryTemplateVersion: source.queryTemplateVersion,
    tokenizerVersion: source.tokenizerVersion
  }))}`;
}

function providerMetadata(provider) {
  const metadata = {
    provider: provider.name,
    model: provider.model,
    dimensions: provider.dimensions,
    version: provider.version,
    normalization: provider.normalization,
    documentTemplateVersion: DOCUMENT_TEMPLATE_VERSION,
    queryTemplateVersion: QUERY_TEMPLATE_VERSION,
    tokenizerVersion: TOKENIZER_VERSION
  };
  metadata.fingerprint = embeddingFingerprint(metadata);
  return metadata;
}

function embeddingMetadata() {
  return providerMetadata(createLocalProvider());
}

function documentInputForChunk(chunk) {
  return [
    `Title: ${String(chunk && chunk.postTitle || '').trim()}`,
    `Section: ${(chunk && chunk.headingPath || []).join(' > ')}`,
    `Type: ${String(chunk && chunk.chunkType || 'text').trim()}`,
    '',
    String(chunk && chunk.content || '').trim()
  ].join('\n').trim();
}

function queryInput(value) {
  return `Instruct: ${QUERY_INSTRUCTION}\nQuery: ${String(value || '').trim()}`;
}

function embeddingInputForChunk(chunk) {
  return documentInputForChunk(chunk);
}

function createEmbeddingProvider(options) {
  const settings = options || {};
  const provider = String(settings.provider || 'local').trim().toLowerCase();
  if (provider === 'local') return createLocalProvider(settings);
  if (provider === 'dashscope') return createDashScopeProvider(settings);
  throw new EmbeddingProviderError(`Unsupported embedding provider: ${provider}`, 'EMBEDDING_PROVIDER_UNSUPPORTED');
}

function providerFromEnvironment(options) {
  const settings = options || {};
  const provider = String(settings.provider || process.env.EMBEDDING_PROVIDER || 'local').trim().toLowerCase();
  return createEmbeddingProvider({
    provider,
    apiKey: settings.apiKey || process.env.DASHSCOPE_API_KEY,
    workspaceId: settings.workspaceId || process.env.DASHSCOPE_WORKSPACE_ID,
    baseUrl: settings.baseUrl || process.env.DASHSCOPE_BASE_URL,
    model: settings.model || process.env.EMBEDDING_MODEL || (provider === 'dashscope' ? DEFAULT_MODEL : undefined),
    dimensions: Number(settings.dimensions || process.env.EMBEDDING_DIMENSIONS) ||
      (provider === 'dashscope' ? DEFAULT_DIMENSIONS : undefined),
    timeoutMs: settings.timeoutMs || process.env.EMBEDDING_TIMEOUT_MS,
    maxRetries: settings.maxRetries ?? Number(process.env.EMBEDDING_MAX_RETRIES || 3),
    fetchImpl: settings.fetchImpl
  });
}

function providerForManifest(manifest, options) {
  const embedding = manifest && manifest.embedding;
  if (!embedding) {
    throw new EmbeddingProviderError('Embedding manifest metadata is missing', 'EMBEDDING_FINGERPRINT_MISMATCH');
  }
  const provider = providerFromEnvironment(Object.assign({}, options, {
    provider: embedding.provider,
    model: embedding.model,
    dimensions: embedding.dimensions
  }));
  const metadata = providerMetadata(provider);
  if (metadata.fingerprint !== embedding.fingerprint) {
    throw new EmbeddingProviderError('Runtime embedding fingerprint does not match the vector index', 'EMBEDDING_FINGERPRINT_MISMATCH');
  }
  return provider;
}

function embedChunk(chunk) {
  return embedText(documentInputForChunk(chunk));
}

function isFiniteVector(values, dimensions) {
  return Array.isArray(values) && values.length === dimensions && values.every(Number.isFinite);
}

function isReusableVector(record, chunk, metadata) {
  const expected = metadata || embeddingMetadata();
  return Boolean(
    record && chunk && record.id === chunk.id &&
    record.contentHash === chunk.contentHash &&
    record.fingerprint === expected.fingerprint &&
    isFiniteVector(record.values, expected.dimensions)
  );
}

function buildVectorIndex(chunks, previousVectors) {
  const provider = createLocalProvider();
  const metadata = providerMetadata(provider);
  const previousById = new Map((previousVectors || []).filter(record => record && record.id).map(record => [record.id, record]));
  const vectors = [];
  const build = { added: 0, updated: 0, reused: 0, deleted: 0, failed: 0 };
  for (const chunk of chunks || []) {
    const previous = previousById.get(chunk.id);
    if (isReusableVector(previous, chunk, metadata)) {
      vectors.push(Object.assign({}, previous, { values: previous.values.slice() }));
      build.reused += 1;
    } else {
      vectors.push({
        id: chunk.id,
        contentHash: chunk.contentHash,
        fingerprint: metadata.fingerprint,
        values: provider.embedText(documentInputForChunk(chunk))
      });
      if (previous) build.updated += 1;
      else build.added += 1;
    }
  }
  const ids = new Set((chunks || []).map(chunk => chunk.id));
  build.deleted = [...previousById.keys()].filter(id => !ids.has(id)).length;
  return { vectors, embedding: metadata, build, failures: [], usage: { promptTokens: 0, totalTokens: 0 } };
}

async function buildVectorIndexAsync(chunks, previousVectors, provider, options) {
  const settings = Object.assign({
    batchSize: Number(provider && provider.maxBatchSize) || 10,
    concurrency: 2
  }, options || {});
  const metadata = providerMetadata(provider);
  const previousById = new Map((previousVectors || []).filter(record => record && record.id).map(record => [record.id, record]));
  const vectorsById = new Map();
  const pending = [];
  const failures = [];
  const usage = { promptTokens: 0, totalTokens: 0 };
  const build = { added: 0, updated: 0, reused: 0, deleted: 0, failed: 0 };

  for (const chunk of chunks || []) {
    const previous = previousById.get(chunk.id);
    if (isReusableVector(previous, chunk, metadata)) {
      vectorsById.set(chunk.id, Object.assign({}, previous, { values: previous.values.slice() }));
      build.reused += 1;
    } else pending.push(chunk);
  }

  const batchSize = Math.max(1, Math.min(Number(provider.maxBatchSize) || 10, Number(settings.batchSize) || 10));
  const batches = [];
  for (let index = 0; index < pending.length; index += batchSize) batches.push(pending.slice(index, index + batchSize));
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      try {
        const response = await provider.embedDocuments(batch.map(documentInputForChunk), { signal: settings.signal });
        response.vectors.forEach((values, index) => {
          const chunk = batch[index];
          if (
            !isFiniteVector(values, metadata.dimensions) ||
            !values.some(value => value !== 0)
          ) {
            throw new EmbeddingProviderError('Provider returned an invalid vector', 'EMBEDDING_EMPTY_VECTOR');
          }
          vectorsById.set(chunk.id, {
            id: chunk.id,
            contentHash: chunk.contentHash,
            fingerprint: metadata.fingerprint,
            values
          });
          if (previousById.has(chunk.id)) build.updated += 1;
          else build.added += 1;
        });
        usage.promptTokens += Number(response.usage && response.usage.promptTokens) || 0;
        usage.totalTokens += Number(response.usage && response.usage.totalTokens) || 0;
      } catch (error) {
        for (const chunk of batch) failures.push({
          id: chunk.id,
          contentHash: chunk.contentHash,
          code: String(error && error.code || 'EMBEDDING_BUILD_FAILED'),
          message: String(error && error.message || 'Embedding build failed')
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Number(settings.concurrency) || 1) }, worker));
  build.failed = failures.length;
  const currentIds = new Set((chunks || []).map(chunk => chunk.id));
  build.deleted = [...previousById.keys()].filter(id => !currentIds.has(id)).length;
  return {
    vectors: (chunks || []).map(chunk => vectorsById.get(chunk.id)).filter(Boolean),
    embedding: metadata,
    build,
    failures,
    usage
  };
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return 0;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

module.exports = {
  CONCEPT_GROUPS,
  DOCUMENT_TEMPLATE_VERSION,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  EmbeddingProviderError,
  QUERY_INSTRUCTION,
  QUERY_TEMPLATE_VERSION,
  buildVectorIndex,
  buildVectorIndexAsync,
  cosineSimilarity,
  createEmbeddingProvider,
  documentInputForChunk,
  embedChunk,
  embedText,
  embeddingFingerprint,
  embeddingInputForChunk,
  embeddingMetadata,
  isFiniteVector,
  isReusableVector,
  normalizeVector,
  providerForManifest,
  providerFromEnvironment,
  providerMetadata,
  queryInput
};
