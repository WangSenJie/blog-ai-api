'use strict';

const AGENT_LIMITS = Object.freeze({
  maxRetrievalAttempts: 2,
  maxSubqueries: 3,
  maxToolCalls: 6,
  maxContextChunks: 8,
  maxContextChars: 12000,
  maxContextTokens: 6000,
  maxModelCalls: 1,
  maxOutputTokens: 700,
  maxStandaloneQueryChars: 1000,
  maxSubqueryChars: 500,
  overallTimeoutMs: 17000,
  retrievalRoundTimeoutMs: 1200,
  generationTimeoutMs: 10000
});

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
  createBudget,
  estimatedGenerationCost,
  estimateTokens,
  getCostControls,
  snapshotBudget
};
