'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildVectorIndexAsync,
  providerFromEnvironment,
  providerMetadata
} = require('../blog-ai-api/lib/embedding');
const {
  buildManifest,
  serializeJson,
  validateCorpusData,
  verifyManifestFiles
} = require('../blog-ai-api/lib/corpus-integrity');

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const reportPath = path.join(dataDir, 'embedding-build-report.json');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function writeReport(report) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function atomicWrite(name, value) {
  const target = path.join(dataDir, name);
  const temporary = `${target}.next-${process.pid}`;
  fs.writeFileSync(temporary, serializeJson(value), 'utf8');
  fs.renameSync(temporary, target);
}

async function main() {
  const startedAt = Date.now();
  const posts = readJson('posts.json');
  const chunks = readJson('chunks.json');
  const vectors = readJson('vectors.json');
  const codeBlocks = readJson('code-blocks.json');
  const learningGraph = readJson('learning-graph.json');
  const currentManifest = readJson('manifest.json');

  verifyManifestFiles(currentManifest, {
    postsPath: path.join(dataDir, 'posts.json'),
    chunksPath: path.join(dataDir, 'chunks.json'),
    vectorsPath: path.join(dataDir, 'vectors.json'),
    codeBlocksPath: path.join(dataDir, 'code-blocks.json'),
    learningGraphPath: path.join(dataDir, 'learning-graph.json')
  });
  validateCorpusData(posts, chunks, currentManifest, vectors, { codeBlocks, learningGraph });

  const provider = providerFromEnvironment({
    provider: process.env.EMBEDDING_PROVIDER || 'dashscope'
  });
  const metadata = providerMetadata(provider);
  console.log(`Building ${chunks.length} embeddings with ${metadata.provider}/${metadata.model} (${metadata.dimensions}d)`);

  const result = await buildVectorIndexAsync(chunks, vectors, provider, {
    batchSize: Number(process.env.EMBEDDING_BATCH_SIZE) || provider.maxBatchSize || 10,
    concurrency: Number(process.env.EMBEDDING_CONCURRENCY) || 2
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: result.failures.length ? 'failed' : 'passed',
    published: false,
    embedding: metadata,
    chunks: chunks.length,
    vectors: result.vectors.length,
    coverage: chunks.length ? result.vectors.length / chunks.length : 1,
    build: result.build,
    usage: result.usage,
    durationMs: Date.now() - startedAt,
    failures: result.failures
  };
  if (result.failures.length || result.vectors.length !== chunks.length) {
    writeReport(report);
    throw new Error(`Embedding build incomplete; kept current index and wrote ${reportPath}`);
  }

  const stats = currentManifest.stats || {};
  const warnings = currentManifest.warnings || {};
  const diagnostics = {
    sourcePosts: stats.sourcePosts,
    unpublishedPosts: Array.from({ length: stats.skippedUnpublishedPosts || 0 }, (_, index) => `unpublished-${index}`),
    postsWithoutUrl: warnings.postsWithoutUrl || [],
    postsWithoutIndexableContent: warnings.postsWithoutIndexableContent || []
  };
  const nextManifest = buildManifest(posts, chunks, diagnostics, {
    vectors: result.vectors,
    embedding: result.embedding,
    vectorBuild: result.build,
    codeBlocks,
    learningGraph,
    ingestion: currentManifest.ingestion
  });
  validateCorpusData(posts, chunks, nextManifest, result.vectors, { codeBlocks, learningGraph });

  atomicWrite('vectors.json', result.vectors);
  atomicWrite('manifest.json', nextManifest);
  report.published = true;
  report.corpusVersion = nextManifest.corpusVersion;
  writeReport(report);
  console.log(`Published complete embedding index: ${nextManifest.corpusVersion}`);
  console.log(`Build report: ${reportPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  atomicWrite,
  main,
  writeReport
};
