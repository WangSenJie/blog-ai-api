'use strict';

const {
  buildVectorIndex,
  embeddingMetadata
} = require('../lib/embedding');

function hasOfflineIndex(corpus) {
  const embedding = corpus && corpus.manifest && corpus.manifest.embedding;
  const expected = embeddingMetadata();
  const vectors = corpus && corpus.vectors;
  const vectorMetadataMatches = Array.isArray(vectors) &&
    Array.isArray(corpus && corpus.chunks) &&
    vectors.length === corpus.chunks.length &&
    vectors.every(vector => (
      vector &&
      vector.fingerprint === expected.fingerprint &&
      Array.isArray(vector.values) &&
      vector.values.length === expected.dimensions
    ));
  return Boolean(
    vectorMetadataMatches &&
    (!embedding || (
      embedding.provider === expected.provider &&
      embedding.fingerprint === expected.fingerprint
    ))
  );
}

function createOfflineEvaluationCorpus(corpus) {
  if (!corpus || !Array.isArray(corpus.chunks)) {
    throw new TypeError('Offline evaluation requires a corpus with chunks');
  }
  if (hasOfflineIndex(corpus)) return corpus;

  const result = buildVectorIndex(corpus.chunks, []);
  return Object.assign({}, corpus, {
    vectors: result.vectors,
    manifest: Object.assign({}, corpus.manifest || {}, {
      embedding: result.embedding
    })
  });
}

module.exports = {
  createOfflineEvaluationCorpus,
  hasOfflineIndex
};
