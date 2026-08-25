'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCorpus,
  buildIngestionReport,
  buildLearningGraph,
  chunkStructuredSectionV2,
  extractCodeBlocks,
  parseFrontMatter,
  parseMarkdownDocument
} = require('../../scripts/build-ai-corpus');
const {
  buildManifest,
  validateCorpusData
} = require('../lib/corpus-integrity');
const {
  loadProfileRegistry
} = require('../../scripts/rag-chunk-profiles');

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

test('Phase 6 parses nested YAML and preserves Markdown structure before Chunk v2', t => {
  const metadata = parseFrontMatter(`
title: "Structured: Markdown"
date: 2026-08-25
published: true
categories: [AI, RAG]
rag:
  chunk_profile: tutorial
  `, 'fixture.md');

  assert.equal(metadata.title, 'Structured: Markdown');
  assert.equal(metadata.date, '2026-08-25');
  assert.equal(metadata.published, true);
  assert.deepEqual(metadata.categories, ['AI', 'RAG']);
  assert.equal(metadata.rag.chunk_profile, 'tutorial');

  const document = parseMarkdownDocument(`# Structured section

Visible paragraph with [a source](https://example.com).

![architecture diagram](diagram.png)

Figure 1 explains the architecture diagram.

- First complete item
- Second complete item

  \`\`\`js
  const shouldNotEnterProse = true;
  \`\`\`

| Name | Purpose |
| --- | --- |
| Redis | Memory |

Before the formula.
$$
E[X] = \\sum_x xp(x)
$$
After the formula.

> Quoted evidence.

{% note info %}
Callout content remains visible.
{% endnote %}`);

  assert.deepEqual(
    [...new Set(document.blocks.map(block => block.type))].sort(),
    ['callout', 'code', 'formula', 'image', 'list', 'paragraph', 'quote', 'table']
  );
  assert.equal(document.blocks.every(block => (
    block.sourceLines && block.sourceLines.start >= 1 && block.sourceLines.end >= block.sourceLines.start
  )), true);
  assert.match(document.contentText, /图片：architecture diagram/);
  assert.match(document.contentText, /Figure 1 explains the architecture diagram/);
  assert.match(document.contentText, /E\[X\] =/);
  assert.doesNotMatch(document.contentText, /shouldNotEnterProse/);
  assert.match(document.blocks.find(block => block.type === 'list').content, /Second complete item/);
  assert.deepEqual(document.sections[0].headingPath, ['Structured section']);
  assert.match(document.sections[0].sectionAnchor, /^section_[a-f0-9]{16}$/);
});

test('Chunk v2 repeats table headers, keeps formula context, and splits code on lines', () => {
  const header = '| Name | Purpose |';
  const table = [
    header,
    `| first | ${'甲'.repeat(220)} |`,
    `| second | ${'乙'.repeat(220)} |`,
    `| third | ${'丙'.repeat(220)} |`
  ].join('\n');
  const tableChunks = chunkStructuredSectionV2({
    blocks: [{
      type: 'table',
      content: table,
      sourceLines: { start: 10, end: 14 }
    }]
  }, 'faq-reference');

  assert.ok(tableChunks.length > 1);
  assert.equal(tableChunks.every(chunk => chunk.content.startsWith(header)), true);
  assert.equal(tableChunks.every(chunk => chunk.tokenCount <= 384), true);

  const formulaChunks = chunkStructuredSectionV2({
    blocks: [{
      type: 'paragraph',
      content: '下面给出期望的定义。',
      sourceLines: { start: 20, end: 20 }
    }, {
      type: 'formula',
      content: 'E[X] = \\sum_x xp(x)',
      sourceLines: { start: 21, end: 23 }
    }, {
      type: 'paragraph',
      content: '其中求和遍历随机变量的全部取值。',
      sourceLines: { start: 24, end: 24 }
    }]
  }, 'math-note');
  const formulaContext = formulaChunks.find(chunk => chunk.blockTypes.includes('formula'));

  assert.equal(formulaContext.chunkType, 'formula-context');
  assert.match(formulaContext.content, /下面给出期望的定义/);
  assert.match(formulaContext.content, /E\[X\]/);
  assert.match(formulaContext.content, /其中求和遍历/);

  const code = Array.from({ length: 180 }, (_, index) => (
    `const value_${index} = ${index};`
  )).join('\n');
  const codeChunks = chunkStructuredSectionV2({
    blocks: [{
      type: 'code',
      content: code,
      sourceLines: { start: 30, end: 209 }
    }]
  }, 'code-doc');

  assert.ok(codeChunks.length > 1);
  assert.equal(codeChunks.every(chunk => chunk.chunkType === 'code'), true);
  assert.equal(codeChunks.every(chunk => chunk.tokenCount <= 512), true);
  assert.equal(codeChunks.map(chunk => chunk.content).join('\n'), code);
});

test('Chunk v2 IDs for untouched sections survive an unrelated edit', t => {
  const postsDirectory = makeTempDir(t);
  const frontMatter = `
title: Stable IDs
date: 2026-08-25
slug: stable-ids
  `;
  writePost(postsDirectory, 'stable.md', frontMatter, `# First

The first section changes independently.

# Second

The second section must keep its ID.`);
  const before = buildCorpus(postsDirectory);
  const untouchedBefore = before.chunks.find(chunk => chunk.sectionTitle === 'Second');

  writePost(postsDirectory, 'stable.md', frontMatter, `# First

The first section now contains an unrelated edit.

# Second

The second section must keep its ID.`);
  const after = buildCorpus(postsDirectory);
  const untouchedAfter = after.chunks.find(chunk => chunk.sectionTitle === 'Second');

  assert.ok(untouchedBefore);
  assert.ok(untouchedAfter);
  assert.equal(untouchedAfter.id, untouchedBefore.id);
  assert.equal(untouchedAfter.parentId, untouchedBefore.parentId);
  assert.equal(untouchedAfter.contentHash, untouchedBefore.contentHash);
});

test('Phase 6 exports retrievalText, source locations, ingestion diagnostics, and strict hashes', t => {
  const postsDirectory = makeTempDir(t);
  writePost(postsDirectory, 'structured.md', `
title: Structured RAG
date: 2026-08-25
slug: structured-rag
tags: [retrieval]
categories: [AI]
rag:
  chunk_profile: tutorial
  `, `# Retrieval section

The exact source paragraph is preserved for citation.

\`\`\`js
const codeIsSeparate = true;
\`\`\`

$$
x = y + 1
$$`);

  const corpus = buildCorpus(postsDirectory);
  const ingestion = buildIngestionReport(corpus.posts, corpus.chunks, corpus.diagnostics);
  const manifest = buildManifest(corpus.posts, corpus.chunks, corpus.diagnostics, {
    ingestion
  });
  const chunk = corpus.chunks[0];

  assert.equal(corpus.posts[0].chunkProfile, 'tutorial');
  assert.match(chunk.content, /exact source paragraph/);
  assert.doesNotMatch(chunk.content, /codeIsSeparate/);
  assert.match(chunk.retrievalText, /Structured RAG/);
  assert.match(chunk.retrievalText, /Retrieval section/);
  assert.deepEqual(chunk.blockTypes, ['paragraph']);
  assert.deepEqual(chunk.sourceLines, { start: 12, end: 12 });
  const formulaChunk = corpus.chunks.find(item => item.blockTypes.includes('formula'));
  const codeChunk = corpus.chunks.find(item => item.blockTypes.includes('code'));
  assert.equal(formulaChunk.parentId, chunk.parentId);
  assert.equal(formulaChunk.chunkType, 'formula');
  assert.equal(codeChunk.chunkType, 'code');
  assert.match(chunk.parentId, /^parent_[a-f0-9]{24}$/);
  assert.equal(Number.isSafeInteger(chunk.tokenCount), true);
  assert.equal(chunk.tokenizerVersion, 'dashscope-compatible-estimate-v1');
  assert.match(chunk.sectionAnchor, /^section_[a-f0-9]{16}$/);
  assert.equal(ingestion.stats.chunksWithRetrievalText, corpus.chunks.length);
  assert.equal(ingestion.stats.sourceLocatedChunks, corpus.chunks.length);
  assert.equal(ingestion.stats.blockTypeCounts.code, 1);
  assert.equal(ingestion.stats.blockTypeCounts.formula, 1);
  assert.doesNotThrow(() => validateCorpusData(
    corpus.posts,
    corpus.chunks,
    manifest,
    []
  ));

  const tamperedChunks = corpus.chunks.map(item => Object.assign({}, item));
  tamperedChunks[0].retrievalText += '\nforged retrieval text';
  assert.throws(
    () => validateCorpusData(corpus.posts, tamperedChunks, manifest, []),
    /content hash is invalid/
  );
});

test('Phase 6 resolves author profiles by fixed priority and standardizes internal links', t => {
  const rootDirectory = makeTempDir(t);
  const postsDirectory = path.join(rootDirectory, 'posts');
  const mathDirectory = path.join(postsDirectory, 'math');
  const configDirectory = path.join(rootDirectory, 'config');
  fs.mkdirSync(mathDirectory, { recursive: true });
  fs.mkdirSync(configDirectory, { recursive: true });
  const configPath = path.join(configDirectory, 'rag-chunk-profiles.yml');
  fs.writeFileSync(configPath, `version: 1
defaultProfile: generic-article
pathRules:
  - glob: posts/math/**/*.md
    profile: math-note
documents:
  posts/math/exact.md: faq-reference
`, 'utf8');

  writePost(mathDirectory, 'front-matter.md', `
title: Front Matter Profile
date: 2026-08-21
rag:
  chunk_profile: tutorial
  `, 'The front matter declaration wins.');
  writePost(mathDirectory, 'exact.md', `
title: Exact Profile
date: 2026-08-22
  `, '[Read the generic article](../generic.md).');
  writePost(mathDirectory, 'path-rule.md', `
title: Path Profile
date: 2026-08-23
  `, 'The directory rule applies.');
  writePost(postsDirectory, 'generic.md', `
title: Fallback Profile
date: 2026-08-24
  `, 'The migration fallback is explicit in diagnostics.');

  const profileRegistry = loadProfileRegistry(configPath, { rootDir: rootDirectory });
  const corpus = buildCorpus(postsDirectory, { profileRegistry });
  const profiles = Object.fromEntries(corpus.posts.map(post => [post.title, [
    post.chunkProfile,
    post.profileSource
  ]]));
  const ingestion = buildIngestionReport(corpus.posts, corpus.chunks, corpus.diagnostics);

  assert.deepEqual(profiles, {
    'Fallback Profile': ['generic-article', 'migration-fallback'],
    'Exact Profile': ['faq-reference', 'document-rule'],
    'Front Matter Profile': ['tutorial', 'front-matter'],
    'Path Profile': ['math-note', 'path-rule']
  });
  assert.deepEqual(corpus.diagnostics.postsWithoutDeclaredProfile, ['posts/generic.md']);
  assert.equal(ingestion.stats.internalLinkEdges, 1);
  assert.equal(ingestion.stats.resolvedInternalLinkEdges, 1);
  const exactPost = corpus.posts.find(post => post.title === 'Exact Profile');
  assert.deepEqual(exactPost.internalLinks[0], {
    sourcePostId: 'Exact Profile',
    sourceUrl: exactPost.url,
    targetPostId: 'Fallback Profile',
    targetUrl: corpus.posts.find(post => post.title === 'Fallback Profile').url,
    targetSourcePath: 'posts/generic.md',
    label: 'Read the generic article',
    anchor: '',
    resolved: true
  });
});
