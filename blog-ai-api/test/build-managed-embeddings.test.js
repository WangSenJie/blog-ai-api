'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  loadSeedVectors
} = require('../../scripts/build-managed-embeddings');

test('managed embedding build can reuse an external complete vector index', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-seed-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seedPath = path.join(directory, 'vectors.json');
  const seed = [{ chunkId: 'chunk_seed', vector: [0.1, 0.2] }];
  fs.writeFileSync(seedPath, JSON.stringify(seed));
  const fallback = [];

  assert.equal(loadSeedVectors('', fallback), fallback);
  assert.deepEqual(loadSeedVectors(seedPath, fallback), seed);

  const invalidPath = path.join(directory, 'invalid.json');
  fs.writeFileSync(invalidPath, '{}');
  assert.throws(
    () => loadSeedVectors(invalidPath, fallback),
    /must contain a JSON array/
  );
});
