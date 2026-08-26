'use strict';

function enabledValue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function explicitlyConfigured(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key) &&
    String(source[key] === undefined ? '' : source[key]).trim() !== '';
}

function flag(source, key, fallback) {
  return explicitlyConfigured(source, key)
    ? enabledValue(source[key])
    : Boolean(fallback);
}

function getReleaseFlags(environment) {
  const source = environment || process.env;
  const legacyChunkSelected = String(source.RAG_CHUNK_SCHEMA || '')
    .trim()
    .toLowerCase() === 'legacy-v3';
  const bm25Selected = String(source.RAG_RETRIEVAL_MODE || '')
    .trim()
    .toLowerCase() === 'bm25';
  const legacyNaturalAnswer = enabledValue(source.GROUNDED_SYNTHESIS_ENABLED);
  const legacySemanticVerifier = enabledValue(
    source.SEMANTIC_VERIFICATION_ENABLED
  );

  return Object.freeze({
    ragChunkV2Enabled: flag(
      source,
      'RAG_CHUNK_V2_ENABLED',
      !legacyChunkSelected
    ),
    remoteEmbeddingEnabled: flag(
      source,
      'REMOTE_EMBEDDING_ENABLED',
      !bm25Selected
    ),
    semanticRerankerEnabled: flag(
      source,
      'SEMANTIC_RERANKER_ENABLED',
      true
    ),
    memoryV1Enabled: flag(
      source,
      'MEMORY_V1_ENABLED',
      enabledValue(source.MEMORY_ENABLED)
    ),
    naturalAnswerV2Enabled: flag(
      source,
      'NATURAL_ANSWER_V2_ENABLED',
      legacyNaturalAnswer
    ),
    semanticVerifierEnabled: flag(
      source,
      'SEMANTIC_VERIFIER_ENABLED',
      legacySemanticVerifier
    )
  });
}

function publicReleaseFlags(environment) {
  const flags = getReleaseFlags(environment);
  return {
    ragChunkV2: flags.ragChunkV2Enabled,
    remoteEmbedding: flags.remoteEmbeddingEnabled,
    semanticReranker: flags.semanticRerankerEnabled,
    memoryV1: flags.memoryV1Enabled,
    naturalAnswerV2: flags.naturalAnswerV2Enabled,
    semanticVerifier: flags.semanticVerifierEnabled
  };
}

module.exports = {
  enabledValue,
  getReleaseFlags,
  publicReleaseFlags
};
