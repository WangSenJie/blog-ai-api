'use strict';

const SAFE_ERROR_CODES = /^[A-Z][A-Z0-9_]{1,80}$/;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeErrorCode(error, fallback) {
  const code = String(error && error.code || '').trim().toUpperCase();
  return SAFE_ERROR_CODES.test(code) ? code : (fallback || 'UNKNOWN_ERROR');
}

function ttlSeconds(expiresAt, now) {
  const expires = Date.parse(String(expiresAt || ''));
  const current = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!Number.isFinite(expires)) return null;
  return Math.max(0, Math.round((expires - current) / 1000));
}

function retrievalMetrics(meta) {
  const source = meta || {};
  const calls = Array.isArray(source.toolCalls) ? source.toolCalls : [];
  const totals = {
    bm25Candidates: 0,
    denseCandidates: 0,
    rrfCandidates: 0,
    rerankerCandidates: 0,
    finalCandidates: finiteNumber(
      source.retrieval && source.retrieval.selectedChunks,
      0
    ),
    embeddingRequests: 0,
    embeddingFailures: 0,
    embedding429: 0,
    embedding5xx: 0,
    embeddingEstimatedCostUsd: 0,
    embeddingCostMeasured: false,
    fallbackCodes: []
  };

  for (const call of calls) {
    const stats = call && call.retrieval && typeof call.retrieval === 'object'
      ? call.retrieval
      : {};
    totals.bm25Candidates += finiteNumber(stats.bm25Candidates, 0);
    totals.denseCandidates += finiteNumber(stats.vectorCandidates, 0);
    totals.rrfCandidates += finiteNumber(stats.fusedCandidates, 0);
    totals.rerankerCandidates += finiteNumber(stats.rerankedCandidates, 0);
    totals.embeddingRequests += finiteNumber(stats.embeddingRequests, 0);
    totals.embeddingFailures += finiteNumber(stats.embeddingFailures, 0);
    totals.embedding429 += finiteNumber(stats.embedding429, 0);
    totals.embedding5xx += finiteNumber(stats.embedding5xx, 0);
    if (
      stats.embeddingEstimatedCostUsd !== null &&
      stats.embeddingEstimatedCostUsd !== undefined &&
      Number.isFinite(Number(stats.embeddingEstimatedCostUsd))
    ) {
      totals.embeddingEstimatedCostUsd += Number(stats.embeddingEstimatedCostUsd);
      totals.embeddingCostMeasured = true;
    }
    if (stats.fallbackCode) totals.fallbackCodes.push(String(stats.fallbackCode));
  }

  totals.fallbackCodes = [...new Set(totals.fallbackCodes)].slice(0, 8);
  totals.embeddingEstimatedCostUsd = totals.embeddingCostMeasured
    ? Number(totals.embeddingEstimatedCostUsd.toFixed(8))
    : null;
  delete totals.embeddingCostMeasured;
  return totals;
}

function memoryMetrics(memory, now) {
  const source = memory || {};
  const writeStatus = String(source.writeStatus || 'not_attempted');
  return {
    status: String(source.status || 'disabled'),
    writeStatus,
    hit: source.status === 'active',
    updateConflict: writeStatus === 'version_conflict' ||
      writeStatus === 'stale_thread',
    idempotencyHit: Boolean(source.replayed) || writeStatus === 'duplicate',
    degraded: source.status === 'degraded',
    ttlSecondsRemaining: ttlSeconds(source.expiresAt, now)
  };
}

function answerMetrics(payload) {
  const source = payload || {};
  const meta = source.meta || {};
  const verification = meta.citationVerification || {};
  const citations = Array.isArray(source.citations) ? source.citations : [];
  const unanswered = Array.isArray(source.unansweredSubquestions)
    ? source.unansweredSubquestions
    : [];
  const claims = Array.isArray(source.claims) ? source.claims : [];
  return {
    published: claims.length > 0 && citations.length > 0,
    refused: claims.length === 0,
    claims: claims.length,
    citations: citations.length,
    unansweredSubquestions: unanswered.length,
    verificationStatus: String(verification.status || 'not_required'),
    verificationReasons: Array.isArray(verification.reasons)
      ? verification.reasons.map(String).slice(0, 8)
      : []
  };
}

function buildAskMetrics(payload, options) {
  const source = payload || {};
  const meta = source.meta || {};
  const model = meta.model || {};
  const timings = meta.timings || {};
  const settings = options || {};
  return {
    traceId: String(meta.traceId || settings.traceId || ''),
    eventVersion: 1,
    route: String(meta.route || 'unknown'),
    mode: String(meta.mode || 'unknown'),
    indexVersion: String(meta.indexVersion || ''),
    releaseFlags: Object.assign({}, settings.releaseFlags || {}),
    retrieval: retrievalMetrics(meta),
    latencyMs: {
      retrieval: finiteNumber(timings.retrievalMs, null),
      generation: finiteNumber(timings.generationMs, null),
      verification: finiteNumber(
        timings.semanticVerificationMs || timings.citationVerificationMs,
        null
      ),
      total: finiteNumber(timings.totalMs, null)
    },
    model: {
      generationAttempted: Boolean(model.generationAttempted || model.attempted),
      generationSchemaValid: Boolean(model.generationSchemaValid),
      verificationAttempted: Boolean(model.verificationAttempted),
      verificationSchemaValid: Boolean(model.verificationSchemaValid),
      accepted: Boolean(model.accepted),
      generationErrorCode: String(model.generationErrorCode || ''),
      verificationErrorCode: String(model.verificationErrorCode || '')
    },
    memory: memoryMetrics(source.memory, settings.now),
    answer: answerMetrics(source)
  };
}

function emitOperationalEvent(logger, name, fields) {
  const sink = logger && typeof logger.info === 'function' ? logger : console;
  sink.info(String(name || 'operational.event'), fields || {});
}

module.exports = {
  answerMetrics,
  buildAskMetrics,
  emitOperationalEvent,
  memoryMetrics,
  retrievalMetrics,
  safeErrorCode,
  ttlSeconds
};
