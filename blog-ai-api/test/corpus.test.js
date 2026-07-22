'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildManifest,
  serializeJson,
  validateCorpusData,
  verifyManifestFiles
} = require('../lib/corpus-integrity');
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
