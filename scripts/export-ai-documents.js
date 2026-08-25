'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
    buildCorpus,
    buildIngestionReport,
    buildLearningGraph,
  extractCodeBlocks
} = require('./build-ai-corpus');
const {
  buildManifest,
  serializeJson,
  validateCorpusData
} = require('../blog-ai-api/lib/corpus-integrity');
const {
  buildVectorIndex,
  embeddingMetadata
} = require('../blog-ai-api/lib/embedding');

const rootDir = process.cwd();
const postsDir = path.join(rootDir, 'source', '_posts');
const dataOutputDir = path.join(rootDir, 'data');
const publishOutputDir = path.join(rootDir, 'source', 'ai-data');
const retrievalCorePath = path.join(rootDir, 'blog-ai-api', 'lib', 'retrieval-core.js');
const browserRetrievalPath = path.join(rootDir, 'source', 'js', 'blog-ai-retrieval.js');

const chunkSchemaMode = String(process.env.RAG_CHUNK_SCHEMA || 'structured-v1').trim();
if (!['structured-v1', 'legacy-v3'].includes(chunkSchemaMode)) {
  throw new Error(`Unsupported RAG_CHUNK_SCHEMA mode: ${chunkSchemaMode}`);
}
if (chunkSchemaMode === 'legacy-v3') {
  const revision = String(process.env.RAG_LEGACY_CORPUS_REVISION || '7e6d67b').trim();
  if (!/^[a-f0-9]{7,40}$/.test(revision)) {
    throw new Error(`Invalid RAG_LEGACY_CORPUS_REVISION: ${revision}`);
  }
  const artifactNames = [
    'posts.json',
    'chunks.json',
    'manifest.json',
    'vectors.json',
    'code-blocks.json',
    'learning-graph.json'
  ];
  fs.mkdirSync(dataOutputDir, { recursive: true });
  fs.mkdirSync(publishOutputDir, { recursive: true });
  for (const filename of artifactNames) {
    const contents = execFileSync('git', [
      'show',
      `${revision}:data/${filename}`
    ], {
      cwd: rootDir,
      encoding: null,
      maxBuffer: 256 * 1024 * 1024
    });
    fs.writeFileSync(path.join(dataOutputDir, filename), contents);
    fs.writeFileSync(path.join(publishOutputDir, filename), contents);
  }
  const browserRetrieval = execFileSync('git', [
    'show',
    `${revision}:source/js/blog-ai-retrieval.js`
  ], {
    cwd: rootDir,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024
  });
  fs.writeFileSync(browserRetrievalPath, browserRetrieval);
  console.warn(`Restored legacy v3 RAG corpus from Git revision ${revision}`);
  process.exit(0);
}

const corpus = buildCorpus(postsDir);
const codeBlocks = extractCodeBlocks(corpus.posts, corpus.chunks);
const learningGraph = buildLearningGraph(corpus.posts);
const ingestion = buildIngestionReport(corpus.posts, corpus.chunks, corpus.diagnostics);

function serializePost(post) {
  return {
    id: post.id,
    title: post.title,
    date: post.date,
    description: post.description || '',
    tags: post.tags || [],
    categories: post.categories || [],
    sourcePath: post.sourcePath || '',
    resourceLinks: post.resourceLinks || [],
    internalLinks: post.internalLinks || [],
    chunkProfile: post.chunkProfile || '',
    profileSource: post.profileSource || '',
    slug: post.slug,
    url: post.url
  };
}

function readExistingVectorIndex(outputDir) {
  const vectorPath = path.join(outputDir, 'vectors.json');
  const manifestPath = path.join(outputDir, 'manifest.json');
  if (!fs.existsSync(vectorPath) || !fs.existsSync(manifestPath)) {
    return { vectors: [], embedding: null };
  }
  try {
    const vectors = JSON.parse(fs.readFileSync(vectorPath, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      vectors: Array.isArray(vectors) ? vectors : [],
      embedding: manifest && manifest.embedding ? manifest.embedding : null
    };
  } catch (error) {
    console.warn(`Ignoring unreadable previous vector index: ${vectorPath}`);
    return { vectors: [], embedding: null };
  }
}

function embeddingMatches(left, right) {
  return Boolean(left && right) &&
    left.model === right.model &&
    left.dimensions === right.dimensions &&
    left.version === right.version &&
    left.provider === right.provider;
}

function writeJson(outputDir, filename, value) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, serializeJson(value), 'utf8');
  return outputPath;
}

const publicPosts = corpus.posts.map(serializePost);
const phase5Artifacts = { codeBlocks, learningGraph };
validateCorpusData(publicPosts, corpus.chunks);
const expectedEmbedding = embeddingMetadata();
const existingVectorIndex = readExistingVectorIndex(dataOutputDir);
const vectorBuild = buildVectorIndex(corpus.chunks, embeddingMatches(
  existingVectorIndex.embedding,
  expectedEmbedding
) ? existingVectorIndex.vectors : []);
const manifest = buildManifest(publicPosts, corpus.chunks, corpus.diagnostics, {
  vectors: vectorBuild.vectors,
  embedding: vectorBuild.embedding,
  vectorBuild: vectorBuild.build,
  codeBlocks,
  learningGraph,
  ingestion
});
validateCorpusData(
  publicPosts,
  corpus.chunks,
  manifest,
  vectorBuild.vectors,
  phase5Artifacts
);
const postsOutputPath = writeJson(dataOutputDir, 'posts.json', publicPosts);
const chunksOutputPath = writeJson(dataOutputDir, 'chunks.json', corpus.chunks);
const manifestOutputPath = writeJson(dataOutputDir, 'manifest.json', manifest);
const vectorsOutputPath = writeJson(dataOutputDir, 'vectors.json', vectorBuild.vectors);
const codeBlocksOutputPath = writeJson(dataOutputDir, 'code-blocks.json', codeBlocks);
const learningGraphOutputPath = writeJson(dataOutputDir, 'learning-graph.json', learningGraph);
const publishedPostsPath = writeJson(publishOutputDir, 'posts.json', publicPosts);
const publishedChunksPath = writeJson(publishOutputDir, 'chunks.json', corpus.chunks);
const publishedManifestPath = writeJson(publishOutputDir, 'manifest.json', manifest);
const publishedVectorsPath = writeJson(publishOutputDir, 'vectors.json', vectorBuild.vectors);
const publishedCodeBlocksPath = writeJson(publishOutputDir, 'code-blocks.json', codeBlocks);
const publishedLearningGraphPath = writeJson(publishOutputDir, 'learning-graph.json', learningGraph);

fs.copyFileSync(retrievalCorePath, browserRetrievalPath);

if (typeof hexo !== 'undefined' && hexo.extend && hexo.extend.filter) {
  hexo.extend.filter.register('after_generate', () => {
    const generatedRoutes = new Set(hexo.route.list());
    const missingRoutes = publicPosts.filter(post => {
      const pathname = new URL(post.url).pathname.replace(/^\//, '');
      return !generatedRoutes.has(`${pathname}index.html`);
    });

    if (missingRoutes.length) {
      const details = missingRoutes
        .map(post => `${post.title}: ${post.url}`)
        .join(', ');
      throw new Error(`RAG corpus contains post URLs without generated pages: ${details}`);
    }

    console.log(`Verified ${publicPosts.length} RAG post routes`);
  });
}

console.log(`Exported ${corpus.posts.length} posts`);
console.log(`Exported ${corpus.chunks.length} chunks`);
console.log(
  `Structured ingestion: blocks=${ingestion.stats.structuredBlocks} ` +
  `locatedChunks=${ingestion.stats.sourceLocatedChunks} ` +
  `duplicateContents=${ingestion.stats.duplicateChunkContents}`
);
console.log(`Data posts file: ${postsOutputPath}`);
console.log(`Data chunks file: ${chunksOutputPath}`);
console.log(`Data manifest file: ${manifestOutputPath}`);
console.log(`Data vectors file: ${vectorsOutputPath}`);
console.log(`Data code blocks file: ${codeBlocksOutputPath}`);
console.log(`Data learning graph file: ${learningGraphOutputPath}`);
console.log(`Published posts file: ${publishedPostsPath}`);
console.log(`Published chunks file: ${publishedChunksPath}`);
console.log(`Published manifest file: ${publishedManifestPath}`);
console.log(`Published vectors file: ${publishedVectorsPath}`);
console.log(`Published code blocks file: ${publishedCodeBlocksPath}`);
console.log(`Published learning graph file: ${publishedLearningGraphPath}`);
console.log(
  `Embedding index: model=${vectorBuild.embedding.model} ` +
  `added=${vectorBuild.build.added} updated=${vectorBuild.build.updated} ` +
  `reused=${vectorBuild.build.reused} deleted=${vectorBuild.build.deleted} ` +
  `failed=${vectorBuild.build.failed}`
);
console.log(`Browser retrieval core: ${browserRetrievalPath}`);

if (manifest.stats.skippedPostsWithoutUrl) {
  console.warn(`Skipped ${manifest.stats.skippedPostsWithoutUrl} posts without a published URL`);
}
if (manifest.stats.skippedUnpublishedPosts) {
  console.warn(`Skipped ${manifest.stats.skippedUnpublishedPosts} unpublished posts`);
}
if (manifest.stats.skippedPostsWithoutIndexableContent) {
  console.warn(
    `Skipped ${manifest.stats.skippedPostsWithoutIndexableContent} published posts without indexable content`
  );
}
