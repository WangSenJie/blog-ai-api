'use strict';

const crypto = require('crypto');
const fs = require('fs');

const {
  isIndexableChunk,
  normalizePostUrl
} = require('./retrieval-core');

const MANIFEST_SCHEMA_VERSION = 1;

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

function buildManifest(posts, chunks, diagnostics) {
  const postsJson = serializeJson(posts);
  const chunksJson = serializeJson(chunks);
  const postsHash = sha256(postsJson);
  const chunksHash = sha256(chunksJson);
  const unpublishedPosts = diagnosticNames(diagnostics, 'unpublishedPosts');
  const postsWithoutUrl = diagnosticNames(diagnostics, 'postsWithoutUrl');
  const postsWithoutIndexableContent = diagnosticNames(
    diagnostics,
    'postsWithoutIndexableContent'
  );
  const indexedPostUrls = new Set(
    chunks.map(chunk => normalizePostUrl(chunk.postUrl)).filter(Boolean)
  );

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    corpusVersion: sha256(
      `${MANIFEST_SCHEMA_VERSION}:${postsHash}:${chunksHash}`
    ),
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
}

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('RAG corpus manifest is missing or invalid');
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported RAG corpus manifest schema: ${manifest.schemaVersion}`);
  }

  for (const name of ['posts', 'chunks']) {
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

  const expectedVersion = sha256(
    `${MANIFEST_SCHEMA_VERSION}:${manifest.files.posts.sha256}:${manifest.files.chunks.sha256}`
  );
  if (manifest.corpusVersion !== expectedVersion) {
    throw new Error('RAG corpus version does not match its file hashes');
  }
}

function verifyManifestFiles(manifest, paths) {
  assertManifestShape(manifest);

  for (const name of ['posts', 'chunks']) {
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

function validateCorpusData(posts, chunks, manifest) {
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

  return {
    publishedPosts: posts.length,
    indexedPosts: indexedPostUrls.size,
    indexedChunks: chunks.length,
    droppedChunks: 0
  };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  assertManifestShape,
  buildManifest,
  hashFile,
  serializeJson,
  sha256,
  validateCorpusData,
  verifyManifestFiles
};
