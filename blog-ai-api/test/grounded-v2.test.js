'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INTERNAL_MEMORY_DELTA,
  runAgent
} = require('../agent/run');
const {
  AGENT_LIMITS,
  createEvidenceCalibration,
  getAgentLimits,
  phase10Features
} = require('../agent/config');
const {
  candidateDirectness,
  candidateTopicCoverage,
  gradeEvidence,
  topicAnchorQuery
} = require('../agent/nodes/grade-evidence');
const { ROUTES } = require('../agent/nodes/route');
const {
  verifyGroundedV2Response
} = require('../agent/nodes/verify-citations');
const {
  buildGroundedV2Prompt,
  buildVerificationPrompt,
  extractGroundedV2Answer,
  extractVerification
} = require('../lib/generate');
const {
  makeAgentCorpus,
  makeInput
} = require('./fixtures/agent-corpus');

function candidate(corpus, id) {
  return {
    chunk: corpus.chunks.find(chunk => chunk.id === id),
    rank: 1,
    score: 10,
    matchedQueries: ['双塔模型的结构是什么'],
    ranking: { vectorScore: 0 }
  };
}

function semanticVerification(values) {
  return Object.assign({
    claims: [{
      id: 'draft_claim_1',
      supported: true,
      directlyAnswers: true,
      reasonCode: 'supported'
    }],
    subquestions: [{ id: 'sq_1', covered: true }],
    memoryDelta: {
      activeTopic: '双塔模型',
      explicitLearningProgress: [],
      responsePreferences: [],
      summaryUpdate: '不应直接采用这段模型摘要。'
    }
  }, values);
}

test('phase 10 rollout requires both flags and uses a stable bucket', () => {
  assert.equal(phase10Features({
    GROUNDED_SYNTHESIS_ENABLED: 'true',
    SEMANTIC_VERIFICATION_ENABLED: 'false'
  }, 'stable-user').groundedSynthesisEnabled, false);
  const environment = {
    GROUNDED_SYNTHESIS_ENABLED: 'true',
    SEMANTIC_VERIFICATION_ENABLED: 'true',
    GROUNDED_SYNTHESIS_ROLLOUT_PERCENT: '37'
  };
  const first = phase10Features(environment, 'stable-user');
  const second = phase10Features(environment, 'stable-user');
  assert.equal(first.rolloutSelected, second.rolloutSelected);
  assert.equal(first.groundedSynthesisEnabled, second.groundedSynthesisEnabled);
});

test('canonical natural-answer release is not limited by a stale legacy rollout', () => {
  const features = phase10Features({
    NATURAL_ANSWER_V2_ENABLED: 'true',
    SEMANTIC_VERIFIER_ENABLED: 'true',
    GROUNDED_SYNTHESIS_ROLLOUT_PERCENT: '5'
  }, 'previously-unselected-user');

  assert.equal(features.rolloutPercent, 100);
  assert.equal(features.rolloutSelected, true);
  assert.equal(features.groundedSynthesisEnabled, true);

  const canary = phase10Features({
    NATURAL_ANSWER_V2_ENABLED: 'true',
    SEMANTIC_VERIFIER_ENABLED: 'true',
    NATURAL_ANSWER_V2_ROLLOUT_PERCENT: '5'
  }, 'previously-unselected-user');
  assert.equal(canary.rolloutPercent, 5);
});

test('agent timeout budgets use bounded production environment values', () => {
  const defaults = getAgentLimits({});
  assert.equal(defaults.retrievalRoundTimeoutMs, 1500);
  assert.equal(defaults.verificationTimeoutMs, 5000);

  const configured = getAgentLimits({
    RETRIEVAL_ROUND_TIMEOUT_MS: '1800',
    VERIFIER_TIMEOUT_MS: '5500'
  });
  assert.equal(configured.retrievalRoundTimeoutMs, 1800);
  assert.equal(configured.verificationTimeoutMs, 5500);

  const clamped = getAgentLimits({
    RETRIEVAL_ROUND_TIMEOUT_MS: '50',
    VERIFIER_TIMEOUT_MS: '90000'
  });
  assert.equal(clamped.retrievalRoundTimeoutMs, 500);
  assert.equal(clamped.verificationTimeoutMs, 6000);

  const overridden = getAgentLimits({
    VERIFIER_TIMEOUT_MS: '5500'
  }, {
    verificationTimeoutMs: 25
  });
  assert.equal(overridden.verificationTimeoutMs, 25);
  assert.equal(AGENT_LIMITS.verificationTimeoutMs, 5000);
});

test('phase 10 prompts and parsers enforce separate generation and verification schemas', () => {
  const corpus = makeAgentCorpus();
  const evidence = [candidate(corpus, 'tower#0')];
  const subquestions = [{
    id: 'sq_1',
    question: '双塔模型的结构是什么？',
    required: true
  }];
  const generationPrompt = buildGroundedV2Prompt({
    question: '双塔模型的结构是什么？',
    subquestions,
    evidence,
    evidenceAssignments: [{ subquestionId: 'sq_1', chunkId: 'tower#0' }]
  });
  const verificationPrompt = buildVerificationPrompt({
    question: '双塔模型的结构是什么？',
    subquestions,
    claims: [],
    evidence
  });

  assert.doesNotMatch(generationPrompt, /draftAnswer/);
  assert.match(generationPrompt, /最多 3 条 claim/);
  assert.match(generationPrompt, /subquestionId/);
  assert.match(generationPrompt, /text 可以自然改写/);
  assert.match(generationPrompt, /可用于子问题: sq_1/);
  assert.match(verificationPrompt, /独立的语义验证器/);
  assert.match(verificationPrompt, /directlyAnswers/);
  assert.match(verificationPrompt, /responsePreferences/);
  assert.deepEqual(extractGroundedV2Answer(JSON.stringify({
    draftAnswer: '草稿',
    claims: [],
    unansweredSubquestions: ['sq_1']
  })), {
    claims: [],
    unansweredSubquestions: ['sq_1']
  });
  assert.equal(extractGroundedV2Answer('{bad json'), null);
  assert.equal(extractGroundedV2Answer(JSON.stringify({
    claims: [{ id: 'claim_without_required_fields' }]
  })), null);
  assert.ok(extractVerification(JSON.stringify(semanticVerification())));
  assert.equal(extractVerification(JSON.stringify({ claims: [] })), null);
});

test('code validation publishes a verified natural paraphrase and ignores draftAnswer', () => {
  const corpus = makeAgentCorpus();
  const quote = corpus.chunks[0].content;
  const result = verifyGroundedV2Response({
    draftAnswer: '这段未验证草稿绝不能发布。',
    claims: [{
      id: 'draft_claim_1',
      subquestionId: 'sq_1',
      text: '双塔模型分别编码用户和物品，再比较两侧向量。',
      citationIds: ['tower#0'],
      quote
    }]
  }, semanticVerification(), [candidate(corpus, 'tower#0')], [{
    id: 'sq_1',
    question: '双塔模型的结构是什么？',
    required: true
  }]);

  assert.equal(result.valid, true);
  assert.match(result.answer, /分别编码用户和物品/);
  assert.match(result.answer, /\[1\]/);
  assert.doesNotMatch(result.answer, /未验证草稿/);
  assert.equal(result.claims[0].subquestionId, 'sq_1');
  assert.equal(result.citations[0].chunkId, 'tower#0');
  assert.deepEqual(result.unansweredSubquestions, []);
  assert.equal(result.verification.unsupportedClaimRate, 0);
});

test('unsupported, indirect, forged, and duplicate claims are never published', () => {
  const corpus = makeAgentCorpus();
  const quote = corpus.chunks[0].content;
  const response = {
    claims: [{
      id: 'draft_claim_1',
      subquestionId: 'sq_1',
      text: '双塔模型能解决所有推荐问题。',
      citationIds: ['tower#0'],
      quote
    }]
  };
  const result = verifyGroundedV2Response(
    response,
    semanticVerification({
      claims: [{
        id: 'draft_claim_1',
        supported: false,
        directlyAnswers: false,
        reasonCode: 'scope_expansion'
      }],
      subquestions: [{ id: 'sq_1', covered: false }]
    }),
    [candidate(corpus, 'tower#0')],
    [{ id: 'sq_1', question: '双塔模型有什么局限？', required: true }]
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.citations, []);
  assert.doesNotMatch(result.answer, /解决所有推荐问题/);
  assert.equal(result.unansweredSubquestions[0].id, 'sq_1');
  assert.ok(result.verification.reasons.includes('scope_expansion'));
  assert.equal(result.verification.unsupportedClaimRate, 0);
});

test('multi-part answers keep per-question coverage and never reuse one quote', () => {
  const corpus = makeAgentCorpus();
  const towerQuote = corpus.chunks.find(chunk => chunk.id === 'tower#0').content;
  const retrievalQuote = corpus.chunks.find(chunk => chunk.id === 'tower#1').content;
  const result = verifyGroundedV2Response({
    claims: [{
      id: 'draft_claim_1',
      subquestionId: 'sq_1',
      text: '双塔模型分别编码用户与物品。',
      citationIds: ['tower#0'],
      quote: towerQuote
    }, {
      id: 'draft_claim_2',
      subquestionId: 'sq_2',
      text: '同一句结构证据被复用为线上召回答案。',
      citationIds: ['tower#0'],
      quote: towerQuote
    }, {
      id: 'draft_claim_3',
      subquestionId: 'sq_2',
      text: '线上先得到用户向量，再检索相似物品。',
      citationIds: ['tower#1'],
      quote: retrievalQuote
    }]
  }, {
    claims: ['draft_claim_1', 'draft_claim_2', 'draft_claim_3'].map(id => ({
      id,
      supported: true,
      directlyAnswers: true,
      reasonCode: 'supported'
    })),
    subquestions: [
      { id: 'sq_1', covered: true },
      { id: 'sq_2', covered: true }
    ],
    memoryDelta: {}
  }, [candidate(corpus, 'tower#0'), candidate(corpus, 'tower#1')], [{
    id: 'sq_1', question: '双塔模型的结构是什么？', required: true
  }, {
    id: 'sq_2', question: '双塔模型如何线上召回？', required: true
  }]);

  assert.equal(result.valid, true);
  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.claims.map(claim => claim.subquestionId), ['sq_1', 'sq_2']);
  assert.ok(result.verification.reasons.includes('duplicate'));
  assert.deepEqual(result.unansweredSubquestions, []);
  assert.match(result.answer, /关于“双塔模型的结构是什么？”/);
  assert.match(result.answer, /关于“双塔模型如何线上召回？”/);
});

test('topic relevance and direct answer evidence are scored separately', () => {
  const corpus = makeAgentCorpus();
  assert.equal(
    candidateDirectness(candidate(corpus, 'tower#0'), '双塔模型有什么缺点？'),
    0
  );
  assert.equal(
    candidateDirectness(candidate(corpus, 'tower#0'), '双塔模型的结构是什么？'),
    1
  );
  assert.equal(
    candidateDirectness(candidate(corpus, 'tower#0'), '什么是双塔模型？'),
    1
  );
  assert.equal(candidateDirectness({
    chunk: {
      postTitle: 'AdaBoost',
      sectionTitle: '算法',
      tags: ['集成学习'],
      categories: ['机器学习'],
      content: '根据以上内容，整理 AdaBoost 算法的输入和输出。'
    }
  }, '什么是集成学习？'), 0);
  assert.equal(topicAnchorQuery('随机森林如何降低过拟合风险？'), '随机森林');
  assert.ok(
    candidateTopicCoverage(
      candidate(corpus, 'tower#0'),
      '双塔模型的基本结构是什么？'
    ) >= 0.5
  );
  assert.equal(
    candidateTopicCoverage(
      candidate(corpus, 'tower#0'),
      '随机森林如何降低过拟合风险？'
    ),
    0
  );
});

test('semantic similarity cannot make an unrelated topic sufficient evidence', () => {
  const question = '随机森林如何降低过拟合风险？';
  const misleading = {
    chunk: {
      id: 'alexnet-dropout',
      postTitle: 'AlexNet',
      postUrl: 'https://wangsenjie.github.io/alexnet/',
      sectionTitle: 'Dropout',
      tags: ['卷积神经网络'],
      categories: ['机器学习与深度学习'],
      content: 'Dropout 通过随机丢弃神经元输出减少过拟合风险。'
    },
    rank: 1,
    score: 10,
    matchedQueries: [question],
    ranking: { vectorScore: 0.55 }
  };
  const grade = gradeEvidence({
    route: ROUTES.SITE_QA,
    standaloneQuery: question,
    subqueries: [question],
    retrievedChunks: [misleading],
    currentQuestionRefs: [],
    resolvedArticleRefs: [],
    history: { pageRef: null, articleRefs: [] },
    specialistResults: {},
    phase10: { groundedSynthesisEnabled: true },
    evidenceCalibration: createEvidenceCalibration()
  });

  assert.equal(grade.status, 'insufficient');
  assert.equal(grade.features.directness, 1);
  assert.ok(grade.features.topicCoverage < grade.features.topicAnchorMinCoverage);

  const legacyGrade = gradeEvidence(Object.assign({}, {
    route: ROUTES.SITE_QA,
    standaloneQuery: question,
    subqueries: [question],
    retrievedChunks: [misleading],
    currentQuestionRefs: [],
    resolvedArticleRefs: [],
    history: { pageRef: null, articleRefs: [] },
    specialistResults: {},
    phase10: { groundedSynthesisEnabled: false },
    evidenceCalibration: createEvidenceCalibration()
  }));
  assert.equal(legacyGrade.status, 'insufficient');
  assert.ok(
    legacyGrade.features.topicCoverage <
      legacyGrade.features.topicAnchorMinCoverage
  );
});

test('grounded verification rejects a citation not assigned to its subquestion', () => {
  const corpus = makeAgentCorpus();
  const quote = corpus.chunks.find(chunk => chunk.id === 'tower#0').content;
  const result = verifyGroundedV2Response({
    claims: [{
      id: 'draft_claim_1',
      subquestionId: 'sq_1',
      text: '双塔模型分别编码用户与物品。',
      citationIds: ['tower#0'],
      quote
    }]
  }, semanticVerification(), [candidate(corpus, 'tower#0')], [{
    id: 'sq_1',
    question: '双塔模型的结构是什么？',
    required: true
  }], [{
    subquestionId: 'sq_1',
    chunkId: 'itemcf#0'
  }]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.claims, []);
  assert.deepEqual(result.citations, []);
  assert.ok(result.verification.reasons.includes('citation_not_assigned'));
});

test('grounded prompt marks unassigned evidence as unavailable for claims', () => {
  const corpus = makeAgentCorpus();
  const evidence = [
    candidate(corpus, 'tower#0'),
    candidate(corpus, 'usercf#0')
  ];
  const prompt = buildGroundedV2Prompt({
    question: '双塔模型的结构是什么？',
    subquestions: [{
      id: 'sq_1',
      question: '双塔模型的结构是什么？',
      required: true
    }],
    evidence,
    evidenceAssignments: [{
      subquestionId: 'sq_1',
      chunkId: 'tower#0'
    }]
  });

  assert.match(prompt, /可用于子问题: sq_1/);
  assert.match(prompt, /可用于子问题: 无（不得引用）/);
  assert.match(prompt, /最近对话（只用于理解当前追问和指代/);
  assert.match(prompt, /不要把整句 quote 原样复制/);
});

test('list questions can assign evidence from several relevant articles', async () => {
  const corpus = makeAgentCorpus();
  let generatedInput;
  await runAgent(makeInput({
    question: '推荐系统有哪些经典算法？',
    messages: [{ role: 'user', content: '推荐系统有哪些经典算法？' }]
  }), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => true,
    canUseVerifier: () => true,
    async generateV2(input) {
      generatedInput = input;
      return { claims: [], unansweredSubquestions: ['sq_1'] };
    },
    async verify() {
      return {
        claims: [],
        subquestions: [{ id: 'sq_1', covered: false }],
        memoryDelta: {
          activeTopic: '推荐系统',
          explicitLearningProgress: [],
          responsePreferences: [],
          summaryUpdate: ''
        }
      };
    }
  });

  assert.ok(generatedInput);
  assert.ok(generatedInput.evidenceAssignments.length >= 2);
  assert.ok(new Set(generatedInput.evidence.map(item => (
    item.chunk.postUrl
  ))).size >= 2);
});

test('runAgent uses two bounded model calls and publishes only verifier-approved claims', async () => {
  const corpus = makeAgentCorpus();
  let generationCalls = 0;
  let verificationCalls = 0;
  const payload = await runAgent(makeInput({
    question: '双塔模型的结构是什么？',
    messages: [{ role: 'user', content: '双塔模型的结构是什么？' }]
  }), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => true,
    canUseVerifier: () => true,
    async generateV2(input) {
      generationCalls += 1;
      assert.equal(input.subquestions[0].id, 'sq_1');
      assert.deepEqual(input.evidence.map(item => item.chunk.id), ['tower#0']);
      return {
        draftAnswer: '不发布的草稿',
        claims: [{
          id: 'draft_claim_1',
          subquestionId: 'sq_1',
          text: '双塔模型分别编码用户与物品，并比较两侧向量。',
          citationIds: ['tower#0'],
          quote: corpus.chunks[0].content
        }],
        unansweredSubquestions: []
      };
    },
    async verify(input) {
      verificationCalls += 1;
      assert.equal(input.claims[0].id, 'draft_claim_1');
      return semanticVerification();
    }
  });

  assert.equal(generationCalls, 1);
  assert.equal(verificationCalls, 1);
  assert.equal(payload.meta.budget.used.modelCalls, 2);
  assert.equal(payload.meta.evidenceGrading, 'topic_directness_v2');
  assert.equal(payload.meta.model.generationSchemaValid, true);
  assert.equal(payload.meta.model.verificationSchemaValid, true);
  assert.equal(payload.meta.model.accepted, true);
  assert.equal(payload.meta.citationVerification.source, 'semantic_verifier_v2');
  assert.match(payload.answer, /分别编码用户与物品/);
  assert.doesNotMatch(payload.answer, /不发布的草稿/);
  assert.deepEqual(payload.unansweredSubquestions, []);
});

test('zero published claims use verified deterministic evidence', async () => {
  const corpus = makeAgentCorpus();
  const wrongQuote = corpus.chunks.find(chunk => chunk.id === 'usercf#0').content;
  const payload = await runAgent(makeInput({
    question: '双塔模型的结构是什么？',
    messages: [{ role: 'user', content: '双塔模型的结构是什么？' }]
  }), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => true,
    canUseVerifier: () => true,
    async generateV2(input) {
      assert.deepEqual(input.evidence.map(item => item.chunk.id), ['tower#0']);
      return {
        claims: [{
          id: 'draft_claim_1',
          subquestionId: 'sq_1',
          text: 'UserCF 根据共同喜欢的物品计算用户相似度。',
          citationIds: ['usercf#0'],
          quote: wrongQuote
        }],
        unansweredSubquestions: []
      };
    },
    async verify() {
      return semanticVerification();
    }
  });

  assert.equal(payload.meta.model.generationSchemaValid, true);
  assert.equal(payload.meta.model.verificationSchemaValid, true);
  assert.equal(payload.meta.model.accepted, false);
  assert.equal(payload.meta.model.rejectionReason, 'unknown_or_unselected_citation');
  assert.equal(payload.meta.llmFallback, true);
  assert.equal(payload.meta.citationVerification.source, 'deterministic_fallback');
  assert.ok(payload.claims.length > 0);
  assert.deepEqual(payload.citations.map(item => item.chunkId), ['tower#0']);
  assert.match(payload.answer, /双塔模型由用户塔和物品塔组成/);
  assert.doesNotMatch(payload.answer, /UserCF/);
});

test('an unavailable or invalid semantic verifier falls back to deterministic evidence', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput(), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => true,
    canUseVerifier: () => true,
    async generateV2() {
      return {
        claims: [{
          id: 'draft_claim_1',
          subquestionId: 'sq_1',
          text: '未验证的自然结论。',
          citationIds: ['tower#0'],
          quote: corpus.chunks[0].content
        }]
      };
    },
    async verify() {
      return null;
    }
  });

  assert.equal(payload.meta.llmFallback, true);
  assert.equal(payload.meta.model.accepted, false);
  assert.equal(payload.meta.model.rejectionReason, 'invalid_verification_schema');
  assert.equal(payload.meta.citationVerification.source, 'deterministic');
  assert.doesNotMatch(payload.answer, /未验证的自然结论/);
  assert.ok(payload.citations.length > 0);
});

test('phase 10 exposes safe generation failure diagnostics without model content', async () => {
  const corpus = makeAgentCorpus();
  const error = new Error('raw model content must not be published');
  error.code = 'provider_invalid_json';
  error.modelDiagnostic = {
    errorCode: 'provider_invalid_json',
    finishReason: 'length',
    contentChars: 321,
    reasoningContentChars: 777
  };
  const payload = await runAgent(makeInput(), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => true,
    canUseVerifier: () => true,
    async generateV2() {
      throw error;
    }
  });

  assert.equal(payload.meta.model.rejectionReason, 'provider_invalid_json');
  assert.equal(payload.meta.model.generationErrorCode, 'provider_invalid_json');
  assert.equal(payload.meta.model.generationFinishReason, 'length');
  assert.equal(payload.meta.model.generationContentChars, 321);
  assert.equal(payload.meta.model.generationReasoningContentChars, 777);
  assert.equal(payload.meta.model.verificationAttempted, false);
  assert.equal(payload.meta.citationVerification.source, 'deterministic');
  assert.equal(JSON.stringify(payload).includes(error.message), false);
});

test('an explicit preference can be verified and stored without publishing factual claims', async () => {
  const corpus = makeAgentCorpus();
  let generationCalls = 0;
  const payload = await runAgent(makeInput({
    question: '以后回答都简洁一点。',
    messages: [{ role: 'user', content: '以后回答都简洁一点。' }]
  }), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => true,
    canUseVerifier: () => true,
    async generateV2() {
      generationCalls += 1;
      return null;
    },
    async verify(input) {
      assert.deepEqual(input.claims, []);
      return {
        claims: [],
        subquestions: [{ id: 'sq_1', covered: false }],
        memoryDelta: {
          activeTopic: '',
          summaryUpdate: '',
          explicitLearningProgress: [],
          responsePreferences: [{ kind: 'answer_style', value: 'concise' }]
        }
      };
    }
  });

  assert.equal(generationCalls, 0);
  assert.equal(payload.meta.budget.used.modelCalls, 1);
  assert.equal(payload.meta.model.generationAttempted, false);
  assert.equal(payload.meta.model.verificationSchemaValid, true);
  assert.equal(payload.meta.phase10.memoryUpdateAccepted, true);
  assert.match(payload.answer, /已记录你明确表达的回答偏好/);
  assert.deepEqual(payload.claims, []);
  assert.deepEqual(payload[INTERNAL_MEMORY_DELTA].responsePreferences, [{
    kind: 'answer_style',
    value: 'concise',
    source: 'explicit_user_statement'
  }]);
  assert.equal(JSON.stringify(payload).includes('responsePreferences'), false);
});
