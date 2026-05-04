'use strict';

const fs = require('fs');
const path = require('path');

const apiRoot = process.cwd();
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

const postsPath = copyFile('posts.json');
const chunksPath = copyFile('chunks.json');

console.log(`Synced corpus to ${targetDataDir}`);
console.log(`Posts file: ${postsPath}`);
console.log(`Chunks file: ${chunksPath}`);
