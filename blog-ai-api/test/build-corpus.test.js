'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildCorpus } = require('../../scripts/build-ai-corpus');

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
  assert.deepEqual(corpus.diagnostics.postsWithoutIndexableContent, ['PDF Only']);
  assert.deepEqual(
    [...new Set(corpus.chunks.map(chunk => chunk.postTitle))],
    ['Published Post']
  );

  const pdfOnlyPost = corpus.posts.find(post => post.title === 'PDF Only');
  assert.equal(corpus.posts.some(post => post.title === 'Missing URL'), false);
  assert.match(pdfOnlyPost.url, /\/2026\/07\/06\/pdf-only\/$/);
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
