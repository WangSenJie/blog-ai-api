'use strict';

const {
  canUseModel,
  generateGroundedAnswer
} = require('../lib/generate');
const {
  createAgentTools
} = require('../tools');
const {
  AGENT_LIMITS,
  estimatedGenerationCost,
  estimateTokens,
  snapshotBudget
} = require('./config');
const {
  createAgentState
} = require('./state');
const {
  buildDeterministicResponse
} = require('./nodes/generate-answer');
const {
  gradeEvidence,
  selectContext
} = require('./nodes/grade-evidence');
const {
  AgentDeadlineError,
  retrieveEvidence
} = require('./nodes/retrieve');
const {
  rewriteForRetry,
  rewriteStandaloneQuery,
  splitStandaloneQuery
} = require('./nodes/rewrite-query');
const {
  ROUTES,
  routeQuestion
} = require('./nodes/route');

function traceStart(trace) {
  return trace && typeof trace.start === 'function' ? trace.start() : null;
}

function traceEnd(trace, name, startedAt) {
  if (
    startedAt !== null &&
    trace &&
    typeof trace.end === 'function'
  ) {
    trace.end(name, startedAt);
  }
}

function responseMode(route) {
  if (route === ROUTES.PAGE_SUMMARY) return 'page_summary';
  if (route === ROUTES.PAGE_QA) return 'page';
  return 'site';
}

function finishPayload(state) {
  const retrievalStrategies = [...new Set(
    state.toolCalls
      .map(call => String(call.strategy || '').trim())
      .filter(Boolean)
  )];
  const retrievalStrategy = state.retrievalAttempts === 0
    ? 'none'
    : retrievalStrategies.includes('hybrid_rrf_rerank')
      ? 'hybrid_rrf_rerank'
      : state.subqueries.length > 1 || state.retrievalAttempts > 1
        ? 'bm25_multi_query'
        : retrievalStrategies[0] || 'bm25';
  return {
    answer: state.answer,
    citations: state.citations,
    related: state.related,
    meta: {
      mode: responseMode(state.route),
      route: state.route,
      standaloneQuery: state.standaloneQuery,
      subqueries: state.subqueries.slice(),
      sessionId: state.sessionId,
      retrievalAttempts: state.retrievalAttempts,
      evidenceStatus: state.evidenceStatus,
      evidenceReason: state.evidenceReason,
      evidenceGrading: 'structural_heuristic',
      stopReason: state.stopReason,
      retrieval: {
        strategy: retrievalStrategy,
        toolStrategies: retrievalStrategies,
        candidates: state.retrievedChunks.length,
        selectedChunks: state.selectedChunks.length
      },
      toolCalls: state.toolCalls.slice(),
      budget: snapshotBudget(state.budget),
      model: Object.assign({}, state.model),
      llmFallback: state.llmFallback,
      compatibilityWarnings: state.compatibilityWarnings.slice()
    }
  };
}

async function maybeGenerateWithModel(state, dependencies, trace) {
  if (
    state.evidenceStatus !== 'sufficient' ||
    !state.selectedChunks.length ||
    !dependencies.canUseModel() ||
    state.budget.used.modelCalls >= state.budget.limits.maxModelCalls
  ) {
    return;
  }

  const historyCharacters = state.messages
    .slice(-6)
    .reduce((total, message) => total + String(message.content || '').length, 0);
  const pageCharacters = state.page
    ? String(state.page.title || '').length +
      String(state.page.url || '').length +
      String(state.page.description || '').length
    : 0;
  state.budget.used.estimatedGenerationInputTokens = estimateTokens(
    state.budget.used.contextChars +
    historyCharacters +
    pageCharacters +
    String(state.question || '').length +
    String(state.standaloneQuery || '').length +
    2000
  );

  const reservedCost = estimatedGenerationCost(state.budget);
  if (
    reservedCost !== null &&
    reservedCost > state.budget.cost.maxUsd
  ) {
    state.model.skipped = 'cost_budget';
    state.stopReason = 'cost_budget_exhausted';
    return;
  }
  if (reservedCost !== null) {
    state.budget.cost.reservedEstimatedUsd = reservedCost;
  }

  if (Date.now() >= state.deadlineAtMs) {
    state.model.skipped = 'deadline';
    state.stopReason = 'deadline';
    return;
  }
  state.model.attempted = true;
  state.budget.used.modelCalls += 1;
  const generationStartedAt = traceStart(trace);
  const controller = new AbortController();
  let timeoutId;

  try {
    const remainingMs = Math.max(1, state.deadlineAtMs - Date.now());
    const timeoutMs = Math.min(
      state.budget.limits.generationTimeoutMs,
      remainingMs
    );
    const generation = Promise.resolve(dependencies.generate({
        question: state.question,
        standaloneQuery: state.standaloneQuery,
        route: state.route,
        page: state.page,
        messages: state.messages,
        evidence: state.selectedChunks
      }, {
        signal: controller.signal,
        timeoutMs,
        maxOutputTokens: state.budget.limits.maxOutputTokens
      }));
    const timeout = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new AgentDeadlineError('Generation timed out'));
      }, timeoutMs);
    });
    const generated = await Promise.race([generation, timeout]);

    if (generated) {
      state.answer = generated;
      state.model.answered = true;
    }
  } catch (error) {
    state.llmFallback = true;
    if (typeof dependencies.onModelError === 'function') {
      dependencies.onModelError(error);
    }
  } finally {
    clearTimeout(timeoutId);
    traceEnd(trace, 'generationMs', generationStartedAt);
  }
}

async function runAgent(input, options) {
  const settings = options || {};
  const corpus = settings.corpus;
  if (
    !corpus ||
    !Array.isArray(corpus.posts) ||
    !Array.isArray(corpus.chunks)
  ) {
    throw new TypeError('runAgent requires a corpus with posts and chunks');
  }

  const limits = Object.assign({}, AGENT_LIMITS, settings.limits || {});
  const trace = settings.trace || null;
  const dependencies = {
    canUseModel: settings.canUseModel || canUseModel,
    generate: settings.generate || generateGroundedAnswer,
    onModelError: settings.onModelError
  };
  const tools = settings.tools || createAgentTools(corpus);
  const state = createAgentState(input, {
    corpus,
    indexVersion: settings.indexVersion,
    limits,
    costControls: settings.costControls
  });

  let startedAt = traceStart(trace);
  state.route = routeQuestion(state);
  traceEnd(trace, 'routeMs', startedAt);

  if (state.route === ROUTES.DIRECT) {
    state.evidenceStatus = 'not_required';
    state.evidenceReason = 'direct_response';
    state.stopReason = 'direct_response';
    const direct = buildDeterministicResponse(state);
    Object.assign(state, direct);
    return finishPayload(state);
  }

  startedAt = traceStart(trace);
  const rewritten = rewriteStandaloneQuery(state);
  Object.assign(state, rewritten);
  if (
    state.resolvedArticleRefs[0] &&
    [
      ROUTES.PAGE_SUMMARY,
      ROUTES.PAGE_QA,
      ROUTES.RELATED_ARTICLES
    ].includes(state.route)
  ) {
    state.page = {
      title: state.resolvedArticleRefs[0].title,
      url: state.resolvedArticleRefs[0].url,
      description: ''
    };
  }
  const split = splitStandaloneQuery(state, corpus.posts);
  state.subqueries = split.subqueries;
  state.targetQueries = split.targetQueries;
  state.budget.used.subqueries = state.subqueries.length;
  traceEnd(trace, 'rewriteMs', startedAt);

  if (state.needsClarification) {
    state.evidenceStatus = 'insufficient';
    state.evidenceReason = state.clarificationReason;
    state.stopReason = 'clarification_required';
  } else {
    let queries = state.subqueries.slice();
    const retrievalWorkflowStartedAt = traceStart(trace);

    while (
      state.retrievalAttempts < limits.maxRetrievalAttempts &&
      state.budget.used.toolCalls < limits.maxToolCalls
    ) {
      const attempt = state.retrievalAttempts + 1;
      state.retrievalAttempts = attempt;
      state.budget.used.retrievalAttempts = attempt;
      state.budget.used.subqueries = Math.max(
        state.budget.used.subqueries,
        queries.length
      );

      try {
        startedAt = traceStart(trace);
        state.retrievedChunks = await retrieveEvidence(
          state,
          tools,
          queries.slice(0, limits.maxSubqueries),
          attempt
        );
        traceEnd(trace, `retrievalAttempt${attempt}Ms`, startedAt);
      } catch (error) {
        traceEnd(trace, `retrievalAttempt${attempt}Ms`, startedAt);
        if (!(error instanceof AgentDeadlineError)) throw error;
        state.evidenceStatus = 'insufficient';
        state.evidenceReason = 'agent_deadline_exceeded';
        state.stopReason = 'deadline';
        break;
      }

      startedAt = traceStart(trace);
      const grade = gradeEvidence(state);
      state.evidenceStatus = grade.status;
      state.evidenceReason = grade.reason;
      traceEnd(trace, `gradeEvidenceAttempt${attempt}Ms`, startedAt);

      if (grade.status === 'sufficient') {
        state.stopReason = 'evidence_sufficient';
        break;
      }
      if (attempt >= limits.maxRetrievalAttempts) {
        state.stopReason = 'attempt_limit';
        break;
      }

      const retryQueries = rewriteForRetry(state);
      if (!retryQueries.length) {
        state.stopReason = 'no_new_query';
        break;
      }
      queries = retryQueries.slice(0, limits.maxSubqueries);
    }
    traceEnd(trace, 'retrievalMs', retrievalWorkflowStartedAt);
  }

  if (!state.stopReason) {
    state.stopReason = state.evidenceStatus === 'sufficient'
      ? 'evidence_sufficient'
      : 'tool_budget_exhausted';
  }

  state.selectedChunks = state.evidenceStatus === 'sufficient'
    ? selectContext(state)
    : [];

  startedAt = traceStart(trace);
  const deterministic = buildDeterministicResponse(state);
  Object.assign(state, deterministic);
  traceEnd(trace, 'buildResponseMs', startedAt);

  await maybeGenerateWithModel(state, dependencies, trace);
  return finishPayload(state);
}

module.exports = {
  finishPayload,
  responseMode,
  runAgent
};
