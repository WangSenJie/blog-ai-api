'use strict';

const fs = require('fs');
const path = require('path');

const { buildCorpus } = require('./build-ai-corpus');

const rootDir = process.cwd();
const postsDir = path.join(rootDir, 'source', '_posts');
const dataOutputDir = path.join(rootDir, 'data');
const publishOutputDir = path.join(rootDir, 'source', 'ai-data');

const corpus = buildCorpus(postsDir);

function writeJson(outputDir, filename, value) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(value, null, 2), 'utf8');
  return outputPath;
}

const postsOutputPath = writeJson(dataOutputDir, 'posts.json', corpus.posts);
const chunksOutputPath = writeJson(dataOutputDir, 'chunks.json', corpus.chunks);
const publishedPostsPath = writeJson(publishOutputDir, 'posts.json', corpus.posts);
const publishedChunksPath = writeJson(publishOutputDir, 'chunks.json', corpus.chunks);

console.log(`Exported ${corpus.posts.length} posts`);
console.log(`Exported ${corpus.chunks.length} chunks`);
console.log(`Data posts file: ${postsOutputPath}`);
console.log(`Data chunks file: ${chunksOutputPath}`);
console.log(`Published posts file: ${publishedPostsPath}`);
console.log(`Published chunks file: ${publishedChunksPath}`);
