'use strict';

const crypto = require('crypto');
const fs = require('fs');

const {
  isIndexableChunk,
  normalizePostUrl
} = require('./retrieval-core');

const MANIFEST_SCHEMA_VERSION = 2;
const LEGACY_MANIFEST_SCHEMA_VERSION = 1;

function serializeJson(value) {
  return JSON.stringify(value, null, 2);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function diagnosticNames(diagnostics, key) {
  return Array.isArray(diagnostics && diagnostics[key])
    ? diagnostics[key]
    : [];
}

function buildManifest(posts, chunks, diagnostics, options) {
  const settings = options || {};
  const postsJson = serializeJson(posts);
  const chunksJson = serializeJson(chunks);
  const postsHash = sha256(postsJson);
  const chunksHash = sha256(chunksJson);
  const hasVectors = Array.isArray(settings.vectors);
  const vectorsJson = hasVectors ? serializeJson(settings.vectors) : '';
  const vectorsHash = hasVectors ? sha256(vectorsJson) : '';
  const unpublishedPosts = diagnosticNames(diagnostics, 'unpublishedPosts');
  const postsWithoutUrl = diagnosticNames(diagnostics, 'postsWithoutUrl');
  const postsWithoutIndexableContent = diagnosticNames(
    diagnostics,
    'postsWithoutIndexableContent'
  );
  const indexedPostUrls = new Set(
    chunks.map(chunk => normalizePostUrl(chunk.postUrl)).filter(Boolean)
  );

  const manifest = {
    schemaVersion: hasVectors
      ? MANIFEST_SCHEMA_VERSION
      : LEGACY_MANIFEST_SCHEMA_VERSION,
    corpusVersion: sha256(hasVectors
      ? `${MANIFEST_SCHEMA_VERSION}:${postsHash}:${chunksHash}:${vectorsHash}`
      : `${LEGACY_MANIFEST_SCHEMA_VERSION}:${postsHash}:${chunksHash}`),
    files: {
      posts: {
        sha256: postsHash,
        count: posts.length
      },
      chunks: {
        sha256: chunksHash,
        count: chunks.length
      }
    },
    stats: {
      sourcePosts: Number(diagnostics && diagnostics.sourcePosts) || posts.length,
      publishedPosts: posts.length,
      indexedPosts: indexedPostUrls.size,
      indexedChunks: chunks.length,
      skippedUnpublishedPosts: unpublishedPosts.length,
      skippedPostsWithoutUrl: postsWithoutUrl.length,
      skippedPostsWithoutIndexableContent: postsWithoutIndexableContent.length
    },
    warnings: {
      postsWithoutUrl,
      postsWithoutIndexableContent
    }
  };

  if (hasVectors) {
    const embedding = settings.embedding || {};
    const build = settings.vectorBuild || {};
    manifest.files.vectors = {
      sha256: vectorsHash,
      count: settings.vectors.length
    };
    manifest.embedding = {
      model: String(embedding.model || '').trim(),
      dimensions: Number(embedding.dimensions) || 0,
      version: Number(embedding.version) || 0,
      provider: String(embedding.provider || '').trim(),
      build: {
        added: Number(build.added) || 0,
        updated: Number(build.updated) || 0,
        reused: Number(build.reused) || 0,
        deleted: Number(build.deleted) || 0,
        failed: Number(build.failed) || 0
      }
    };
  }

  return manifest;
}

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('RAG corpus manifest is missing or invalid');
  }
  if (![LEGACY_MANIFEST_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION].includes(
    manifest.schemaVersion
  )) {
    throw new Error(`Unsupported RAG corpus manifest schema: ${manifest.schemaVersion}`);
  }

  const fileNames = manifest.schemaVersion === MANIFEST_SCHEMA_VERSION
    ? ['posts', 'chunks', 'vectors']
    : ['posts', 'chunks'];
  for (const name of fileNames) {
    const entry = manifest.files && manifest.files[name];
    if (
      !entry ||
      !/^[a-f0-9]{64}$/.test(String(entry.sha256 || '')) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 0
    ) {
      throw new Error(`Invalid RAG corpus manifest entry: ${name}`);
    }
  }

  if (!/^[a-f0-9]{64}$/.test(String(manifest.corpusVersion || ''))) {
    throw new Error('Invalid RAG corpus version');
  }

  const expectedVersion = manifest.schemaVersion === MANIFEST_SCHEMA_VERSION
    ? sha256(
      `${MANIFEST_SCHEMA_VERSION}:${manifest.files.posts.sha256}:${manifest.files.chunks.sha256}:${manifest.files.vectors.sha256}`
    )
    : sha256(
      `${LEGACY_MANIFEST_SCHEMA_VERSION}:${manifest.files.posts.sha256}:${manifest.files.chunks.sha256}`
    );
  if (manifest.corpusVersion !== expectedVersion) {
    throw new Error('RAG corpus version does not match its file hashes');
  }

  if (manifest.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    const embedding = manifest.embedding;
    if (
      !embedding ||
      !String(embedding.model || '').trim() ||
      !Number.isSafeInteger(embedding.dimensions) ||
      embedding.dimensions < 1 ||
      !Number.isSafeInteger(embedding.version) ||
      embedding.version < 1 ||
      !String(embedding.provider || '').trim()
    ) {
      throw new Error('Invalid RAG embedding manifest metadata');
    }
  }
}

function verifyManifestFiles(manifest, paths) {
  assertManifestShape(manifest);

  const fileNames = manifest.schemaVersion === MANIFEST_SCHEMA_VERSION
    ? ['posts', 'chunks', 'vectors']
    : ['posts', 'chunks'];
  for (const name of fileNames) {
    const filePath = paths && paths[`${name}Path`];
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`RAG corpus file is missing: ${name}.json`);
    }

    const actualHash = hashFile(filePath);
    if (actualHash !== manifest.files[name].sha256) {
      throw new Error(`RAG corpus integrity check failed: ${name}.json hash mismatch`);
    }
  }

  return true;
}

function validateVectorData(chunks, vectors, manifest) {
  if (!manifest || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return { indexedVectors: 0 };
  }
  if (!Array.isArray(vectors)) {
    throw new Error('RAG vector index must be an array');
  }
  if (vectors.length !== manifest.files.vectors.count) {
    throw new Error('RAG corpus integrity check failed: vectors.json count mismatch');
  }

  const chunksById = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const vectorIds = new Set();
  for (const vector of vectors) {
    const id = String(vector && vector.id || '').trim();
    const contentHash = String(vector && vector.contentHash || '').trim();
    const values = vector && vector.values;
    if (!id || vectorIds.has(id)) {
      throw new Error(`RAG vector index contains a missing or duplicate ID: ${id || '(missing id)'}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
      throw new Error(`RAG vector index contains an invalid content hash: ${id}`);
    }
    if (
      !Array.isArray(values) ||
      values.length !== manifest.embedding.dimensions ||
      !values.every(value => Number.isFinite(value))
    ) {
      throw new Error(`RAG vector index contains an invalid embedding: ${id}`);
    }
    const chunk = chunksById.get(id);
    if (!chunk || chunk.contentHash !== contentHash) {
      throw new Error(`RAG vector index is stale or orphaned: ${id}`);
    }
    vectorIds.add(id);
  }

  for (const chunk of chunks) {
    if (!/^sha256:[a-f0-9]{64}$/.test(String(chunk.contentHash || ''))) {
      throw new Error(`RAG corpus chunk is missing a content hash: ${chunk.id}`);
    }
    if (!vectorIds.has(chunk.id)) {
      throw new Error(`RAG vector index is missing a chunk embedding: ${chunk.id}`);
    }
  }
  return { indexedVectors: vectors.length };
}

function validateCorpusData(posts, chunks, manifest, vectors) {
  if (!Array.isArray(posts) || !Array.isArray(chunks)) {
    throw new Error('RAG corpus posts and chunks must be arrays');
  }

  if (manifest) {
    assertManifestShape(manifest);
    if (posts.length !== manifest.files.posts.count) {
      throw new Error('RAG corpus integrity check failed: posts.json count mismatch');
    }
    if (chunks.length !== manifest.files.chunks.count) {
      throw new Error('RAG corpus integrity check failed: chunks.json count mismatch');
    }
  }

  const publishedUrls = new Set();
  const postIds = new Set();
  const postsByUrl = new Map();
  for (const post of posts) {
    const postId = String(post && post.id || '').trim();
    const postTitle = String(post && post.title || '').trim();
    const postUrl = normalizePostUrl(post && post.url);
    if (!post || typeof post !== 'object' || !postId || !postTitle || !postUrl) {
      throw new Error('RAG corpus contains an invalid post');
    }
    if (postIds.has(postId)) {
      throw new Error(`RAG corpus contains a duplicate post ID: ${postId}`);
    }
    if (publishedUrls.has(postUrl)) {
      throw new Error(`RAG corpus contains a duplicate post URL: ${postUrl}`);
    }
    postIds.add(postId);
    publishedUrls.add(postUrl);
    postsByUrl.set(postUrl, post);
  }

  const chunkIds = new Set();
  const indexedPostUrls = new Set();
  for (const chunk of chunks) {
    const chunkId = String(chunk && chunk.id || '').trim();
    const postUrl = normalizePostUrl(chunk && chunk.postUrl);

    if (!isIndexableChunk(chunk)) {
      throw new Error(`RAG corpus contains an invalid chunk: ${chunkId || '(missing id)'}`);
    }
    if (chunkIds.has(chunkId)) {
      throw new Error(`RAG corpus contains a duplicate chunk ID: ${chunkId}`);
    }
    if (!publishedUrls.has(postUrl)) {
      throw new Error(`RAG corpus contains an orphan chunk: ${chunkId}`);
    }

    const parentPost = postsByUrl.get(postUrl);
    if (
      chunk.postTitle !== parentPost.title ||
      (chunk.postId && chunk.postId !== parentPost.id)
    ) {
      throw new Error(`RAG corpus chunk metadata does not match its post: ${chunkId}`);
    }

    chunkIds.add(chunkId);
    indexedPostUrls.add(postUrl);
  }

  const vectorIntegrity = validateVectorData(chunks, vectors, manifest);
  return Object.assign({
    publishedPosts: posts.length,
    indexedPosts: indexedPostUrls.size,
    indexedChunks: chunks.length,
    droppedChunks: 0
  }, vectorIntegrity);
}

module.exports = {
  LEGACY_MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
  assertManifestShape,
  buildManifest,
  hashFile,
  serializeJson,
  sha256,
  validateCorpusData,
  validateVectorData,
  verifyManifestFiles
};
