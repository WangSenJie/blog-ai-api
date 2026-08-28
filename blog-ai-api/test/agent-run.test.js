'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENT_LIMITS
} = require('../agent/config');
const {
  runAgent
} = require('../agent/run');
const {
  normalizeAskRequest
} = require('../memory/session');
const {
  assistantReference,
  findPost,
  makeAgentCorpus,
  makeInput
} = require('./fixtures/agent-corpus');

function resultForChunk(chunk, score) {
  return {
    strategy: 'bm25',
    total: 1,
    results: [{
      chunk: Object.assign({}, chunk),
      rank: 1,
      score: score === undefined ? 10 : score
    }]
  };
}

function emptyResult() {
  return {
    strategy: 'bm25',
    total: 0,
    results: []
  };
}

test('direct questions do not retrieve or consume tool budget', async () => {
  const corpus = makeAgentCorpus();
  let toolCalls = 0;
  const payload = await runAgent(makeInput({
    question: '你好',
    messages: [{ role: 'user', content: '你好' }]
  }), {
    corpus,
    tools: {
      execute() {
        toolCalls += 1;
        return emptyResult();
      }
    },
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'direct');
  assert.equal(payload.meta.retrievalAttempts, 0);
  assert.equal(payload.meta.evidenceStatus, 'not_required');
  assert.equal(payload.meta.budget.used.toolCalls, 0);
  assert.equal(toolCalls, 0);
  assert.deepEqual(payload.citations, []);
});

test('sufficient first-round evidence stops after one retrieval attempt', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput(), {
    corpus,
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'site_qa');
  assert.equal(payload.meta.retrievalAttempts, 1);
  assert.equal(payload.meta.evidenceStatus, 'sufficient');
  assert.equal(payload.meta.stopReason, 'evidence_sufficient');
  assert.ok(payload.citations.some(citation => citation.chunkId === 'tower#0'));
});

test('insufficient first-round evidence is rewritten once and succeeds on round two', async () => {
  const corpus = makeAgentCorpus();
  const calls = [];
  const tower = corpus.chunks.find(chunk => chunk.id === 'tower#0');
  const tools = {
    execute(name, args) {
      calls.push({ name, args });
      return calls.length === 1
        ? emptyResult()
        : resultForChunk(tower);
    }
  };
  const payload = await runAgent(makeInput({
    question: '双塔模型结构',
    messages: [{ role: 'user', content: '双塔模型结构' }]
  }), {
    corpus,
    tools,
    canUseModel: () => false
  });

  assert.equal(payload.meta.retrievalAttempts, 2);
  assert.equal(payload.meta.evidenceStatus, 'sufficient');
  assert.equal(payload.meta.stopReason, 'evidence_sufficient');
  assert.equal(calls.length, 2);
  assert.match(calls[1].args.query, /相关内容/);
  assert.ok(payload.citations.some(citation => citation.chunkId === 'tower#0'));
});

test('two insufficient rounds stop safely without generation or citations', async () => {
  const corpus = makeAgentCorpus();
  let generated = 0;
  const payload = await runAgent(makeInput({
    question: 'Kubernetes Pod 调度机制',
    messages: [{
      role: 'user',
      content: 'Kubernetes Pod 调度机制'
    }]
  }), {
    corpus,
    tools: {
      execute() {
        return emptyResult();
      }
    },
    canUseModel: () => true,
    async generate() {
      generated += 1;
      return '不应生成';
    }
  });

  assert.equal(payload.meta.retrievalAttempts, AGENT_LIMITS.maxRetrievalAttempts);
  assert.equal(payload.meta.evidenceStatus, 'insufficient');
  assert.equal(payload.meta.stopReason, 'attempt_limit');
  assert.match(payload.answer, /站内暂时没有足够信息/);
  assert.deepEqual(payload.citations, []);
  assert.equal(payload.meta.model.attempted, false);
  assert.equal(payload.meta.budget.used.modelCalls, 0);
  assert.equal(generated, 0);
});

test('comparison and compound retrieval obey subquery, tool, and context limits', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput({
    question: '比较 ItemCF 和 UserCF 的区别',
    messages: [{
      role: 'user',
      content: '比较 ItemCF 和 UserCF 的区别'
    }]
  }), {
    corpus,
    limits: {
      maxContextChunks: 2,
      maxContextChars: 1000,
      maxContextTokens: 500
    },
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'article_compare');
  assert.ok(payload.meta.subqueries.length <= AGENT_LIMITS.maxSubqueries);
  assert.ok(payload.meta.retrievalAttempts <= AGENT_LIMITS.maxRetrievalAttempts);
  assert.ok(payload.meta.toolCalls.length <= AGENT_LIMITS.maxToolCalls);
  assert.ok(payload.meta.budget.used.contextChunks <= 2);
  assert.deepEqual(
    new Set(payload.citations.map(citation => citation.title)),
    new Set(['ItemCF', 'UserCF'])
  );
});

test('comparison accepts corpus-verified titles separated by punctuation', async () => {
  const corpus = makeAgentCorpus();
  const question = 'ItemCF、UserCF 有何异同';
  const payload = await runAgent(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), {
    corpus,
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'article_compare');
  assert.equal(payload.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    new Set(payload.citations.map(citation => citation.title)),
    new Set(['ItemCF', 'UserCF'])
  );
});

test('comparison resolves same-message former and latter references', async () => {
  const corpus = makeAgentCorpus();

  for (const question of [
    '比较 ItemCF 和 UserCF，前者更适合什么场景？',
    '比较 ItemCF 和 UserCF，后者有什么特点？'
  ]) {
    const payload = await runAgent(makeInput({
      question,
      messages: [{ role: 'user', content: question }]
    }), {
      corpus,
      canUseModel: () => false
    });

    assert.equal(payload.meta.route, 'article_compare');
    assert.equal(payload.meta.evidenceStatus, 'sufficient');
    assert.deepEqual(
      new Set(payload.citations.map(citation => citation.title)),
      new Set(['ItemCF', 'UserCF'])
    );
  }
});

test('a same-message ordinal limits ordinary QA to the selected article', async () => {
  const corpus = makeAgentCorpus();
  const question = 'ItemCF 和 UserCF，第二篇有什么特点？';
  const payload = await runAgent(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), {
    corpus,
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'page_qa');
  assert.equal(payload.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    new Set(payload.citations.map(citation => citation.title)),
    new Set(['UserCF'])
  );
  assert.equal(
    payload.meta.toolCalls.every(call => call.name === 'search_blog'),
    true
  );
});

test('tool budget can stop the workflow before a second round', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput({
    question: '完全不存在的主题',
    messages: [{ role: 'user', content: '完全不存在的主题' }]
  }), {
    corpus,
    tools: {
      execute() {
        return emptyResult();
      }
    },
    limits: {
      maxToolCalls: 1
    },
    canUseModel: () => false
  });

  assert.equal(payload.meta.retrievalAttempts, 1);
  assert.equal(payload.meta.budget.used.toolCalls, 1);
  assert.equal(payload.meta.stopReason, 'tool_budget_exhausted');
  assert.equal(payload.meta.evidenceStatus, 'insufficient');
});

test('three subqueries across two rounds never exceed six tool calls', async () => {
  const corpus = makeAgentCorpus();
  let calls = 0;
  const question = [
    '双塔模型结构',
    '双塔模型训练',
    '双塔模型部署',
    '双塔模型更新'
  ].join('；');
  const payload = await runAgent(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), {
    corpus,
    tools: {
      execute() {
        calls += 1;
        return emptyResult();
      }
    },
    canUseModel: () => false
  });

  assert.equal(payload.meta.subqueries.length, AGENT_LIMITS.maxSubqueries);
  assert.equal(payload.meta.retrievalAttempts, AGENT_LIMITS.maxRetrievalAttempts);
  assert.equal(payload.meta.toolCalls.length, AGENT_LIMITS.maxToolCalls);
  assert.equal(payload.meta.budget.used.toolCalls, AGENT_LIMITS.maxToolCalls);
  assert.equal(calls, AGENT_LIMITS.maxToolCalls);
  assert.equal(payload.meta.evidenceStatus, 'insufficient');
});

test('retrieval timeouts are bounded and still end with a safe response', async () => {
  const corpus = makeAgentCorpus();
  const payload = await runAgent(makeInput({
    question: '超时主题',
    messages: [{ role: 'user', content: '超时主题' }]
  }), {
    corpus,
    tools: {
      execute() {
        return new Promise(() => {});
      }
    },
    limits: {
      retrievalRoundTimeoutMs: 5,
      overallTimeoutMs: 100
    },
    canUseModel: () => false
  });

  assert.ok(payload.meta.retrievalAttempts <= AGENT_LIMITS.maxRetrievalAttempts);
  assert.equal(
    payload.meta.toolCalls.every(call => call.status === 'timeout'),
    true
  );
  assert.equal(payload.meta.evidenceStatus, 'insufficient');
  assert.match(payload.answer, /站内暂时没有足够信息/);
});

test('expired overall deadline prevents unbounded retrieval', async () => {
  const corpus = makeAgentCorpus();
  let toolCalls = 0;
  const payload = await runAgent(makeInput(), {
    corpus,
    tools: {
      execute() {
        toolCalls += 1;
        return emptyResult();
      }
    },
    limits: {
      overallTimeoutMs: -1
    },
    canUseModel: () => false
  });

  assert.equal(payload.meta.stopReason, 'deadline');
  assert.equal(payload.meta.retrievalAttempts, 1);
  assert.equal(payload.meta.budget.used.toolCalls, 0);
  assert.equal(toolCalls, 0);
  assert.deepEqual(payload.citations, []);
});

test('legacy question and one-message requests preserve Agent result parity', async () => {
  const corpus = makeAgentCorpus();
  const legacy = normalizeAskRequest({
    sessionId: 'legacy_case',
    question: '双塔模型'
  });
  const messages = normalizeAskRequest({
    sessionId: 'message_case',
    messages: [{ role: 'user', content: '双塔模型' }]
  });
  const options = {
    corpus,
    canUseModel: () => false
  };
  const [legacyPayload, messagePayload] = await Promise.all([
    runAgent(legacy, options),
    runAgent(messages, options)
  ]);

  assert.equal(legacyPayload.meta.route, messagePayload.meta.route);
  assert.equal(
    legacyPayload.meta.standaloneQuery,
    messagePayload.meta.standaloneQuery
  );
  assert.equal(
    legacyPayload.meta.retrievalAttempts,
    messagePayload.meta.retrievalAttempts
  );
  assert.deepEqual(
    legacyPayload.citations.map(citation => citation.chunkId),
    messagePayload.citations.map(citation => citation.chunkId)
  );
});

test('page summary follows the resolved second article instead of the first reference', async () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(
    corpus,
    ['itemcf#0', 'usercf#0']
  );
  const question = '总结第二篇';
  const payload = await runAgent(makeInput({
    question,
    messages: [
      { role: 'user', content: '给我两篇协同过滤文章' },
      previousAnswer,
      { role: 'user', content: question }
    ]
  }), {
    corpus,
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'page_summary');
  assert.equal(payload.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    new Set(payload.citations.map(citation => citation.title)),
    new Set(['UserCF'])
  );
});

test('an explicit verified title anchors summary and related-article tools', async () => {
  const corpus = makeAgentCorpus();
  const summaryQuestion = '总结双塔模型';
  const relatedQuestion = '推荐双塔模型的相关文章';
  const [summary, related] = await Promise.all([
    runAgent(makeInput({
      question: summaryQuestion,
      messages: [{ role: 'user', content: summaryQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    }),
    runAgent(makeInput({
      question: relatedQuestion,
      messages: [{ role: 'user', content: relatedQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    })
  ]);

  assert.equal(summary.meta.route, 'page_summary');
  assert.deepEqual(
    [...new Set(summary.meta.toolCalls.map(call => call.name))],
    ['get_article']
  );
  assert.deepEqual(
    new Set(summary.citations.map(citation => citation.title)),
    new Set(['双塔模型'])
  );
  assert.equal(related.meta.route, 'related_articles');
  assert.deepEqual(
    [...new Set(related.meta.toolCalls.map(call => call.name))],
    ['get_related_articles']
  );
  assert.equal(
    related.related.some(item => item.title === '双塔模型'),
    false
  );
});

test('site QA for one explicit article reads its source-ordered evidence', async () => {
  const corpus = makeAgentCorpus();
  const question = '什么是双塔模型？';
  const payload = await runAgent(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), {
    corpus,
    groundedSynthesisEnabled: true,
    semanticVerificationEnabled: true,
    canUseModel: () => false,
    canUseVerifier: () => false
  });

  assert.equal(payload.meta.route, 'site_qa');
  assert.equal(payload.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    [...new Set(payload.meta.toolCalls.map(call => call.name))],
    ['get_article']
  );
  assert.deepEqual(payload.citations.map(item => item.chunkId), ['tower#0']);
  assert.match(payload.answer, /双塔模型由用户塔和物品塔组成/);
});

test('conversation pronouns override an unrelated current page for page tools', async () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['usercf#0'], {
    standaloneQuery: 'UserCF'
  });
  const page = findPost(corpus, 'LangGraph 基础');
  const messages = [
    { role: 'user', content: '什么是 UserCF？' },
    previousAnswer
  ];
  const summaryQuestion = '总结它的内容';
  const relatedQuestion = '推荐它的相关文章';
  const [summary, related] = await Promise.all([
    runAgent(makeInput({
      question: summaryQuestion,
      page,
      messages: messages.concat({
        role: 'user',
        content: summaryQuestion
      })
    }), {
      corpus,
      canUseModel: () => false
    }),
    runAgent(makeInput({
      question: relatedQuestion,
      page,
      messages: messages.concat({
        role: 'user',
        content: relatedQuestion
      })
    }), {
      corpus,
      canUseModel: () => false
    })
  ]);

  assert.equal(summary.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    new Set(summary.citations.map(citation => citation.title)),
    new Set(['UserCF'])
  );
  assert.equal(
    related.related.some(item => item.title === 'UserCF'),
    false
  );
});

test('the latest assistant turn blocks stale article references from older turns', async () => {
  const corpus = makeAgentCorpus();
  const oldAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });
  const question = '它有哪些步骤？';
  const payload = await runAgent(makeInput({
    question,
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      oldAnswer,
      { role: 'user', content: 'Kafka 重平衡是什么？' },
      {
        role: 'assistant',
        content: '站内暂时没有足够信息。',
        citations: [],
        standaloneQuery: 'Kafka 重平衡'
      },
      { role: 'user', content: question }
    ]
  }), {
    corpus,
    canUseModel: () => false
  });

  assert.equal(payload.meta.stopReason, 'clarification_required');
  assert.equal(payload.meta.retrievalAttempts, 0);
  assert.doesNotMatch(payload.meta.standaloneQuery, /双塔模型/);
  assert.deepEqual(payload.citations, []);
});

test('compound questions require evidence for every bounded subquery', async () => {
  const corpus = makeAgentCorpus();
  const supportedQuestion = '双塔模型的结构是什么；UserCF 的原理是什么';
  const partialQuestion = [
    '双塔模型的结构是什么',
    'UserCF 的原理是什么',
    'Kubernetes Pod 如何调度'
  ].join('；');
  const [supported, partial] = await Promise.all([
    runAgent(makeInput({
      question: supportedQuestion,
      messages: [{ role: 'user', content: supportedQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    }),
    runAgent(makeInput({
      question: partialQuestion,
      messages: [{ role: 'user', content: partialQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    })
  ]);

  assert.equal(supported.meta.evidenceStatus, 'sufficient');
  assert.match(supported.answer, /双塔模型/);
  assert.match(supported.answer, /UserCF/);
  assert.equal(partial.meta.evidenceStatus, 'insufficient');
  assert.equal(partial.meta.retrievalAttempts, 2);
  assert.equal(partial.meta.evidenceReason, 'subquery_evidence_missing');
  assert.deepEqual(partial.citations, []);
});

test('same-message references are resolved before compound retrieval and comparison', async () => {
  const corpus = makeAgentCorpus();
  const compoundQuestion = '双塔模型的结构是什么；它怎样线上召回';
  const comparisonQuestion = 'ItemCF 是什么？它和 UserCF 有什么区别？';
  const [compound, comparison] = await Promise.all([
    runAgent(makeInput({
      question: compoundQuestion,
      messages: [{ role: 'user', content: compoundQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    }),
    runAgent(makeInput({
      question: comparisonQuestion,
      messages: [{ role: 'user', content: comparisonQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    })
  ]);

  assert.notEqual(compound.meta.stopReason, 'clarification_required');
  assert.ok(compound.meta.retrievalAttempts > 0);
  assert.equal(compound.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    new Set(compound.citations.map(citation => citation.title)),
    new Set(['双塔模型'])
  );
  assert.equal(comparison.meta.route, 'article_compare');
  assert.equal(comparison.meta.evidenceStatus, 'sufficient');
  assert.deepEqual(
    new Set(comparison.citations.map(citation => citation.title)),
    new Set(['ItemCF', 'UserCF'])
  );
});

test('generic related requests without an anchor clarify, while explicit topics search', async () => {
  const corpus = makeAgentCorpus();
  const genericQuestions = ['推荐下一篇', '可以推荐几篇吗'];
  const topicQuestion = '推荐几篇 LangGraph 文章';
  const [generics, topic] = await Promise.all([
    Promise.all(genericQuestions.map(question => runAgent(makeInput({
      question,
      messages: [{ role: 'user', content: question }]
    }), {
      corpus,
      canUseModel: () => false
    }))),
    runAgent(makeInput({
      question: topicQuestion,
      messages: [{ role: 'user', content: topicQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    })
  ]);

  for (const generic of generics) {
    assert.equal(generic.meta.stopReason, 'clarification_required');
    assert.equal(generic.meta.retrievalAttempts, 0);
    assert.deepEqual(generic.citations, []);
  }
  assert.equal(topic.meta.route, 'related_articles');
  assert.equal(topic.meta.retrievalAttempts, 1);
  assert.ok(topic.citations.length > 0);
});

test('recommendation-domain questions are not confused with article requests', async () => {
  const corpus = makeAgentCorpus();
  const conceptQuestion = '协同过滤推荐方法是什么';
  const articleQuestion = '请推荐几篇协同过滤文章';
  const [concept, articles] = await Promise.all([
    runAgent(makeInput({
      question: conceptQuestion,
      messages: [{ role: 'user', content: conceptQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    }),
    runAgent(makeInput({
      question: articleQuestion,
      messages: [{ role: 'user', content: articleQuestion }]
    }), {
      corpus,
      canUseModel: () => false
    })
  ]);

  assert.equal(concept.meta.route, 'site_qa');
  assert.equal(articles.meta.route, 'related_articles');
  assert.ok(concept.citations.length > 0);
  assert.ok(articles.related.length > 0);
  assert.doesNotMatch(concept.answer, /帮你翻到几篇|继续看看这些文章/);
});

test('single-topic difference wording is not mistaken for article comparison', async () => {
  const corpus = makeAgentCorpus();
  const question = '协同过滤中的用户差异如何建模';
  const payload = await runAgent(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), {
    corpus,
    canUseModel: () => false
  });

  assert.equal(payload.meta.route, 'site_qa');
  assert.equal(
    payload.meta.toolCalls.every(call => call.name === 'search_blog'),
    true
  );
});
