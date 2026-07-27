'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  runAgent
} = require('../agent/run');
const {
  validateClaim,
  verifyStructuredResponse
} = require('../agent/nodes/verify-citations');
const {
  makeAgentCorpus,
  makeInput
} = require('./fixtures/agent-corpus');

function selectedCandidate(corpus, id) {
  return {
    chunk: corpus.chunks.find(chunk => chunk.id === id),
    rank: 1,
    score: 10,
    ranking: { vectorScore: 0 }
  };
}

function validClaim() {
  const quote = '双塔模型由用户塔和物品塔组成，分别编码用户与物品，最后计算两个向量的相似度。';
  return {
    text: quote,
    citationIds: ['tower#0'],
    quote
  };
}

test('verified claims are reformatted with server-owned citations', () => {
  const corpus = makeAgentCorpus();
  const result = verifyStructuredResponse(
    [validClaim()],
    [selectedCandidate(corpus, 'tower#0')],
    { source: 'test' }
  );

  assert.equal(result.valid, true);
  assert.match(result.answer, /\[1\]/);
  assert.equal(result.claims[0].citationIds[0], 'tower#0');
  assert.equal(result.citations[0].title, '双塔模型');
  assert.equal(result.citations[0].section, '双塔模型的结构');
  assert.equal(result.verification.citationCompleteness, 1);
  assert.equal(result.verification.citationSupport, 1);
});

test('claim verification rejects forged IDs, missing quotes, and non-extractive text', () => {
  const corpus = makeAgentCorpus();
  const candidates = new Map([[
    'tower#0',
    selectedCandidate(corpus, 'tower#0')
  ]]);

  assert.equal(
    validateClaim(Object.assign(validClaim(), {
      citationIds: ['forged#0']
    }), 0, candidates).reason,
    'unknown_or_unselected_citation'
  );
  assert.equal(
    validateClaim(Object.assign(validClaim(), {
      quote: '不存在于正文的原文。'
    }), 0, candidates).reason,
    'quote_not_in_cited_chunk'
  );
  assert.equal(
    validateClaim(Object.assign(validClaim(), {
      text: '双塔模型可以自动解决所有 Kubernetes 调度问题。'
    }), 0, candidates).reason,
    'claim_must_be_extractive'
  );
});

test('extractive validation rejects semantic mutations despite high word overlap', () => {
  const corpus = makeAgentCorpus();
  const candidates = new Map([[
    'tower#0',
    selectedCandidate(corpus, 'tower#0')
  ]]);
  const quote = validClaim().quote;

  assert.equal(
    validateClaim({
      text: '双塔模型由用户塔和物品塔三部分组成，分别编码用户与物品，最后计算两个向量的相似度。',
      citationIds: ['tower#0'],
      quote
    }, 0, candidates, { source: 'model' }).reason,
    'claim_must_be_extractive'
  );
  assert.equal(
    validateClaim({
      text: '双塔模型不是由用户塔和物品塔组成，分别编码用户与物品，最后计算两个向量的相似度。',
      citationIds: ['tower#0'],
      quote
    }, 0, candidates, { source: 'model' }).reason,
    'negation_mismatch'
  );
});

test('only deterministic output may add a server-owned article title prefix', () => {
  const corpus = makeAgentCorpus();
  const candidates = new Map([[
    'tower#0',
    selectedCandidate(corpus, 'tower#0')
  ]]);
  const prefixed = Object.assign(validClaim(), {
    text: `《双塔模型》：${validClaim().quote}`
  });

  assert.equal(
    validateClaim(prefixed, 0, candidates, { source: 'deterministic' }).valid,
    true
  );
  assert.equal(
    validateClaim(prefixed, 0, candidates, { source: 'model' }).reason,
    'claim_must_be_extractive'
  );
});

test('an invalid model response is discarded in favor of verified deterministic evidence', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput(), {
    corpus,
    canUseModel: () => true,
    async generate() {
      return {
        claims: [{
          text: '双塔模型可以自动解决所有 Kubernetes 调度问题。',
          citationIds: ['tower#0'],
          quote: validClaim().quote
        }]
      };
    }
  });

  assert.equal(payload.meta.model.attempted, true);
  assert.equal(payload.meta.model.answered, true);
  assert.equal(payload.meta.model.accepted, false);
  assert.equal(payload.meta.llmFallback, true);
  assert.equal(payload.meta.citationVerification.status, 'verified');
  assert.equal(payload.meta.citationVerification.source, 'deterministic_fallback');
  assert.ok(payload.citations.length > 0);
  assert.doesNotMatch(payload.answer, /Kubernetes/);
});

test('a model claim can use only currently selected server evidence', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput(), {
    corpus,
    canUseModel: () => true,
    async generate() {
      return { claims: [validClaim()] };
    }
  });

  assert.equal(payload.meta.model.accepted, true);
  assert.equal(payload.meta.citationVerification.source, 'model');
  assert.deepEqual(payload.citations.map(citation => citation.chunkId), ['tower#0']);
});
