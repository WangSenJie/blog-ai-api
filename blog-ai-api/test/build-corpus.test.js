'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCorpus,
  buildLearningGraph,
  extractCodeBlocks
} = require('../../scripts/build-ai-corpus');

function makeTempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-ai-build-corpus-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writePost(directory, filename, frontMatter, body) {
  const content = [
    '---',
    frontMatter.trim(),
    '---',
    String(body || '').trim(),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(directory, filename), content, 'utf8');
}

test('buildCorpus excludes unpublished and draft posts and reports unindexable posts', t => {
  const postsDirectory = makeTempDir(t);

  writePost(postsDirectory, '01-published.md', `
title: Published Post
date: 2026-07-01
slug: published-post
  `, '# Introduction\n\nThis post contains indexable RAG content.');

  writePost(postsDirectory, '02-published-false.md', `
title: Published False
date: 2026-07-02
slug: published-false
published: false
  `, 'This unpublished content must not enter the corpus.');

  writePost(postsDirectory, '03-published-quoted-false.md', `
title: Quoted False
date: 2026-07-03
slug: quoted-false
published: "false"
  `, 'Quoted false must also be treated as unpublished.');

  writePost(postsDirectory, '04-draft.md', `
title: Draft Post
date: 2026-07-04
slug: draft-post
draft: true
  `, 'Draft content must not enter the corpus.');

  writePost(postsDirectory, '05-missing-url.md', `
title: Missing URL
slug: missing-url
  `, 'A published post without a date cannot receive its public URL.');

  writePost(postsDirectory, '06-pdf-only.md', `
title: PDF Only
date: 2026-07-06
slug: pdf-only
  `, '{% pdf /assets/paper.pdf %}');

  const corpus = buildCorpus(postsDirectory);
  const postTitles = corpus.posts.map(post => post.title);

  assert.equal(corpus.diagnostics.sourcePosts, 6);
  assert.deepEqual(postTitles, ['Published Post', 'PDF Only']);
  assert.deepEqual(
    new Set(corpus.diagnostics.unpublishedPosts),
    new Set(['Published False', 'Quoted False', 'Draft Post'])
  );
  assert.deepEqual(corpus.diagnostics.postsWithoutUrl, ['Missing URL']);
  assert.deepEqual(corpus.diagnostics.postsWithoutIndexableContent, []);
  assert.deepEqual(
    [...new Set(corpus.chunks.map(chunk => chunk.postTitle))],
    ['Published Post', 'PDF Only']
  );

  const pdfOnlyPost = corpus.posts.find(post => post.title === 'PDF Only');
  const pdfOnlyChunk = corpus.chunks.find(chunk => chunk.postTitle === 'PDF Only');
  assert.equal(corpus.posts.some(post => post.title === 'Missing URL'), false);
  assert.match(pdfOnlyPost.url, /\/2026\/07\/06\/pdf-only\/$/);
  assert.equal(pdfOnlyChunk.metadataOnly, true);
  assert.equal(pdfOnlyChunk.sectionTitle, '文章元数据');
  assert.match(pdfOnlyChunk.content, /PDF 或其他外部文档资源/);
  assert.deepEqual(pdfOnlyChunk.resourceLinks, ['/assets/paper.pdf']);
  assert.match(pdfOnlyChunk.id, /^chunk_[a-f0-9]{24}$/);
  assert.match(pdfOnlyChunk.contentHash, /^sha256:[a-f0-9]{64}$/);
});

test('unpublished sources still reserve slugs to match Hexo route generation', t => {
  const postsDirectory = makeTempDir(t);

  writePost(postsDirectory, '01-hidden.md', `
title: Hidden Post
date: 2026-07-01
slug: shared-route
published: false
  `, 'Hidden content.');

  writePost(postsDirectory, '02-visible.md', `
title: Visible Post
date: 2026-07-02
slug: shared-route
  `, 'Visible indexable content.');

  const corpus = buildCorpus(postsDirectory);

  assert.equal(corpus.posts.length, 1);
  assert.equal(corpus.posts[0].title, 'Visible Post');
  assert.equal(corpus.posts[0].slug, 'shared-route-2');
  assert.match(corpus.posts[0].url, /\/2026\/07\/02\/shared-route-2\/$/);
});

test('Phase 5 extracts stable fenced code blocks and builds only explicit learning tracks', t => {
  const postsDirectory = makeTempDir(t);

  writePost(postsDirectory, '01-code-basics.md', `
title: Code Basics
date: 2026-07-01
slug: code-basics
  `, `# Overview

The overview gives the prose context for the code.

- Nested example:

  \`\`\`JavaScript extra-info
  const fromList = true;
  \`\`\`

## Details

The details provide a second source context.

\`\`\`ts
const typed: number = 1;
\`\`\``);

  writePost(postsDirectory, '02-code-advanced.md', `
title: Code Advanced
date: 2026-07-02
slug: code-advanced
  `, '# Advanced\n\nThis is the second explicitly configured learning step.');

  const corpus = buildCorpus(postsDirectory);
  const firstExtraction = extractCodeBlocks(corpus.posts, corpus.chunks);
  const secondExtraction = extractCodeBlocks(corpus.posts, corpus.chunks);

  assert.equal(firstExtraction.length, 2);
  assert.deepEqual(secondExtraction, firstExtraction);
  assert.deepEqual(firstExtraction.map(block => block.headingPath), [
    ['Overview'],
    ['Overview', 'Details']
  ]);
  assert.deepEqual(firstExtraction.map(block => block.language), ['javascript', 'ts']);
  assert.deepEqual(firstExtraction.map(block => block.code), [
    'const fromList = true;\n',
    'const typed: number = 1;\n'
  ]);
  for (const block of firstExtraction) {
    assert.match(block.id, /^code_[a-f0-9]{24}$/);
    assert.equal(block.anchor, `blog-ai-code-${block.id.slice('code_'.length)}`);
    assert.match(block.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(block.sourceLineStart >= 1);
    assert.ok(block.sourceLineEnd >= block.sourceLineStart);
    assert.equal(block.contextChunkIds.length >= 1, true);
    assert.equal(
      block.contextChunkIds.every(id => corpus.chunks.some(chunk => chunk.id === id)),
      true
    );
  }

  const graph = buildLearningGraph(corpus.posts, [{
    id: 'code-track',
    title: 'Code Track',
    aliases: ['code learning'],
    description: 'A test-only author-maintained order.',
    steps: [
      {
        id: 'code-basics',
        slug: 'code-basics',
        level: 'beginner',
        aliases: ['basics']
      },
      {
        id: 'code-advanced',
        slug: 'code-advanced',
        level: 'intermediate',
        aliases: ['advanced']
      }
    ]
  }]);

  assert.equal(graph.policy, 'explicit_author_curated_only');
  assert.deepEqual(graph.tracks.map(track => track.id), ['code-track']);
  assert.deepEqual(graph.tracks[0].nodes.map(node => node.id), [
    'code-basics',
    'code-advanced'
  ]);
  assert.deepEqual(graph.edges.map(edge => edge.relation), [
    'next',
    'prerequisite'
  ]);
  assert.equal(graph.nodes.every(node => node.trackId === 'code-track'), true);
});
