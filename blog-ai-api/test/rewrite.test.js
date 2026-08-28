'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENT_LIMITS
} = require('../agent/config');
const {
  createAgentState
} = require('../agent/state');
const {
  rewriteStandaloneQuery,
  splitStandaloneQuery
} = require('../agent/nodes/rewrite-query');
const {
  ROUTES,
  routeQuestion
} = require('../agent/nodes/route');
const {
  assistantReference,
  findPost,
  makeAgentCorpus,
  makeInput,
  makePost
} = require('./fixtures/agent-corpus');

function stateFor(input, corpus) {
  const state = createAgentState(input, {
    corpus,
    indexVersion: 'fixture-v1',
    limits: AGENT_LIMITS
  });
  state.route = routeQuestion(state);
  Object.assign(state, rewriteStandaloneQuery(state));
  return state;
}

test('pronoun follow-up is rewritten with a corpus-verified article title', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });
  const input = makeInput({
    question: '它如何线上召回？',
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      previousAnswer,
      { role: 'user', content: '它如何线上召回？' }
    ]
  });
  const state = stateFor(input, corpus);

  assert.equal(state.needsClarification, false);
  assert.match(state.standaloneQuery, /双塔模型/);
  assert.match(state.standaloneQuery, /线上召回/);
});

test('concept follow-up keeps the previous topic instead of narrowing to a cited article', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['usercf#0'], {
    standaloneQuery: '什么是集成学习？'
  });
  const state = stateFor(makeInput({
    question: '他有哪些经典算法？',
    messages: [
      { role: 'user', content: '什么是集成学习？' },
      previousAnswer,
      { role: 'user', content: '他有哪些经典算法？' }
    ]
  }), corpus);

  assert.equal(state.needsClarification, false);
  assert.equal(state.conversationTopic, '集成学习');
  assert.match(state.standaloneQuery, /集成学习有哪些经典算法/);
  assert.doesNotMatch(state.standaloneQuery, /UserCF/);
  assert.deepEqual(state.resolvedArticleRefs, []);
});

test('trusted active topic resolves a cross-session concept follow-up', () => {
  const corpus = makeAgentCorpus();
  const state = stateFor(makeInput({
    question: '它有什么特点？',
    messages: [{ role: 'user', content: '它有什么特点？' }],
    trustedMemory: { activeTopic: '双塔模型' }
  }), corpus);

  assert.equal(state.needsClarification, false);
  assert.equal(state.conversationTopic, '双塔模型');
  assert.match(state.standaloneQuery, /双塔模型有什么特点/);
});

test('human-form pronoun without a conversation topic requests clarification', () => {
  const corpus = makeAgentCorpus();
  const state = stateFor(makeInput({
    question: '他有哪些经典算法？',
    messages: [{ role: 'user', content: '他有哪些经典算法？' }]
  }), corpus);

  assert.equal(state.needsClarification, true);
  assert.equal(state.clarificationReason, 'unresolved_reference');
});

test('pronouns are resolved at sentence end and after an introductory verb', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });

  for (const question of ['请解释它的结构', '介绍一下它', '它呢']) {
    const state = stateFor(makeInput({
      question,
      messages: [
        { role: 'user', content: '什么是双塔模型？' },
        previousAnswer,
        { role: 'user', content: question }
      ]
    }), corpus);

    assert.equal(state.needsClarification, false);
    assert.match(state.standaloneQuery, /双塔模型/);
    assert.doesNotMatch(state.standaloneQuery, /(^|[^\u4e00-\u9fff])它(?=$|[^\u4e00-\u9fff])/);
  }
});

test('second-article reference follows trusted citation order, not assistant prose', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(
    corpus,
    ['langgraph#0', 'memory#0'],
    {
      content: '这里的自由文本故意把顺序写反：状态与短期记忆、LangGraph 基础。'
    }
  );
  const input = makeInput({
    question: '第二篇里的 Reducer 是什么？',
    messages: [
      { role: 'user', content: '给我两篇 LangGraph 文章' },
      previousAnswer,
      { role: 'user', content: '第二篇里的 Reducer 是什么？' }
    ]
  });
  const state = stateFor(input, corpus);

  assert.equal(state.needsClarification, false);
  assert.match(state.standaloneQuery, /状态与短期记忆/);
  assert.doesNotMatch(state.standaloneQuery, /第二篇/);
});

test('previous-article wording resolves to the latest trusted article reference', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });
  const state = stateFor(makeInput({
    question: '上一篇文章的线上召回是怎么做的？',
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      previousAnswer,
      { role: 'user', content: '上一篇文章的线上召回是怎么做的？' }
    ]
  }), corpus);

  assert.equal(state.needsClarification, false);
  assert.match(state.standaloneQuery, /双塔模型/);
  assert.doesNotMatch(state.standaloneQuery, /上一篇/);
});

test('unresolved pronouns request clarification without inventing a referent', () => {
  const corpus = makeAgentCorpus();
  const state = stateFor(makeInput({
    question: '它如何线上召回？',
    messages: [{ role: 'user', content: '它如何线上召回？' }]
  }), corpus);

  assert.equal(state.needsClarification, true);
  assert.equal(state.clarificationReason, 'unresolved_reference');
  assert.equal(state.standaloneQuery, '它如何线上召回？');
});

test('continue follow-up includes the previous standalone topic', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['usercf#0'], {
    standaloneQuery: 'UserCF 的实现'
  });
  const state = stateFor(makeInput({
    question: '继续解释相似度计算',
    messages: [
      { role: 'user', content: 'UserCF 怎么实现？' },
      previousAnswer,
      { role: 'user', content: '继续解释相似度计算' }
    ]
  }), corpus);

  assert.equal(state.needsClarification, false);
  assert.match(state.standaloneQuery, /UserCF 的实现/);
  assert.match(state.standaloneQuery, /继续解释相似度计算/);
  assert.doesNotMatch(state.standaloneQuery, /；/);
});

test('pure continuation remains one standalone query instead of a fake subproblem', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });

  for (const question of ['继续', '继续解释', '展开说说它', '详细说说']) {
    const state = stateFor(makeInput({
      question,
      messages: [
        { role: 'user', content: '什么是双塔模型？' },
        previousAnswer,
        { role: 'user', content: question }
      ]
    }), corpus);
    const split = splitStandaloneQuery(state, corpus.posts);

    assert.equal(state.needsClarification, false);
    assert.match(state.standaloneQuery, /双塔模型/);
    assert.equal(split.subqueries.length, 1);
  }
});

test('continuation uses the latest turn instead of older assistant metadata', () => {
  const corpus = makeAgentCorpus();
  const oldAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });
  const question = '继续解释';
  const state = stateFor(makeInput({
    question,
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      oldAnswer,
      { role: 'user', content: 'Kafka 重平衡是什么？' },
      {
        role: 'assistant',
        content: '站内暂时没有足够信息。',
        citations: []
      },
      { role: 'user', content: question }
    ]
  }), corpus);

  assert.match(state.standaloneQuery, /Kafka 重平衡/);
  assert.doesNotMatch(state.standaloneQuery, /双塔模型/);
});

test('comparison produces bounded, unique subqueries for both targets', () => {
  const corpus = makeAgentCorpus();
  const state = stateFor(makeInput({
    question: '比较 ItemCF 和 UserCF 的区别',
    messages: [{
      role: 'user',
      content: '比较 ItemCF 和 UserCF 的区别'
    }]
  }), corpus);
  const split = splitStandaloneQuery(state, corpus.posts);

  assert.equal(state.route, ROUTES.ARTICLE_COMPARE);
  assert.ok(split.subqueries.length <= AGENT_LIMITS.maxSubqueries);
  assert.deepEqual(split.targetQueries, ['ItemCF', 'UserCF']);
  assert.equal(
    new Set(split.subqueries.map(query => query.toLowerCase())).size,
    split.subqueries.length
  );
});

test('comparison prefers parsed objects over overlapping corpus titles', () => {
  const corpus = makeAgentCorpus();
  corpus.posts.push(
    makePost('rnn', '循环神经网络', 'rnn'),
    makePost('gru', '门控循环神经网络', 'gru'),
    makePost('bpr', 'BPR', 'bpr')
  );
  const question = '门控循环神经网络和 BPR 相比如何？';
  const state = stateFor(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), corpus);
  const split = splitStandaloneQuery(state, corpus.posts);

  assert.equal(state.route, ROUTES.ARTICLE_COMPARE);
  assert.deepEqual(split.targetQueries, ['门控循环神经网络', 'BPR']);
  assert.equal(split.targetQueries.includes('循环神经网络'), false);
});

test('comparison parsing removes recommendation and summary wording from targets', () => {
  const corpus = makeAgentCorpus();

  for (const question of [
    '推荐 ItemCF 和 UserCF 哪个更好',
    '总结 ItemCF 和 UserCF 的区别'
  ]) {
    const state = stateFor(makeInput({
      question,
      messages: [{ role: 'user', content: question }]
    }), corpus);
    const split = splitStandaloneQuery(state, corpus.posts);

    assert.equal(state.route, ROUTES.ARTICLE_COMPARE);
    assert.deepEqual(split.targetQueries, ['ItemCF', 'UserCF']);
  }
});

test('same-message pronouns resolve to a trusted title mentioned earlier', () => {
  const corpus = makeAgentCorpus();

  for (const question of [
    '双塔模型的结构是什么；它怎样线上召回',
    'ItemCF 是什么？它和 UserCF 有什么区别？'
  ]) {
    const state = stateFor(makeInput({
      question,
      messages: [{ role: 'user', content: question }]
    }), corpus);

    assert.equal(state.needsClarification, false);
    assert.doesNotMatch(state.standaloneQuery, /它/);
  }
});

test('same-message antecedents prefer the longest overlapping corpus title', () => {
  const corpus = makeAgentCorpus();
  const rnn = makePost('rnn', '循环神经网络', 'rnn');
  const gru = makePost('gru', '门控循环神经网络', 'gru');
  corpus.posts.push(rnn, gru);
  corpus.chunks.push({
    id: 'rnn#0',
    postId: rnn.id,
    postTitle: rnn.title,
    postUrl: rnn.url,
    tags: [],
    categories: [],
    sectionTitle: '原理',
    content: '循环神经网络处理序列。'
  }, {
    id: 'gru#0',
    postId: gru.id,
    postTitle: gru.title,
    postUrl: gru.url,
    tags: [],
    categories: [],
    sectionTitle: '原理',
    content: '门控循环神经网络使用门控结构。'
  });
  const question = '门控循环神经网络是什么？它如何工作？';
  const state = stateFor(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), corpus);

  assert.equal(state.needsClarification, false);
  assert.match(state.standaloneQuery, /《门控循环神经网络》如何工作/);
  assert.doesNotMatch(state.standaloneQuery, /《循环神经网络》如何工作/);
});

test('same-message reference positions use one coordinate system after whitespace normalization', () => {
  const corpus = makeAgentCorpus();
  const previousAnswer = assistantReference(corpus, ['tower#0'], {
    standaloneQuery: '双塔模型'
  });
  const question = '比较一下          它和 UserCF 有什么区别';
  const state = stateFor(makeInput({
    question,
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      previousAnswer,
      { role: 'user', content: question }
    ]
  }), corpus);
  const split = splitStandaloneQuery(state, corpus.posts);

  assert.equal(state.needsClarification, false);
  assert.match(state.standaloneQuery, /《双塔模型》和 UserCF/);
  assert.deepEqual(split.targetQueries, ['双塔模型', 'UserCF']);
});

test('same-message former, latter, and ordinal references use preceding titles', () => {
  const corpus = makeAgentCorpus();
  const cases = [{
    question: '比较 ItemCF 和 UserCF，前者更适合什么场景？',
    expectedTitle: 'ItemCF'
  }, {
    question: '比较 ItemCF 和 UserCF，后者有什么特点？',
    expectedTitle: 'UserCF'
  }, {
    question: 'ItemCF 和 UserCF，第二篇有什么特点？',
    expectedTitle: 'UserCF'
  }];

  for (const item of cases) {
    const state = stateFor(makeInput({
      question: item.question,
      messages: [{ role: 'user', content: item.question }]
    }), corpus);

    assert.equal(state.needsClarification, false);
    assert.match(state.standaloneQuery, new RegExp(`《${item.expectedTitle}》`));
  }
});

test('compound questions never exceed three subqueries or their length budget', () => {
  const corpus = makeAgentCorpus();
  const question = [
    '双塔模型的结构是什么',
    '它如何训练',
    '线上怎样召回',
    '模型如何更新'
  ].join('；');
  const state = stateFor(makeInput({
    question,
    messages: [{ role: 'user', content: question }]
  }), corpus);
  const split = splitStandaloneQuery(state, corpus.posts);

  assert.equal(split.subqueries.length, AGENT_LIMITS.maxSubqueries);
  assert.equal(
    split.subqueries.every(query => (
      query &&
      query.length <= AGENT_LIMITS.maxSubqueryChars
    )),
    true
  );
});

test('page references are accepted only when their URL exists in the corpus', () => {
  const corpus = makeAgentCorpus();
  const tower = findPost(corpus, '双塔模型');
  const trusted = stateFor(makeInput({
    question: '总结这篇文章',
    messages: [{ role: 'user', content: '总结这篇文章' }],
    page: {
      title: '客户端可伪造的标题',
      url: tower.url,
      description: ''
    }
  }), corpus);
  const missing = stateFor(makeInput({
    question: '总结这篇文章',
    messages: [{ role: 'user', content: '总结这篇文章' }],
    page: {
      title: '不存在的文章',
      url: 'https://wangsenjie.github.io/not-in-corpus/',
      description: ''
    }
  }), corpus);

  assert.equal(trusted.route, ROUTES.PAGE_SUMMARY);
  assert.match(trusted.standaloneQuery, /双塔模型/);
  assert.equal(missing.route, ROUTES.SITE_QA);
  assert.equal(missing.needsClarification, true);
});
