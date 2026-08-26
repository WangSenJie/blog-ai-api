'use strict';

const {
  canUseModel,
  canUseVerifier,
  generateGroundedAnswer,
  generateGroundedV2Answer,
  getModelDiagnostic,
  verifyGroundedAnswer
} = require('../lib/generate');
const {
  hasExplicitMemoryIntent,
  sanitizeMemoryDelta
} = require('../memory/trusted-update');
const {
  createAgentTools
} = require('../tools');
const {
  AGENT_LIMITS,
  createEvidenceCalibration,
  estimatedGenerationCost,
  estimateTokens,
  getAgentLimits,
  phase10Features,
  snapshotBudget
} = require('./config');
const {
  createAgentState
} = require('./state');
const {
  buildDeterministicResponse
} = require('./nodes/generate-answer');
const {
  notRequiredVerification,
  verifyGroundedV2Response,
  verifyStructuredResponse
} = require('./nodes/verify-citations');
const {
  gradeEvidence,
  selectContext
} = require('./nodes/grade-evidence');
const {
  AgentDeadlineError,
  retrieveEvidence
} = require('./nodes/retrieve');
const {
  buildSubquestionPlan,
  rewriteForRetry,
  rewriteStandaloneQuery,
  splitStandaloneQuery
} = require('./nodes/rewrite-query');
const {
  createPhase5Request
} = require('./nodes/phase5-request');
const {
  ROUTES,
  routeQuestion
} = require('./nodes/route');

const INTERNAL_MEMORY_DELTA = Symbol('internalMemoryDelta');

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

function isSpecialistRoute(route) {
  return [
    ROUTES.RELATED_ARTICLES,
    ROUTES.ARTICLE_COMPARE,
    ROUTES.LEARNING_PATH,
    ROUTES.CODE_EXPLANATION
  ].includes(route);
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
  const payload = {
    answer: state.answer,
    citations: state.citations,
    claims: state.claims,
    unansweredSubquestions: state.unansweredSubquestions,
    related: state.related,
    comparison: state.comparison,
    learningPath: state.learningPath,
    codeExplanation: state.codeExplanation,
    meta: {
      mode: responseMode(state.route),
      route: state.route,
      standaloneQuery: state.standaloneQuery,
      subqueries: state.subqueries.slice(),
      sessionId: state.sessionId,
      retrievalAttempts: state.retrievalAttempts,
      evidenceStatus: state.evidenceStatus,
      evidenceReason: state.evidenceReason,
      evidenceGrading: state.phase10.groundedSynthesisEnabled
        ? 'topic_directness_v2'
        : 'calibrated_structural_v1',
      evidenceCalibration: {
        version: state.evidenceCalibration && state.evidenceCalibration.version,
        score: state.evidenceScore,
        threshold: state.evidenceThreshold,
        features: Object.assign({}, state.evidenceFeatures)
      },
      citationVerification: state.citationVerification,
      stopReason: state.stopReason,
      retrieval: {
        strategy: retrievalStrategy,
        toolStrategies: retrievalStrategies,
        candidates: state.retrievedChunks.length,
        selectedChunks: state.selectedChunks.length
      },
      phase5: {
        comparison: Boolean(state.comparison),
        learningPath: Boolean(state.learningPath),
        codeExplanation: Boolean(state.codeExplanation)
      },
      toolCalls: state.toolCalls.slice(),
      budget: snapshotBudget(state.budget),
      model: Object.assign({}, state.model),
      phase10: Object.assign({}, state.phase10, {
        subquestions: state.subquestionPlan.map(item => Object.assign({}, item)),
        evidenceAssignments: state.evidenceAssignments.map(item => Object.assign({}, item))
      }),
      llmFallback: state.llmFallback,
      compatibilityWarnings: state.compatibilityWarnings.slice()
    }
  };
  Object.defineProperty(payload, INTERNAL_MEMORY_DELTA, {
    value: state.memoryDelta,
    enumerable: false
  });
  return payload;
}

async function maybeGenerateWithModel(state, dependencies, trace) {
  if (
    isSpecialistRoute(state.route) ||
    state.evidenceStatus !== 'sufficient' ||
    !state.selectedChunks.length ||
    !dependencies.canUseModel() ||
    state.budget.used.modelCalls >= state.budget.limits.maxModelCalls
  ) {
    if (isSpecialistRoute(state.route)) state.model.skipped = 'specialist_deterministic';
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
      state.model.answered = true;
      if (
        typeof generated === 'object' &&
        !Array.isArray(generated) &&
        Array.isArray(generated.claims)
      ) {
        state.modelResponse = generated;
      } else {
        state.model.rejectionReason = 'invalid_model_schema';
        state.llmFallback = true;
      }
    } else {
      state.model.rejectionReason = 'invalid_model_schema';
      state.llmFallback = true;
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

function initializePhase10ModelMeta(state) {
  Object.assign(state.model, {
    generationAttempted: false,
    generationSchemaValid: false,
    generationErrorCode: '',
    generationFinishReason: '',
    generationContentChars: 0,
    generationReasoningContentChars: 0,
    verificationAttempted: false,
    verificationSchemaValid: false,
    verificationErrorCode: '',
    verificationFinishReason: '',
    verificationContentChars: 0,
    verificationReasoningContentChars: 0
  });
}

function stageDiagnostic(error, stage) {
  if (error && error.modelDiagnostic) {
    return Object.assign({}, error.modelDiagnostic);
  }
  const timedOut = error instanceof AgentDeadlineError ||
    error && error.name === 'AbortError';
  return {
    errorCode: timedOut ? `${stage}_timeout` : 'provider_request_error',
    finishReason: '',
    contentChars: 0,
    reasoningContentChars: 0
  };
}

function applyStageDiagnostic(model, stage, diagnostic) {
  const source = diagnostic || {};
  model[`${stage}ErrorCode`] = String(source.errorCode || '');
  model[`${stage}FinishReason`] = String(source.finishReason || '');
  model[`${stage}ContentChars`] = Number.isFinite(source.contentChars)
    ? Math.max(0, Math.round(source.contentChars))
    : 0;
  model[`${stage}ReasoningContentChars`] = Number.isFinite(
    source.reasoningContentChars
  )
    ? Math.max(0, Math.round(source.reasoningContentChars))
    : 0;
}

async function boundedModelStage(state, operation, timeoutLimit, trace, timingName) {
  const controller = new AbortController();
  const remainingMs = Math.max(1, state.deadlineAtMs - Date.now());
  const timeoutMs = Math.min(timeoutLimit, remainingMs);
  const startedAt = traceStart(trace);
  let timeoutId;
  try {
    const operationPromise = Promise.resolve(operation({
      signal: controller.signal,
      timeoutMs,
      maxOutputTokens: state.budget.limits.maxOutputTokens
    }));
    const timeout = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new AgentDeadlineError(`${timingName} timed out`));
      }, timeoutMs);
    });
    return await Promise.race([operationPromise, timeout]);
  } finally {
    clearTimeout(timeoutId);
    traceEnd(trace, timingName, startedAt);
  }
}

async function maybeVerifyExplicitMemory(state, dependencies, trace) {
  if (
    !hasExplicitMemoryIntent(state.question) ||
    !state.phase10.semanticVerificationEnabled ||
    !dependencies.canUseVerifier() ||
    state.budget.used.modelCalls >= state.budget.limits.maxModelCalls
  ) {
    return false;
  }
  state.model.attempted = true;
  state.model.verificationAttempted = true;
  state.budget.used.modelCalls += 1;
  try {
    const verification = await boundedModelStage(
      state,
      options => dependencies.verify({
        question: state.question,
        subquestions: state.subquestionPlan,
        claims: [],
        evidence: state.retrievedChunks.slice(
          0,
          state.budget.limits.maxContextChunks
        )
      }, options),
      state.budget.limits.verificationTimeoutMs,
      trace,
      'semanticVerificationMs'
    );
    if (
      !verification ||
      !Array.isArray(verification.claims) ||
      !Array.isArray(verification.subquestions) ||
      !verification.memoryDelta ||
      typeof verification.memoryDelta !== 'object'
    ) {
      state.model.verificationErrorCode = 'invalid_verification_schema';
      state.model.rejectionReason = 'invalid_verification_schema';
      return false;
    }
    applyStageDiagnostic(
      state.model,
      'verification',
      getModelDiagnostic(verification)
    );
    state.model.verificationSchemaValid = true;
    state.semanticVerification = verification;
    state.memoryOnlyVerification = true;
    return true;
  } catch (error) {
    const diagnostic = stageDiagnostic(error, 'verification');
    applyStageDiagnostic(state.model, 'verification', diagnostic);
    state.model.rejectionReason = diagnostic.errorCode;
    if (typeof dependencies.onModelError === 'function') {
      dependencies.onModelError(error);
    }
    return false;
  }
}

function assignedGroundedEvidence(state) {
  const assignedIds = new Set((state.evidenceAssignments || [])
    .map(item => String(item && item.chunkId || '').trim())
    .filter(Boolean));
  return (state.selectedChunks || []).filter(candidate => (
    assignedIds.has(String(candidate && candidate.chunk && candidate.chunk.id || ''))
  ));
}

async function maybeGenerateGroundedV2(state, dependencies, trace) {
  initializePhase10ModelMeta(state);
  if (isSpecialistRoute(state.route)) {
    state.model.skipped = 'specialist_deterministic';
    return;
  }
  if (state.evidenceStatus !== 'sufficient' || !state.selectedChunks.length) {
    await maybeVerifyExplicitMemory(state, dependencies, trace);
    return;
  }
  const groundedEvidence = assignedGroundedEvidence(state);
  if (!groundedEvidence.length) {
    state.model.skipped = 'subquestion_evidence_unassigned';
    return;
  }
  if (!state.phase10.semanticVerificationEnabled || !dependencies.canUseVerifier()) {
    state.model.skipped = 'semantic_verifier_unavailable';
    state.llmFallback = true;
    return;
  }
  if (!dependencies.canUseModel()) {
    state.model.skipped = 'generation_model_unavailable';
    state.llmFallback = true;
    return;
  }
  if (state.budget.used.modelCalls + 2 > state.budget.limits.maxModelCalls) {
    state.model.skipped = 'model_call_budget';
    state.llmFallback = true;
    return;
  }

  const reservedCost = estimatedGenerationCost(state.budget);
  const phase10ReservedCost = reservedCost === null
    ? null
    : Number((reservedCost * 2).toFixed(8));
  if (
    phase10ReservedCost !== null &&
    phase10ReservedCost > state.budget.cost.maxUsd
  ) {
    state.model.skipped = 'cost_budget';
    state.stopReason = 'cost_budget_exhausted';
    return;
  }
  if (phase10ReservedCost !== null) {
    state.budget.cost.reservedEstimatedUsd = phase10ReservedCost;
  }

  try {
    state.model.attempted = true;
    state.model.generationAttempted = true;
    state.budget.used.modelCalls += 1;
    const generated = await boundedModelStage(
      state,
      options => dependencies.generateV2({
        question: state.question,
        standaloneQuery: state.standaloneQuery,
        route: state.route,
        page: state.page,
        messages: state.messages,
        trustedMemory: state.trustedMemory,
        subquestions: state.subquestionPlan,
        evidenceAssignments: state.evidenceAssignments,
        evidence: groundedEvidence
      }, options),
      state.budget.limits.generationTimeoutMs,
      trace,
      'generationMs'
    );
    applyStageDiagnostic(
      state.model,
      'generation',
      getModelDiagnostic(generated)
    );
    state.model.answered = Boolean(generated);
    if (
      !generated ||
      typeof generated !== 'object' ||
      Array.isArray(generated) ||
      !Array.isArray(generated.claims)
    ) {
      state.model.generationErrorCode = 'invalid_generation_schema';
      state.model.rejectionReason = 'invalid_generation_schema';
      state.llmFallback = true;
      return;
    }
    state.model.generationSchemaValid = true;
    state.modelResponse = generated;

    state.model.verificationAttempted = true;
    state.budget.used.modelCalls += 1;
    const verification = await boundedModelStage(
      state,
      options => dependencies.verify({
        question: state.question,
        subquestions: state.subquestionPlan,
        claims: generated.claims,
        evidence: groundedEvidence
      }, options),
      state.budget.limits.verificationTimeoutMs,
      trace,
      'semanticVerificationMs'
    );
    applyStageDiagnostic(
      state.model,
      'verification',
      getModelDiagnostic(verification)
    );
    if (
      !verification ||
      typeof verification !== 'object' ||
      Array.isArray(verification) ||
      !Array.isArray(verification.claims) ||
      !Array.isArray(verification.subquestions) ||
      !verification.memoryDelta ||
      typeof verification.memoryDelta !== 'object'
    ) {
      state.model.verificationErrorCode = 'invalid_verification_schema';
      state.model.rejectionReason = 'invalid_verification_schema';
      state.llmFallback = true;
      state.modelResponse = null;
      return;
    }
    state.model.verificationSchemaValid = true;
    state.semanticVerification = verification;
  } catch (error) {
    const stage = state.model.verificationAttempted
      ? 'verification'
      : 'generation';
    const diagnostic = stageDiagnostic(error, stage);
    applyStageDiagnostic(state.model, stage, diagnostic);
    state.model.rejectionReason = diagnostic.errorCode;
    state.llmFallback = true;
    state.modelResponse = null;
    state.semanticVerification = null;
    if (typeof dependencies.onModelError === 'function') {
      dependencies.onModelError(error);
    }
  }
}

function applyVerifiedResponse(state, response, source) {
  const claims = response && response.claims;
  if (!Array.isArray(claims) || !claims.length) {
    const navigationOnly = response && response.navigationOnly === true &&
      state.route === ROUTES.LEARNING_PATH;
    if (state.evidenceStatus !== 'sufficient' || navigationOnly) {
      state.answer = response && response.answer || state.answer;
      state.citations = [];
      state.claims = [];
      state.related = response && response.related || state.related;
      state.citationVerification = notRequiredVerification(
        navigationOnly
          ? 'learning_navigation_metadata'
          : state.needsClarification
          ? 'clarification_response'
          : state.route === ROUTES.DIRECT
            ? 'direct_response'
            : 'evidence_insufficient'
      );
      return { valid: true };
    }

    return {
      valid: false,
      reason: 'missing_claims',
      verification: {
        status: 'rejected',
        totalClaims: 0,
        supportedClaims: 0,
        rejectedClaims: 0,
        citationCompleteness: 0,
        citationSupport: 0,
        unsupportedClaimRate: 0,
        reasons: ['missing_claims'],
        source
      }
    };
  }

  const verified = verifyStructuredResponse(
    claims,
    state.selectedChunks,
    { source }
  );
  if (!verified.valid) return verified;

  state.answer = verified.answer;
  state.claims = verified.claims;
  state.citations = verified.citations;
  state.related = Array.isArray(response.related)
    ? response.related
    : state.related;
  state.citationVerification = verified.verification;
  return verified;
}

function applyCitationVerificationRefusal(state, verification) {
  state.evidenceStatus = 'insufficient';
  state.evidenceReason = 'citation_verification_failed';
  state.stopReason = 'citation_verification_failed';
  state.answer = '站内暂时无法为这个问题生成带可验证引用的回答。你可以补充文章标题或更具体的关键词。';
  state.citations = [];
  state.claims = [];
  state.unansweredSubquestions = state.subquestionPlan
    .filter(item => item.required !== false)
    .map(item => ({
      id: item.id,
      question: item.question,
      reason: 'citation_verification_failed'
    }));
  state.related = [];
  state.comparison = null;
  state.learningPath = null;
  state.codeExplanation = null;
  state.citationVerification = Object.assign({}, verification || {}, {
    status: 'failed'
  });
}

function memoryReferenceCandidates(state) {
  return []
    .concat(state.currentQuestionRefs || [])
    .concat(state.resolvedArticleRefs || [])
    .concat(state.history && state.history.articleRefs || [])
    .map(reference => ({
      chunkId: reference && reference.chunkId || '',
      title: reference && reference.title || '',
      url: reference && reference.url || '',
      section: reference && reference.section || ''
    }));
}

function applyGroundedV2Response(state) {
  const verified = verifyGroundedV2Response(
    state.modelResponse,
    state.semanticVerification,
    state.selectedChunks,
    state.subquestionPlan,
    state.evidenceAssignments
  );
  if (!verified.valid) return verified;
  state.answer = verified.answer;
  state.claims = verified.claims;
  state.citations = verified.citations;
  state.unansweredSubquestions = verified.unansweredSubquestions;
  state.citationVerification = verified.verification;
  state.memoryDelta = sanitizeMemoryDelta(
    state.semanticVerification.memoryDelta,
    {
      question: state.question,
      citations: state.citations.concat(memoryReferenceCandidates(state)),
      claims: state.claims
    }
  );
  state.phase10.memoryUpdateAccepted = Boolean(state.memoryDelta);
  return verified;
}

function applyMemoryOnlyVerification(state) {
  if (!state.memoryOnlyVerification || !state.semanticVerification) return;
  state.memoryDelta = sanitizeMemoryDelta(
    state.semanticVerification.memoryDelta,
    {
      question: state.question,
      citations: memoryReferenceCandidates(state),
      claims: []
    }
  );
  state.phase10.memoryUpdateAccepted = Boolean(state.memoryDelta);
  if (!state.memoryDelta || state.evidenceStatus === 'sufficient') return;
  const progressCount = state.memoryDelta.explicitLearningProgress.length;
  const preferenceCount = state.memoryDelta.responsePreferences.length;
  const values = [];
  if (progressCount) values.push('学习进度');
  if (preferenceCount) values.push('回答偏好');
  if (values.length) {
    state.answer = `已记录你明确表达的${values.join('和')}。你可以随时通过“清除记忆”删除。`;
    state.claims = [];
    state.citations = [];
    state.unansweredSubquestions = [];
    state.citationVerification = notRequiredVerification(
      'explicit_memory_update'
    );
  }
}

function finalizeAnswer(state, trace) {
  const verificationStartedAt = traceStart(trace);
  let result;

  if (
    state.phase10.groundedSynthesisEnabled &&
    state.modelResponse &&
    state.semanticVerification
  ) {
    result = applyGroundedV2Response(state);
    if (result.valid) {
      state.model.accepted = result.claims.length > 0;
      if (!state.model.accepted) {
        state.llmFallback = true;
        state.model.rejectionReason = result.verification.reasons[0] ||
          'no_verified_direct_claim';
      }
    } else {
      state.llmFallback = true;
      state.model.accepted = false;
      state.model.rejectionReason = result.reason || 'grounded_v2_verification_failed';
      state.modelResponse = null;
      state.semanticVerification = null;
      result = applyVerifiedResponse(
        state,
        state.deterministicResponse,
        'deterministic_fallback'
      );
    }
  } else if (state.modelResponse) {
    result = applyVerifiedResponse(state, state.modelResponse, 'model');
    if (result.valid) {
      state.model.accepted = true;
    } else {
      state.llmFallback = true;
      state.model.accepted = false;
      state.model.rejectionReason = result.reason || 'citation_verification_failed';
      result = applyVerifiedResponse(
        state,
        state.deterministicResponse,
        'deterministic_fallback'
      );
    }
  } else {
    result = applyVerifiedResponse(
      state,
      state.deterministicResponse,
      'deterministic'
    );
  }

  if (!state.phase10.groundedSynthesisEnabled || state.llmFallback) {
    state.unansweredSubquestions = [];
    state.memoryDelta = null;
  }

  if (!result.valid) {
    applyCitationVerificationRefusal(
      state,
      result.verification || {
        reasons: [result.reason || 'citation_verification_failed']
      }
    );
  }

  traceEnd(trace, 'citationVerificationMs', verificationStartedAt);
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

  const limits = getAgentLimits(
    settings.environment || process.env,
    settings.limits
  );
  const evidenceCalibration = createEvidenceCalibration(
    settings.evidenceCalibration
  );
  const trace = settings.trace || null;
  const dependencies = {
    canUseModel: settings.canUseModel || canUseModel,
    canUseVerifier: settings.canUseVerifier || (
      settings.verify ? () => true : canUseVerifier
    ),
    generate: settings.generate || generateGroundedAnswer,
    generateV2: settings.generateV2 || settings.generate || generateGroundedV2Answer,
    verify: settings.verify || verifyGroundedAnswer,
    onModelError: settings.onModelError
  };
  const tools = settings.tools || createAgentTools(corpus);
  const state = createAgentState(input, {
    corpus,
    indexVersion: settings.indexVersion,
    limits,
    evidenceCalibration,
    costControls: settings.costControls
  });
  state.phase10 = phase10Features(
    settings.environment || process.env,
    settings.rolloutKey || input.requestId || input.sessionId,
    settings
  );

  let startedAt = traceStart(trace);
  state.route = routeQuestion(state);
  traceEnd(trace, 'routeMs', startedAt);

  if (state.route === ROUTES.DIRECT) {
    state.evidenceStatus = 'not_required';
    state.evidenceReason = 'direct_response';
    state.stopReason = 'direct_response';
    const direct = buildDeterministicResponse(state);
    Object.assign(state, direct);
    state.deterministicResponse = direct;
    finalizeAnswer(state, trace);
    return finishPayload(state);
  }

  startedAt = traceStart(trace);
  const rewritten = rewriteStandaloneQuery(state);
  Object.assign(state, rewritten);
  state.phase5Request = createPhase5Request(state);
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
  state.subquestionPlan = buildSubquestionPlan(state.subqueries);
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
      state.evidenceScore = grade.score;
      state.evidenceThreshold = grade.threshold;
      state.evidenceFeatures = grade.features;
      state.evidenceQuery = grade.features && grade.features.coverageQuery ||
        state.standaloneQuery;
      traceEnd(trace, `gradeEvidenceAttempt${attempt}Ms`, startedAt);

      if (grade.status === 'sufficient') {
        state.stopReason = 'evidence_sufficient';
        break;
      }
      if (isSpecialistRoute(state.route)) {
        state.stopReason = 'specialist_result_missing';
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
  state.deterministicResponse = deterministic;
  traceEnd(trace, 'buildResponseMs', startedAt);

  if (state.phase10.groundedSynthesisEnabled) {
    const historyCharacters = state.messages
      .slice(-6)
      .reduce((total, message) => total + String(message.content || '').length, 0);
    state.budget.used.estimatedGenerationInputTokens = estimateTokens(
      state.budget.used.contextChars +
      historyCharacters +
      String(state.question || '').length +
      String(state.standaloneQuery || '').length +
      3500
    );
    await maybeGenerateGroundedV2(state, dependencies, trace);
  } else {
    await maybeGenerateWithModel(state, dependencies, trace);
  }
  finalizeAnswer(state, trace);
  applyMemoryOnlyVerification(state);
  return finishPayload(state);
}

module.exports = {
  INTERNAL_MEMORY_DELTA,
  finishPayload,
  applyVerifiedResponse,
  finalizeAnswer,
  responseMode,
  isSpecialistRoute,
  runAgent
};
