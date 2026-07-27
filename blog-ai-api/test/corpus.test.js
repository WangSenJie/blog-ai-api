'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildManifest,
  codeBlockHash,
  serializeJson,
  validateCorpusData,
  verifyManifestFiles
} = require('../lib/corpus-integrity');
const { buildVectorIndex } = require('../lib/embedding');
const { loadCorpusFromDir } = require('../lib/corpus');

function makePost(values) {
  return Object.assign({
    id: 'post-a',
    title: 'Post A',
    url: '/post-a/'
  }, values);
}

function makeChunk(values) {
  return Object.assign({
    id: 'post-a#0',
    postTitle: 'Post A',
    postUrl: '/post-a/',
    sectionTitle: 'Introduction',
    content: 'Indexable corpus content.'
  }, values);
}

function makeTempDir(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(directory, name, value) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, serializeJson(value), 'utf8');
  return filePath;
}

function makePhase5Artifacts() {
  const codeBlock = {
    id: 'code_aaaaaaaaaaaaaaaaaaaaaaaa',
    anchor: 'blog-ai-code-aaaaaaaaaaaaaaaaaaaaaaaa',
    postId: 'post-a',
    postTitle: 'Post A',
    postUrl: '/post-a/',
    sectionTitle: 'Introduction',
    headingPath: ['Introduction'],
    ordinal: 1,
    language: 'javascript',
    code: 'const answer = 42;\n',
    sourceLineStart: 3,
    sourceLineEnd: 5,
    contextChunkIds: ['chunk_aaaaaaaaaaaaaaaaaaaaaaaa']
  };
  codeBlock.contentHash = codeBlockHash(codeBlock);

  const nodeA = {
    id: 'node-a',
    postId: 'post-a',
    title: 'Post A',
    url: '/post-a/',
    order: 1,
    level: 'beginner',
    aliases: ['post a'],
    trackId: 'track-a'
  };
  const nodeB = {
    id: 'node-b',
    postId: 'post-b',
    title: 'Post B',
    url: '/post-b/',
    order: 2,
    level: 'intermediate',
    aliases: ['post b'],
    trackId: 'track-a'
  };
  const reason = '作者维护的测试阅读顺序';
  return {
    codeBlocks: [codeBlock],
    learningGraph: {
      schemaVersion: 1,
      version: 'test-author-curated-v1',
      policy: 'explicit_author_curated_only',
      nodes: [nodeA, nodeB],
      tracks: [{
        id: 'track-a',
        title: 'Test Track',
        aliases: ['test'],
        nodes: [nodeA, nodeB]
      }],
      edges: [{
        id: 'track-a:next:node-a:node-b',
        trackId: 'track-a',
        from: 'node-a',
        to: 'node-b',
        relation: 'next',
        reason
      }]
    }
  };
}

test('validateCorpusData rejects duplicate chunk IDs', () => {
  const posts = [makePost()];
  const chunks = [
    makeChunk(),
    makeChunk({ content: 'A second chunk reusing the same ID.' })
  ];

  assert.throws(
    () => validateCorpusData(posts, chunks),
    /duplicate chunk ID: post-a#0/
  );
});

test('validateCorpusData rejects chunks whose post is absent', () => {
  const posts = [makePost()];
  const chunks = [makeChunk({
    id: 'orphan#0',
    postTitle: 'Orphan',
    postUrl: '/orphan/'
  })];

  assert.throws(
    () => validateCorpusData(posts, chunks),
    /orphan chunk: orphan#0/
  );
});

test('validateCorpusData rejects chunk metadata that disagrees with its post', () => {
  const posts = [makePost()];
  const chunks = [makeChunk({ postTitle: 'Wrong title' })];

  assert.throws(
    () => validateCorpusData(posts, chunks),
    /metadata does not match its post: post-a#0/
  );
});

test('verifyManifestFiles detects a corpus file hash mismatch', t => {
  const directory = makeTempDir(t, 'blog-ai-corpus-hash-');
  const posts = [makePost()];
  const chunks = [makeChunk()];
  const manifest = buildManifest(posts, chunks, {});
  const postsPath = writeJson(directory, 'posts.json', posts);
  const chunksPath = writeJson(directory, 'chunks.json', chunks);

  assert.equal(verifyManifestFiles(manifest, { postsPath, chunksPath }), true);

  writeJson(directory, 'chunks.json', [makeChunk({
    content: 'Content changed after the manifest was generated.'
  })]);

  assert.throws(
    () => verifyManifestFiles(manifest, { postsPath, chunksPath }),
    /chunks\.json hash mismatch/
  );
});

test('schema v2 manifest validates vectors against stable chunk IDs and content hashes', t => {
  const directory = makeTempDir(t, 'blog-ai-hybrid-corpus-');
  const posts = [makePost()];
  const chunks = [makeChunk({
    id: 'chunk_aaaaaaaaaaaaaaaaaaaaaaaa',
    contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headingPath: ['Introduction'],
    chunkIndex: 0
  })];
  const vectorBuild = buildVectorIndex(chunks, []);
  const manifest = buildManifest(posts, chunks, {}, {
    vectors: vectorBuild.vectors,
    embedding: vectorBuild.embedding,
    vectorBuild: vectorBuild.build
  });
  const postsPath = writeJson(directory, 'posts.json', posts);
  const chunksPath = writeJson(directory, 'chunks.json', chunks);
  const vectorsPath = writeJson(directory, 'vectors.json', vectorBuild.vectors);

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(
    verifyManifestFiles(manifest, { postsPath, chunksPath, vectorsPath }),
    true
  );
  assert.equal(
    validateCorpusData(posts, chunks, manifest, vectorBuild.vectors).indexedVectors,
    1
  );

  const staleVectors = vectorBuild.vectors.map(vector => Object.assign({}, vector, {
    contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  }));
  assert.throws(
    () => validateCorpusData(posts, chunks, manifest, staleVectors),
    /stale or orphaned/
  );
});

test('schema v3 manifest verifies code blocks and the author-curated learning graph', t => {
  const directory = makeTempDir(t, 'blog-ai-phase5-corpus-');
  const posts = [
    makePost(),
    makePost({ id: 'post-b', title: 'Post B', url: '/post-b/' })
  ];
  const chunks = [
    makeChunk({
      id: 'chunk_aaaaaaaaaaaaaaaaaaaaaaaa',
      postId: 'post-a',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headingPath: ['Introduction'],
      chunkIndex: 0
    }),
    makeChunk({
      id: 'chunk_bbbbbbbbbbbbbbbbbbbbbbbb',
      postId: 'post-b',
      postTitle: 'Post B',
      postUrl: '/post-b/',
      sectionTitle: 'Advanced',
      content: 'A second indexable source chunk.',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      headingPath: ['Advanced'],
      chunkIndex: 0
    })
  ];
  const vectorBuild = buildVectorIndex(chunks, []);
  const artifacts = makePhase5Artifacts();
  const manifest = buildManifest(posts, chunks, {}, {
    vectors: vectorBuild.vectors,
    embedding: vectorBuild.embedding,
    vectorBuild: vectorBuild.build,
    codeBlocks: artifacts.codeBlocks,
    learningGraph: artifacts.learningGraph
  });
  const paths = {
    postsPath: writeJson(directory, 'posts.json', posts),
    chunksPath: writeJson(directory, 'chunks.json', chunks),
    vectorsPath: writeJson(directory, 'vectors.json', vectorBuild.vectors),
    codeBlocksPath: writeJson(directory, 'code-blocks.json', artifacts.codeBlocks),
    learningGraphPath: writeJson(directory, 'learning-graph.json', artifacts.learningGraph)
  };
  writeJson(directory, 'manifest.json', manifest);

  assert.equal(manifest.schemaVersion, 3);
  assert.equal(verifyManifestFiles(manifest, paths), true);
  assert.deepEqual(
    validateCorpusData(posts, chunks, manifest, vectorBuild.vectors, artifacts),
    {
      publishedPosts: 2,
      indexedPosts: 2,
      indexedChunks: 2,
      droppedChunks: 0,
      indexedVectors: 2,
      indexedCodeBlocks: 1,
      indexedLearningNodes: 2,
      indexedLearningTracks: 1,
      indexedLearningEdges: 1
    }
  );

  const loaded = loadCorpusFromDir(directory, { logger: { warn() {} } });
  assert.equal(loaded.manifest.schemaVersion, 3);
  assert.equal(loaded.codeBlocks[0].id, artifacts.codeBlocks[0].id);
  assert.equal(loaded.learningGraph.policy, 'explicit_author_curated_only');
  assert.equal(loaded.integrity.indexedCodeBlocks, 1);
  assert.equal(loaded.integrity.indexedLearningEdges, 1);

  const tamperedCodeBlocks = JSON.parse(JSON.stringify(artifacts.codeBlocks));
  tamperedCodeBlocks[0].code = 'const answer = 43;\n';
  assert.throws(
    () => validateCorpusData(posts, chunks, manifest, vectorBuild.vectors, {
      codeBlocks: tamperedCodeBlocks,
      learningGraph: artifacts.learningGraph
    }),
    /code block metadata does not match its source/
  );
  writeJson(directory, 'code-blocks.json', tamperedCodeBlocks);
  assert.throws(
    () => verifyManifestFiles(manifest, paths),
    /codeBlocks\.json hash mismatch/
  );

  const cyclicGraph = JSON.parse(JSON.stringify(artifacts.learningGraph));
  cyclicGraph.edges.push({
    id: 'track-a:next:node-b:node-a',
    trackId: 'track-a',
    from: 'node-b',
    to: 'node-a',
    relation: 'next',
    reason: 'Invalid test cycle'
  });
  assert.throws(
    () => validateCorpusData(posts, chunks, manifest, vectorBuild.vectors, {
      codeBlocks: artifacts.codeBlocks,
      learningGraph: cyclicGraph
    }),
    /dependency cycle/
  );
});

test('loadCorpusFromDir filters a legacy corpus when manifest.json is absent', t => {
  const directory = makeTempDir(t, 'blog-ai-legacy-corpus-');
  const warnings = [];
  const posts = [
    makePost(),
    makePost({ id: 'duplicate', title: 'Duplicate URL', url: 'https://wangsenjie.github.io/post-a/' }),
    makePost({ id: 'hidden', title: 'Hidden', url: '/hidden/', published: false }),
    makePost({ id: 'external', title: 'External', url: 'https://example.com/external/' })
  ];
  const chunks = [
    makeChunk(),
    makeChunk({ content: 'Duplicate ID should be filtered.' }),
    makeChunk({ id: 'orphan#0', postTitle: 'Orphan', postUrl: '/orphan/' }),
    makeChunk({ id: 'hidden#0', postTitle: 'Hidden', postUrl: '/hidden/' }),
    makeChunk({ id: '', postTitle: 'Missing ID', postUrl: '/post-a/' })
  ];
  writeJson(directory, 'posts.json', posts);
  writeJson(directory, 'chunks.json', chunks);

  const corpus = loadCorpusFromDir(directory, {
    logger: {
      warn(...args) {
        warnings.push(args);
      }
    }
  });

  assert.equal(corpus.manifest, null);
  assert.deepEqual(corpus.posts.map(post => post.id), ['post-a']);
  assert.deepEqual(corpus.chunks.map(chunk => chunk.id), ['post-a#0']);
  assert.deepEqual(corpus.integrity, {
    sourcePosts: 4,
    publishedPosts: 1,
    sourceChunks: 5,
    indexedPosts: 1,
    indexedChunks: 1,
    droppedChunks: 4,
    manifestVerified: false
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /manifest missing/i);
  assert.deepEqual(warnings[0][1], corpus.integrity);
});
