'use strict';

const { createHash } = require('crypto');
const { getReleaseFlags } = require('../lib/release-flags');

const AGENT_LIMITS = Object.freeze({
  maxRetrievalAttempts: 2,
  maxSubqueries: 3,
  maxToolCalls: 6,
  maxContextChunks: 8,
  maxContextChars: 12000,
  maxContextTokens: 6000,
  maxModelCalls: 2,
  maxOutputTokens: 700,
  maxStandaloneQueryChars: 1000,
  maxSubqueryChars: 500,
  overallTimeoutMs: 17000,
  retrievalRoundTimeoutMs: 1500,
  generationTimeoutMs: 7000,
  verificationTimeoutMs: 5000
});

// These values are selected by the Phase 4 offline calibration runner. They
// are retrieval/evidence gates, not probabilities or user-facing confidence.
const EVIDENCE_CALIBRATION = Object.freeze({
  version: 'phase10-topic-anchor-v1',
  vectorEvidenceFloor: 0.3,
  siteQaMinCoverage: 0.3,
  pageQaMinCoverage: 0.35,
  compoundMinCoverage: 0.3,
  compareTargetMinCoverage: 0.45,
  topicAnchorMinCoverage: 0.5
});

function createEvidenceCalibration(overrides) {
  const settings = Object.assign({}, EVIDENCE_CALIBRATION, overrides || {});
  for (const key of [
    'vectorEvidenceFloor',
    'siteQaMinCoverage',
    'pageQaMinCoverage',
    'compoundMinCoverage',
    'compareTargetMinCoverage',
    'topicAnchorMinCoverage'
  ]) {
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(`Invalid evidence calibration value: ${key}`);
    }
    settings[key] = value;
  }
  settings.version = String(settings.version || EVIDENCE_CALIBRATION.version);
  return settings;
}

function estimateTokens(value) {
  const characters = typeof value === 'number'
    ? Math.max(0, value)
    : Array.from(String(value || '')).length;
  return Math.ceil(characters);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function enabledValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value === undefined ? '' : value).trim().toLowerCase()
  );
}

function rolloutPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function getAgentLimits(environment, overrides) {
  const source = environment || process.env;
  const configured = Object.assign({}, AGENT_LIMITS, {
    retrievalRoundTimeoutMs: boundedInteger(
      source.RETRIEVAL_ROUND_TIMEOUT_MS,
      AGENT_LIMITS.retrievalRoundTimeoutMs,
      500,
      5000
    ),
    verificationTimeoutMs: boundedInteger(
      source.VERIFIER_TIMEOUT_MS,
      AGENT_LIMITS.verificationTimeoutMs,
      1000,
      6000
    )
  });
  return Object.assign(configured, overrides || {});
}

function stableRollout(key, percent) {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const digest = createHash('sha256')
    .update(String(key || 'anonymous-request'))
    .digest();
  return digest.readUInt32BE(0) / 0x100000000 * 100 < percent;
}

function phase10Features(environment, rolloutKey, overrides) {
  const source = environment || process.env;
  const settings = overrides || {};
  const releaseFlags = getReleaseFlags(source);
  const synthesisConfigured = settings.groundedSynthesisEnabled === undefined
    ? releaseFlags.naturalAnswerV2Enabled
    : Boolean(settings.groundedSynthesisEnabled);
  const verificationConfigured = settings.semanticVerificationEnabled === undefined
    ? releaseFlags.semanticVerifierEnabled
    : Boolean(settings.semanticVerificationEnabled);
  const percent = rolloutPercent(
    settings.groundedSynthesisRolloutPercent === undefined
      ? source.GROUNDED_SYNTHESIS_ROLLOUT_PERCENT
      : settings.groundedSynthesisRolloutPercent,
    100
  );
  const selected = stableRollout(rolloutKey, percent);

  return {
    groundedSynthesisEnabled: synthesisConfigured &&
      verificationConfigured &&
      selected,
    semanticVerificationEnabled: synthesisConfigured &&
      verificationConfigured &&
      selected,
    synthesisConfigured,
    verificationConfigured,
    rolloutPercent: percent,
    rolloutSelected: selected
  };
}

function getCostControls(environment) {
  const source = environment || process.env;
  const maxUsd = positiveNumber(source.LLM_MAX_REQUEST_COST_USD);
  const inputUsdPerMillion = positiveNumber(
    source.LLM_INPUT_COST_PER_MILLION_TOKENS
  );
  const outputUsdPerMillion = positiveNumber(
    source.LLM_OUTPUT_COST_PER_MILLION_TOKENS
  );

  return {
    configured: Boolean(maxUsd && inputUsdPerMillion && outputUsdPerMillion),
    maxUsd,
    inputUsdPerMillion,
    outputUsdPerMillion
  };
}

function createBudget(limits, costControls) {
  const settings = Object.assign({}, AGENT_LIMITS, limits);
  const cost = Object.assign(
    {},
    getCostControls(),
    costControls || {}
  );

  return {
    limits: settings,
    used: {
      retrievalAttempts: 0,
      subqueries: 0,
      toolCalls: 0,
      contextChunks: 0,
      contextChars: 0,
      estimatedContextTokens: 0,
      estimatedGenerationInputTokens: 0,
      modelCalls: 0
    },
    tokenEstimation: 'one_token_per_character_conservative_estimate',
    cost: {
      configured: Boolean(cost.configured),
      maxUsd: cost.configured ? cost.maxUsd : null,
      inputUsdPerMillion: cost.configured
        ? cost.inputUsdPerMillion
        : null,
      outputUsdPerMillion: cost.configured
        ? cost.outputUsdPerMillion
        : null,
      reservedEstimatedUsd: 0
    }
  };
}

function estimatedGenerationCost(budget) {
  if (!budget.cost.configured) return null;
  const input = (
    budget.used.estimatedGenerationInputTokens *
    budget.cost.inputUsdPerMillion
  ) / 1000000;
  const output = (
    budget.limits.maxOutputTokens *
    budget.cost.outputUsdPerMillion
  ) / 1000000;
  return Number((input + output).toFixed(8));
}

function snapshotBudget(budget) {
  return {
    limits: Object.assign({}, budget.limits),
    used: Object.assign({}, budget.used),
    tokenEstimation: budget.tokenEstimation,
    cost: Object.assign({}, budget.cost)
  };
}

module.exports = {
  AGENT_LIMITS,
  EVIDENCE_CALIBRATION,
  createEvidenceCalibration,
  createBudget,
  enabledValue,
  estimatedGenerationCost,
  estimateTokens,
  getAgentLimits,
  getCostControls,
  phase10Features,
  rolloutPercent,
  snapshotBudget
};
