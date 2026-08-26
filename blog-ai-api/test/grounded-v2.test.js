'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  INTERNAL_MEMORY_DELTA,
  runAgent
} = require('../agent/run');
const {
  phase10Features
} = require('../agent/config');
const {
  candidateDirectness
} = require('../agent/nodes/grade-evidence');
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

  assert.match(generationPrompt, /draftAnswer/);
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
    draftAnswer: '草稿',
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
