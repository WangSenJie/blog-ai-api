'use strict';

const fs = require('fs');
const path = require('path');

const { buildCorpus } = require('./build-ai-corpus');
const {
  buildManifest,
  serializeJson,
  validateCorpusData
} = require('../blog-ai-api/lib/corpus-integrity');

const rootDir = process.cwd();
const postsDir = path.join(rootDir, 'source', '_posts');
const dataOutputDir = path.join(rootDir, 'data');
const publishOutputDir = path.join(rootDir, 'source', 'ai-data');
const retrievalCorePath = path.join(rootDir, 'blog-ai-api', 'lib', 'retrieval-core.js');
const browserRetrievalPath = path.join(rootDir, 'source', 'js', 'blog-ai-retrieval.js');

const corpus = buildCorpus(postsDir);

function serializePost(post) {
  return {
    id: post.id,
    title: post.title,
    date: post.date,
    description: post.description || '',
    tags: post.tags || [],
    categories: post.categories || [],
    slug: post.slug,
    url: post.url
  };
}

function writeJson(outputDir, filename, value) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, serializeJson(value), 'utf8');
  return outputPath;
}

const publicPosts = corpus.posts.map(serializePost);
validateCorpusData(publicPosts, corpus.chunks);
const manifest = buildManifest(publicPosts, corpus.chunks, corpus.diagnostics);
const postsOutputPath = writeJson(dataOutputDir, 'posts.json', publicPosts);
const chunksOutputPath = writeJson(dataOutputDir, 'chunks.json', corpus.chunks);
const manifestOutputPath = writeJson(dataOutputDir, 'manifest.json', manifest);
const publishedPostsPath = writeJson(publishOutputDir, 'posts.json', publicPosts);
const publishedChunksPath = writeJson(publishOutputDir, 'chunks.json', corpus.chunks);
const publishedManifestPath = writeJson(publishOutputDir, 'manifest.json', manifest);

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
console.log(`Data posts file: ${postsOutputPath}`);
console.log(`Data chunks file: ${chunksOutputPath}`);
console.log(`Data manifest file: ${manifestOutputPath}`);
console.log(`Published posts file: ${publishedPostsPath}`);
console.log(`Published chunks file: ${publishedChunksPath}`);
console.log(`Published manifest file: ${publishedManifestPath}`);
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
