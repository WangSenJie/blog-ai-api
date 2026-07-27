'use strict';

const fs = require('fs');
const path = require('path');
const {
  validateCorpusData,
  verifyManifestFiles
} = require('../lib/corpus-integrity');

const apiRoot = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(apiRoot, '..');
const sourceDataDir = path.join(sourceRoot, 'data');
const targetDataDir = path.join(apiRoot, 'data');

function copyFile(name) {
  fs.mkdirSync(targetDataDir, { recursive: true });

  const sourcePath = path.join(sourceDataDir, name);
  const targetPath = path.join(targetDataDir, name);

  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const sourcePostsPath = path.join(sourceDataDir, 'posts.json');
const sourceChunksPath = path.join(sourceDataDir, 'chunks.json');
const sourceManifestPath = path.join(sourceDataDir, 'manifest.json');
const sourceVectorsPath = path.join(sourceDataDir, 'vectors.json');
const sourceCodeBlocksPath = path.join(sourceDataDir, 'code-blocks.json');
const sourceLearningGraphPath = path.join(sourceDataDir, 'learning-graph.json');
const manifest = readJson(sourceManifestPath);

verifyManifestFiles(manifest, {
  postsPath: sourcePostsPath,
  chunksPath: sourceChunksPath,
  vectorsPath: sourceVectorsPath,
  codeBlocksPath: sourceCodeBlocksPath,
  learningGraphPath: sourceLearningGraphPath
});
validateCorpusData(
  readJson(sourcePostsPath),
  readJson(sourceChunksPath),
  manifest,
  manifest.schemaVersion >= 2 ? readJson(sourceVectorsPath) : [],
  manifest.schemaVersion >= 3
    ? {
      codeBlocks: readJson(sourceCodeBlocksPath),
      learningGraph: readJson(sourceLearningGraphPath)
    }
    : undefined
);

const postsPath = copyFile('posts.json');
const chunksPath = copyFile('chunks.json');
const manifestPath = copyFile('manifest.json');
const vectorsPath = manifest.schemaVersion >= 2 ? copyFile('vectors.json') : '';
const codeBlocksPath = manifest.schemaVersion >= 3 ? copyFile('code-blocks.json') : '';
const learningGraphPath = manifest.schemaVersion >= 3 ? copyFile('learning-graph.json') : '';

verifyManifestFiles(readJson(manifestPath), {
  postsPath,
  chunksPath,
  vectorsPath,
  codeBlocksPath,
  learningGraphPath
});

console.log(`Synced corpus to ${targetDataDir}`);
console.log(`Posts file: ${postsPath}`);
console.log(`Chunks file: ${chunksPath}`);
console.log(`Manifest file: ${manifestPath}`);
if (vectorsPath) console.log(`Vectors file: ${vectorsPath}`);
if (codeBlocksPath) console.log(`Code blocks file: ${codeBlocksPath}`);
if (learningGraphPath) console.log(`Learning graph file: ${learningGraphPath}`);
