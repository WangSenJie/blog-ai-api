'use strict';

const fs = require('fs');
const path = require('path');

let cachedCorpus = null;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCorpus() {
  if (cachedCorpus) return cachedCorpus;

  const dataDir = path.join(process.cwd(), 'data');
  const postsPath = path.join(dataDir, 'posts.json');
  const chunksPath = path.join(dataDir, 'chunks.json');

  const posts = readJson(postsPath);
  const chunks = readJson(chunksPath);

  cachedCorpus = { posts, chunks };
  return cachedCorpus;
}

module.exports = {
  loadCorpus
};
