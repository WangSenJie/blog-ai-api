'use strict';

const crypto = require('crypto');
const fs = require('fs');

const {
  isIndexableChunk,
  normalizePostUrl
} = require('./retrieval-core');

const MANIFEST_SCHEMA_VERSION = 3;
const VECTOR_MANIFEST_SCHEMA_VERSION = 2;
const LEGACY_MANIFEST_SCHEMA_VERSION = 1;

function manifestFileNames(schemaVersion) {
  if (schemaVersion === MANIFEST_SCHEMA_VERSION) {
    return ['posts', 'chunks', 'vectors', 'codeBlocks', 'learningGraph'];
  }
  if (schemaVersion === VECTOR_MANIFEST_SCHEMA_VERSION) {
    return ['posts', 'chunks', 'vectors'];
  }
  return ['posts', 'chunks'];
}

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
  const hasPhase5Artifacts = hasVectors &&
    Array.isArray(settings.codeBlocks) &&
    settings.learningGraph &&
    typeof settings.learningGraph === 'object' &&
    !Array.isArray(settings.learningGraph);
  const codeBlocksJson = hasPhase5Artifacts
    ? serializeJson(settings.codeBlocks)
    : '';
  const learningGraphJson = hasPhase5Artifacts
    ? serializeJson(settings.learningGraph)
    : '';
  const codeBlocksHash = hasPhase5Artifacts ? sha256(codeBlocksJson) : '';
  const learningGraphHash = hasPhase5Artifacts ? sha256(learningGraphJson) : '';
  const unpublishedPosts = diagnosticNames(diagnostics, 'unpublishedPosts');
  const postsWithoutUrl = diagnosticNames(diagnostics, 'postsWithoutUrl');
  const postsWithoutIndexableContent = diagnosticNames(
    diagnostics,
    'postsWithoutIndexableContent'
  );
  const indexedPostUrls = new Set(
    chunks.map(chunk => normalizePostUrl(chunk.postUrl)).filter(Boolean)
  );

  const schemaVersion = hasPhase5Artifacts
    ? MANIFEST_SCHEMA_VERSION
    : hasVectors
      ? VECTOR_MANIFEST_SCHEMA_VERSION
      : LEGACY_MANIFEST_SCHEMA_VERSION;
  const manifest = {
    schemaVersion,
    corpusVersion: sha256(schemaVersion === MANIFEST_SCHEMA_VERSION
      ? `${MANIFEST_SCHEMA_VERSION}:${postsHash}:${chunksHash}:${vectorsHash}:${codeBlocksHash}:${learningGraphHash}`
      : schemaVersion === VECTOR_MANIFEST_SCHEMA_VERSION
        ? `${VECTOR_MANIFEST_SCHEMA_VERSION}:${postsHash}:${chunksHash}:${vectorsHash}`
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

  if (hasPhase5Artifacts) {
    manifest.files.codeBlocks = {
      sha256: codeBlocksHash,
      count: settings.codeBlocks.length
    };
    manifest.files.learningGraph = {
      sha256: learningGraphHash,
      count: 1
    };
    manifest.stats.codeBlocks = settings.codeBlocks.length;
    manifest.stats.learningTracks = Array.isArray(settings.learningGraph.tracks)
      ? settings.learningGraph.tracks.length
      : 0;
  }

  return manifest;
}

function assertManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('RAG corpus manifest is missing or invalid');
  }
  if (![LEGACY_MANIFEST_SCHEMA_VERSION, VECTOR_MANIFEST_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION].includes(
    manifest.schemaVersion
  )) {
    throw new Error(`Unsupported RAG corpus manifest schema: ${manifest.schemaVersion}`);
  }

  const fileNames = manifestFileNames(manifest.schemaVersion);
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
      `${MANIFEST_SCHEMA_VERSION}:${manifest.files.posts.sha256}:${manifest.files.chunks.sha256}:${manifest.files.vectors.sha256}:${manifest.files.codeBlocks.sha256}:${manifest.files.learningGraph.sha256}`
    )
    : manifest.schemaVersion === VECTOR_MANIFEST_SCHEMA_VERSION
      ? sha256(
        `${VECTOR_MANIFEST_SCHEMA_VERSION}:${manifest.files.posts.sha256}:${manifest.files.chunks.sha256}:${manifest.files.vectors.sha256}`
      )
      : sha256(
        `${LEGACY_MANIFEST_SCHEMA_VERSION}:${manifest.files.posts.sha256}:${manifest.files.chunks.sha256}`
      );
  if (manifest.corpusVersion !== expectedVersion) {
    throw new Error('RAG corpus version does not match its file hashes');
  }

  if (manifest.schemaVersion >= VECTOR_MANIFEST_SCHEMA_VERSION) {
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

  const fileNames = manifestFileNames(manifest.schemaVersion);
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
  if (!manifest || manifest.schemaVersion < VECTOR_MANIFEST_SCHEMA_VERSION) {
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

function codeBlockHash(block) {
  const fingerprint = {
    postId: String(block && block.postId || '').trim(),
    postTitle: String(block && block.postTitle || '').trim(),
    postUrl: String(block && block.postUrl || '').trim(),
    headingPath: (block && block.headingPath || [])
      .map(value => String(value || '').trim()),
    ordinal: Number(block && block.ordinal) || 0,
    language: String(block && block.language || '').trim(),
    code: String(block && block.code || '').replace(/\r\n/g, '\n')
  };
  return `sha256:${sha256(JSON.stringify(fingerprint))}`;
}

function validateCodeBlocksData(posts, chunks, codeBlocks) {
  if (!Array.isArray(codeBlocks)) {
    throw new Error('RAG code block index must be an array');
  }
  const postsByUrl = new Map((posts || []).map(post => [
    normalizePostUrl(post && post.url),
    post
  ]));
  const chunksById = new Map((chunks || []).map(chunk => [
    String(chunk && chunk.id || '').trim(),
    chunk
  ]));
  const ids = new Set();

  for (const block of codeBlocks) {
    const id = String(block && block.id || '').trim();
    const postUrl = normalizePostUrl(block && block.postUrl);
    const code = String(block && block.code || '');
    const anchor = String(block && block.anchor || '').trim();
    const ordinal = Number(block && block.ordinal);
    const lineStart = Number(block && block.sourceLineStart);
    const lineEnd = Number(block && block.sourceLineEnd);
    const language = String(block && block.language || '').trim();
    if (
      !block || typeof block !== 'object' ||
      !/^code_[a-f0-9]{24}$/.test(id) || ids.has(id) ||
      !postUrl || !postsByUrl.has(postUrl) || !code.trim() ||
      !/^blog-ai-code-[a-f0-9]{24}$/.test(anchor) ||
      anchor !== `blog-ai-code-${id.slice('code_'.length)}` ||
      !Number.isSafeInteger(ordinal) || ordinal < 1 ||
      !Number.isSafeInteger(lineStart) || lineStart < 1 ||
      !Number.isSafeInteger(lineEnd) || lineEnd < lineStart ||
      !/^[a-z0-9_+-]{1,40}$/.test(language) ||
      !/^sha256:[a-f0-9]{64}$/.test(String(block && block.contentHash || ''))
    ) {
      throw new Error(`RAG code block index contains an invalid block: ${id || '(missing id)'}`);
    }
    const post = postsByUrl.get(postUrl);
    if (
      String(block.postId || '') !== String(post.id || '') ||
      String(block.postTitle || '') !== String(post.title || '') ||
      codeBlockHash(block) !== block.contentHash
    ) {
      throw new Error(`RAG code block metadata does not match its source: ${id}`);
    }
    if (!Array.isArray(block.headingPath) || !Array.isArray(block.contextChunkIds)) {
      throw new Error(`RAG code block contains invalid locations: ${id}`);
    }
    const contextIds = new Set();
    for (const rawChunkId of block.contextChunkIds) {
      const chunkId = String(rawChunkId || '').trim();
      const chunk = chunksById.get(chunkId);
      if (!chunk || contextIds.has(chunkId) || normalizePostUrl(chunk.postUrl) !== postUrl) {
        throw new Error(`RAG code block contains an invalid context chunk: ${id}`);
      }
      contextIds.add(chunkId);
    }
    ids.add(id);
  }
  return { indexedCodeBlocks: codeBlocks.length };
}

function validateLearningGraphData(posts, learningGraph) {
  if (!learningGraph || typeof learningGraph !== 'object' || Array.isArray(learningGraph)) {
    throw new Error('RAG learning graph is missing or invalid');
  }
  if (
    learningGraph.schemaVersion !== 1 ||
    !String(learningGraph.version || '').trim() ||
    learningGraph.policy !== 'explicit_author_curated_only' ||
    !Array.isArray(learningGraph.nodes) ||
    !Array.isArray(learningGraph.tracks) ||
    !Array.isArray(learningGraph.edges)
  ) {
    throw new Error('RAG learning graph has an invalid schema');
  }

  const postsByUrl = new Map((posts || []).map(post => [
    normalizePostUrl(post && post.url),
    post
  ]));
  const nodes = new Map();
  for (const node of learningGraph.nodes) {
    const id = String(node && node.id || '').trim();
    const url = normalizePostUrl(node && node.url);
    const post = postsByUrl.get(url);
    if (
      !id || nodes.has(id) || !post ||
      String(node.postId || '') !== String(post.id || '') ||
      String(node.title || '') !== String(post.title || '') ||
      !Number.isSafeInteger(Number(node.order)) || Number(node.order) < 1 ||
      !/^(beginner|intermediate|advanced)$/.test(String(node.level || '')) ||
      !Array.isArray(node.aliases)
    ) {
      throw new Error(`RAG learning graph contains an invalid node: ${id || '(missing id)'}`);
    }
    nodes.set(id, node);
  }

  const trackIds = new Set();
  for (const track of learningGraph.tracks) {
    const id = String(track && track.id || '').trim();
    if (!id || trackIds.has(id) || !String(track.title || '').trim() ||
      !Array.isArray(track.aliases) || !Array.isArray(track.nodes) || !track.nodes.length) {
      throw new Error(`RAG learning graph contains an invalid track: ${id || '(missing id)'}`);
    }
    const seenNodes = new Set();
    let previousOrder = 0;
    for (const node of track.nodes) {
      const graphNode = nodes.get(String(node && node.id || '').trim());
      if (!graphNode || seenNodes.has(graphNode.id) || graphNode.trackId !== id ||
        Number(graphNode.order) <= previousOrder) {
        throw new Error(`RAG learning graph track ordering is invalid: ${id}`);
      }
      seenNodes.add(graphNode.id);
      previousOrder = Number(graphNode.order);
    }
    trackIds.add(id);
  }

  const edgeIds = new Set();
  const adjacency = new Map([...nodes.keys()].map(id => [id, []]));
  for (const edge of learningGraph.edges) {
    const id = String(edge && edge.id || '').trim();
    const from = String(edge && edge.from || '').trim();
    const to = String(edge && edge.to || '').trim();
    const relation = String(edge && edge.relation || '').trim();
    if (
      !id || edgeIds.has(id) || !nodes.has(from) || !nodes.has(to) ||
      from === to || !trackIds.has(String(edge.trackId || '')) ||
      !['prerequisite', 'next', 'alternative'].includes(relation) ||
      !String(edge.reason || '').trim()
    ) {
      throw new Error(`RAG learning graph contains an invalid edge: ${id || '(missing id)'}`);
    }
    if (relation !== 'alternative') adjacency.get(from).push(to);
    edgeIds.add(id);
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      throw new Error('RAG learning graph contains a dependency cycle');
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const nextId of adjacency.get(nodeId) || []) visit(nextId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of nodes.keys()) visit(nodeId);

  return {
    indexedLearningNodes: nodes.size,
    indexedLearningTracks: trackIds.size,
    indexedLearningEdges: edgeIds.size
  };
}

function validateCorpusData(posts, chunks, manifest, vectors, phase5Artifacts) {
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
  const phase5Integrity = manifest &&
    manifest.schemaVersion === MANIFEST_SCHEMA_VERSION
    ? (() => {
      if (!phase5Artifacts || typeof phase5Artifacts !== 'object') {
        throw new Error('RAG phase 5 corpus artifacts are missing');
      }
      const codeIntegrity = validateCodeBlocksData(
        posts,
        chunks,
        phase5Artifacts.codeBlocks
      );
      const graphIntegrity = validateLearningGraphData(
        posts,
        phase5Artifacts.learningGraph
      );
      if (phase5Artifacts.codeBlocks.length !== manifest.files.codeBlocks.count) {
        throw new Error('RAG corpus integrity check failed: code-blocks.json count mismatch');
      }
      return Object.assign({}, codeIntegrity, graphIntegrity);
    })()
    : {};
  return Object.assign({
    publishedPosts: posts.length,
    indexedPosts: indexedPostUrls.size,
    indexedChunks: chunks.length,
    droppedChunks: 0
  }, vectorIntegrity, phase5Integrity);
}

module.exports = {
  LEGACY_MANIFEST_SCHEMA_VERSION,
  VECTOR_MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMA_VERSION,
  assertManifestShape,
  buildManifest,
  codeBlockHash,
  hashFile,
  manifestFileNames,
  serializeJson,
  sha256,
  validateCodeBlocksData,
  validateCorpusData,
  validateLearningGraphData,
  validateVectorData,
  verifyManifestFiles
};
