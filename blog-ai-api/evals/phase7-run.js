'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { loadCorpus } = require('../lib/corpus');
const {
  createDashScopeProvider
} = require('../lib/embedding-providers/dashscope');
const {
  hybridRankChunksAsync
} = require('../lib/hybrid-retrieve');
const {
  providerMetadata
} = require('../lib/embedding');
const {
  PROFILE_CHUNKING
} = require('../../scripts/rag-chunk-profiles');
const {
  buildPhase2Report
} = require('./hybrid-run');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase7.json');
const HYBRID_DATASET_PATH = path.join(__dirname, 'hybrid-dataset.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function matchingVectorCount(corpus) {
  const chunksById = new Map(corpus.chunks.map(chunk => [chunk.id, chunk]));
  return corpus.vectors.filter(vector => {
    const chunk = chunksById.get(vector && vector.id);
    return chunk &&
      vector.contentHash === chunk.contentHash &&
      vector.fingerprint === corpus.manifest.embedding.fingerprint &&
      Array.isArray(vector.values) &&
      vector.values.length === corpus.manifest.embedding.dimensions &&
      vector.values.every(Number.isFinite);
  }).length;
}

function auditChunks(corpus) {
  const ids = new Set(corpus.chunks.map(chunk => chunk.id));
  const invalidCodeContexts = [];
  for (const block of corpus.codeBlocks || []) {
    for (const chunkId of block.contextChunkIds || []) {
      const chunk = corpus.chunks.find(candidate => candidate.id === chunkId);
      if (!ids.has(chunkId) || !chunk || chunk.chunkType === 'code') {
        invalidCodeContexts.push({ blockId: block.id, chunkId });
      }
    }
  }
  const overBudgetWithoutReason = corpus.chunks.filter(chunk => {
    const limit = PROFILE_CHUNKING[chunk.profile] &&
      PROFILE_CHUNKING[chunk.profile].maxTokens;
    return limit && chunk.tokenCount > limit && !chunk.overflowReason;
  });
  const invalidHierarchy = corpus.chunks.filter(chunk => (
    !/^chunk_[a-f0-9]{24}$/.test(String(chunk.id || '')) ||
    !/^parent_[a-f0-9]{24}$/.test(String(chunk.parentId || '')) ||
    !Number.isSafeInteger(chunk.childOrdinal) ||
    chunk.childOrdinal < 0 ||
    !String(chunk.chunkType || '').trim() ||
    !Number.isSafeInteger(chunk.tokenCount) ||
    chunk.tokenCount < 1 ||
    !chunk.sourceLines && chunk.metadataOnly !== true
  ));
  const parentIds = new Set(corpus.chunks.map(chunk => chunk.parentId));

  return {
    parents: parentIds.size,
    children: corpus.chunks.length,
    chunkTypes: corpus.manifest.ingestion.stats.chunkTypeCounts,
    overflowChunks: corpus.chunks.filter(chunk => chunk.overflowReason).length,
    invalidHierarchy: invalidHierarchy.map(chunk => chunk.id),
    overBudgetWithoutReason: overBudgetWithoutReason.map(chunk => chunk.id),
    invalidCodeContexts,
    passed: invalidHierarchy.length === 0 &&
      overBudgetWithoutReason.length === 0 &&
      invalidCodeContexts.length === 0
  };
}

function fakeProviderForManifest(manifest, embedQuery) {
  const embedding = manifest.embedding;
  return {
    name: embedding.provider,
    model: embedding.model,
    dimensions: embedding.dimensions,
    version: embedding.version,
    normalization: embedding.normalization,
    maxBatchSize: 10,
    embedQuery
  };
}

async function auditFallbacks(corpus) {
  const question = '双塔模型的用户塔和物品塔';
  const rateLimited = fakeProviderForManifest(corpus.manifest, async () => {
    const error = new Error('simulated rate limit');
    error.code = 'EMBEDDING_RATE_LIMITED';
    throw error;
  });
  const empty = fakeProviderForManifest(corpus.manifest, async () => (
    Array(corpus.manifest.embedding.dimensions).fill(0)
  ));
  const [rateResult, emptyResult, flagResult] = await Promise.all([
    hybridRankChunksAsync(corpus.chunks, corpus.vectors, question, 'site', null, {
      manifest: corpus.manifest,
      provider: rateLimited
    }),
    hybridRankChunksAsync(corpus.chunks, corpus.vectors, question, 'site', null, {
      manifest: corpus.manifest,
      provider: empty
    }),
    hybridRankChunksAsync(corpus.chunks, corpus.vectors, question, 'site', null, {
      manifest: corpus.manifest,
      retrievalMode: 'bm25'
    })
  ]);
  const cases = {
    rateLimited: rateResult.stats.fallback === 'embedding_rate_limited' &&
      rateResult.strategy === 'bm25' && rateResult.ranked.length > 0,
    emptyVector: emptyResult.stats.fallback === 'empty_query_vector' &&
      emptyResult.strategy === 'bm25' && emptyResult.ranked.length > 0,
    featureFlag: flagResult.stats.fallback === 'bm25_feature_flag' &&
      flagResult.strategy === 'bm25' && flagResult.ranked.length > 0
  };
  return { cases, passed: Object.values(cases).every(Boolean) };
}

function managedEmbeddingStatus(corpus, environment) {
  const source = environment || process.env;
  const desired = providerMetadata(createDashScopeProvider({}));
  const configured = Boolean(
    String(source.DASHSCOPE_API_KEY || '').trim() &&
    (String(source.DASHSCOPE_WORKSPACE_ID || '').trim() ||
      String(source.DASHSCOPE_BASE_URL || '').trim())
  );
  const active = corpus.manifest.embedding.provider === desired.provider &&
    corpus.manifest.embedding.model === desired.model &&
    corpus.manifest.embedding.dimensions === desired.dimensions &&
    corpus.manifest.embedding.fingerprint === desired.fingerprint &&
    corpus.vectors.length === corpus.chunks.length;
  return {
    target: desired,
    configured,
    active,
    status: active
      ? 'active'
      : configured
        ? 'credentials_configured_build_required'
        : 'pending_credentials_and_managed_build',
    command: 'npm run build:embeddings'
  };
}

async function buildPhase7Report(corpus, options) {
  const activeCorpus = corpus || loadCorpus();
  const settings = options || {};
  const chunkAudit = auditChunks(activeCorpus);
  const matchedVectors = matchingVectorCount(activeCorpus);
  const vectorCoverage = ratio(matchedVectors, activeCorpus.chunks.length);
  const browserVectorPath = path.join(REPOSITORY_ROOT, 'source', 'ai-data', 'vectors.json');
  const browserManifest = readJson(path.join(REPOSITORY_ROOT, 'source', 'ai-data', 'manifest.json'));
  const browserBoundary = {
    vectorsPublished: fs.existsSync(browserVectorPath),
    manifestHasVectors: Boolean(browserManifest.files && browserManifest.files.vectors),
    manifestHasEmbedding: Boolean(browserManifest.embedding),
    passed: !fs.existsSync(browserVectorPath) &&
      !(browserManifest.files && browserManifest.files.vectors) &&
      !browserManifest.embedding
  };
  const fallbackAudit = await auditFallbacks(activeCorpus);
  const hybrid = buildPhase2Report(
    readJson(HYBRID_DATASET_PATH),
    activeCorpus,
    { datasetPath: HYBRID_DATASET_PATH }
  );
  const managedEmbedding = managedEmbeddingStatus(
    activeCorpus,
    settings.environment
  );
  const checks = {
    chunkV2: activeCorpus.manifest.ingestion?.chunkSchema?.active === 'chunk-v2' &&
      chunkAudit.passed,
    vectorCoverage: vectorCoverage === 1,
    fingerprintCoverage: matchedVectors === activeCorpus.vectors.length,
    hybridRegression: hybrid.acceptance.passed &&
      hybrid.hybrid.summary.recallAt5 >= 0.9 &&
      hybrid.hybrid.summary.mrrAt20 >= 0.8,
    fallbackAvailability: fallbackAudit.passed,
    browserBoundary: browserBoundary.passed,
    rollbackSwitch: activeCorpus.manifest.ingestion?.chunkSchema?.switch === 'RAG_CHUNK_SCHEMA' &&
      activeCorpus.manifest.ingestion?.chunkSchema?.rollbackMode === 'legacy-v3'
  };
  const implementationPassed = Object.values(checks).every(Boolean);

  return {
    phase: 7,
    generatedAt: new Date().toISOString(),
    strategy: 'chunk-v2-managed-embedding-hybrid-rrf',
    corpus: {
      version: activeCorpus.manifest.corpusVersion,
      posts: activeCorpus.posts.length,
      chunks: activeCorpus.chunks.length,
      vectors: activeCorpus.vectors.length,
      vectorCoverage,
      activeEmbedding: activeCorpus.manifest.embedding
    },
    chunkAudit,
    browserBoundary,
    fallbackAudit,
    quality: {
      proxy: 'local-semantic-hash regression suite',
      thresholds: {
        recallAt5: 0.9,
        mrrAt20: 0.8,
        exactNoRegression: true,
        semanticImproved: true
      },
      acceptance: hybrid.acceptance,
      summary: hybrid.hybrid.summary,
      comparison: hybrid.comparison
    },
    managedEmbedding,
    acceptance: {
      checks,
      implementationPassed,
      managedIndexActive: managedEmbedding.active,
      releaseReady: implementationPassed && managedEmbedding.active,
      status: implementationPassed
        ? managedEmbedding.active
          ? 'passed'
          : 'implementation_passed_managed_validation_pending'
        : 'failed'
    }
  };
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  return {
    outputPath: outputIndex >= 0 && argv[outputIndex + 1]
      ? path.resolve(argv[outputIndex + 1])
      : DEFAULT_OUTPUT_PATH
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildPhase7Report(loadCorpus());
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 7: chunks=${report.corpus.chunks} vectors=${report.corpus.vectors} ` +
    `coverage=${report.corpus.vectorCoverage} implementation=` +
    `${report.acceptance.implementationPassed ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `Managed embedding=${report.managedEmbedding.status} ` +
    `releaseReady=${report.acceptance.releaseReady ? 'YES' : 'NO'}`
  );
  console.log(`Report written to ${options.outputPath}`);
  if (!report.acceptance.implementationPassed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  auditChunks,
  auditFallbacks,
  buildPhase7Report,
  managedEmbeddingStatus,
  matchingVectorCount,
  parseArgs
};
