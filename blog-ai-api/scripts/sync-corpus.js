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
const manifest = readJson(sourceManifestPath);

verifyManifestFiles(manifest, {
  postsPath: sourcePostsPath,
  chunksPath: sourceChunksPath
});
validateCorpusData(
  readJson(sourcePostsPath),
  readJson(sourceChunksPath),
  manifest
);

const postsPath = copyFile('posts.json');
const chunksPath = copyFile('chunks.json');
const manifestPath = copyFile('manifest.json');

verifyManifestFiles(readJson(manifestPath), { postsPath, chunksPath });

console.log(`Synced corpus to ${targetDataDir}`);
console.log(`Posts file: ${postsPath}`);
console.log(`Chunks file: ${chunksPath}`);
console.log(`Manifest file: ${manifestPath}`);
