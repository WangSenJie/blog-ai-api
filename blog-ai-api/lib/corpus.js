'use strict';

const fs = require('fs');
const path = require('path');

const {
  validateCorpusData,
  verifyManifestFiles
} = require('./corpus-integrity');
const {
  isIndexableChunk,
  normalizePostUrl
} = require('./retrieval-core');

let cachedCorpus = null;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function legacyCorpus(rawPosts, rawChunks) {
  if (!Array.isArray(rawPosts) || !Array.isArray(rawChunks)) {
    throw new Error('RAG corpus posts and chunks must be arrays');
  }

  const seenPostUrls = new Set();
  const posts = rawPosts.filter(post => {
    const postUrl = normalizePostUrl(post && post.url);
    if (!postUrl || post.published === false || seenPostUrls.has(postUrl)) return false;
    seenPostUrls.add(postUrl);
    return true;
  });
  const seenChunkIds = new Set();
  const chunks = rawChunks.filter(chunk => {
    const chunkId = String(chunk && chunk.id || '').trim();
    const postUrl = normalizePostUrl(chunk && chunk.postUrl);
    if (
      !isIndexableChunk(chunk) ||
      !seenPostUrls.has(postUrl) ||
      seenChunkIds.has(chunkId)
    ) {
      return false;
    }
    seenChunkIds.add(chunkId);
    return true;
  });

  return { posts, chunks };
}

function loadCorpusFromDir(dataDir, options) {
  const logger = options && options.logger ? options.logger : console;
  const postsPath = path.join(dataDir, 'posts.json');
  const chunksPath = path.join(dataDir, 'chunks.json');
  const manifestPath = path.join(dataDir, 'manifest.json');
  const vectorsPath = path.join(dataDir, 'vectors.json');
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  let posts;
  let chunks;
  let vectors = [];
  let integrity;

  if (manifest) {
    verifyManifestFiles(manifest, { postsPath, chunksPath, vectorsPath });
    posts = readJson(postsPath);
    chunks = readJson(chunksPath);
    vectors = manifest.schemaVersion >= 2 ? readJson(vectorsPath) : [];
    integrity = Object.assign(
      {
        sourcePosts: posts.length,
        sourceChunks: chunks.length,
        manifestVerified: true
      },
      validateCorpusData(posts, chunks, manifest, vectors)
    );
  } else {
    const rawPosts = readJson(postsPath);
    const rawChunks = readJson(chunksPath);
    const filtered = legacyCorpus(rawPosts, rawChunks);
    posts = filtered.posts;
    chunks = filtered.chunks;
    integrity = {
      sourcePosts: rawPosts.length,
      publishedPosts: posts.length,
      sourceChunks: rawChunks.length,
      indexedPosts: new Set(chunks.map(chunk => normalizePostUrl(chunk.postUrl))).size,
      indexedChunks: chunks.length,
      droppedChunks: rawChunks.length - chunks.length,
      manifestVerified: false
    };

    if (logger && typeof logger.warn === 'function') {
      logger.warn('RAG corpus manifest missing; loaded filtered legacy corpus', integrity);
    }
  }

  return {
    posts,
    chunks,
    vectors,
    manifest,
    integrity
  };
}

function loadCorpus() {
  if (!cachedCorpus) {
    cachedCorpus = loadCorpusFromDir(path.join(__dirname, '..', 'data'));
  }
  return cachedCorpus;
}

function resetCorpusCache() {
  cachedCorpus = null;
}

module.exports = {
  legacyCorpus,
  loadCorpus,
  loadCorpusFromDir,
  resetCorpusCache
};
