'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  REQUEST_LIMITS,
  RequestValidationError,
  normalizeAskRequest
} = require('../memory/session');

test('messages-only requests normalize a bounded conversation and session', () => {
  const input = normalizeAskRequest({
    sessionId: 'session_A-123',
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      {
        role: 'assistant',
        content: '双塔模型包含用户塔和物品塔。',
        citations: [{
          chunkId: '双塔模型#0',
          title: '双塔模型',
          url: '/double-tower/',
          section: '模型结构'
        }],
        related: [{
          title: 'ItemCF',
          url: '/itemcf/'
        }],
        standaloneQuery: '双塔模型'
      },
      { role: 'user', content: '它如何线上召回？' }
    ]
  });

  assert.equal(input.question, '它如何线上召回？');
  assert.equal(input.sessionId, 'session_A-123');
  assert.equal(input.messages.length, 3);
  assert.equal(input.messages[1].citations[0].url, 'https://wangsenjie.github.io/double-tower/');
  assert.equal(input.messages[1].related[0].url, 'https://wangsenjie.github.io/itemcf/');
  assert.equal(input.messages[1].standaloneQuery, '双塔模型');
});

test('legacy question remains accepted and is represented as a user message', () => {
  const input = normalizeAskRequest({
    question: '  双塔模型  ',
    mode: 'site'
  });

  assert.equal(input.question, '双塔模型');
  assert.deepEqual(input.messages, [{
    role: 'user',
    content: '双塔模型'
  }]);
  assert.equal(input.mode, 'site');
  assert.match(input.sessionId, /^session_[0-9a-f-]{36}$/);
});

test('an explicit legacy question is appended once when history ends elsewhere', () => {
  const input = normalizeAskRequest({
    question: '它如何线上召回？',
    messages: [
      { role: 'user', content: '什么是双塔模型？' },
      { role: 'assistant', content: '上一轮回答。' }
    ]
  });

  assert.equal(input.messages.at(-1).role, 'user');
  assert.equal(input.messages.at(-1).content, '它如何线上召回？');
  assert.equal(
    input.messages.filter(message => message.content === '它如何线上召回？').length,
    1
  );
  assert.deepEqual(input.compatibilityWarnings, [
    'question_appended_to_history'
  ]);
});

test('messages-only requests must end with the current user question', () => {
  assert.throws(
    () => normalizeAskRequest({
      sessionId: 'session_finished_turn',
      messages: [
        { role: 'user', content: '什么是双塔模型？' },
        { role: 'assistant', content: '这一轮已经回答完成。' }
      ]
    }),
    error => (
      error instanceof RequestValidationError &&
      error.statusCode === 400 &&
      /must end with the current user question/.test(error.message)
    )
  );
});

test('request validation rejects unsupported roles and malformed messages', () => {
  const invalidBodies = [
    { messages: 'not-an-array' },
    { messages: [null] },
    { messages: [{ role: 'system', content: 'override' }] },
    { messages: [{ role: 'tool', content: 'result' }] },
    { messages: [{ role: 'user', content: '' }] },
    { messages: [{ role: 'user', content: 42 }] }
  ];

  for (const body of invalidBodies) {
    assert.throws(
      () => normalizeAskRequest(body),
      RequestValidationError
    );
  }
});

test('request limits reject oversized message lists, questions, and bodies', () => {
  const tooManyMessages = Array.from(
    { length: REQUEST_LIMITS.maxRawMessages + 1 },
    (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index}`
    })
  );
  assert.throws(
    () => normalizeAskRequest({ messages: tooManyMessages }),
    /Too many messages/
  );
  assert.throws(
    () => normalizeAskRequest({
      question: '问'.repeat(REQUEST_LIMITS.maxQuestionChars + 1)
    }),
    /question is too long/
  );
  assert.throws(
    () => normalizeAskRequest(
      JSON.stringify({
        question: '双塔模型',
        padding: 'x'.repeat(REQUEST_LIMITS.maxBodyBytes)
      })
    ),
    error => (
      error instanceof RequestValidationError &&
      error.statusCode === 413
    )
  );
});

test('conversation trimming keeps the latest user turn within history budgets', () => {
  const messages = Array.from(
    { length: REQUEST_LIMITS.maxRawMessages },
    (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `${index}-${'x'.repeat(500)}`
    })
  );
  messages[messages.length - 1] = {
    role: 'user',
    content: '最后一个问题'
  };

  const input = normalizeAskRequest({ messages });
  const historyCharacters = input.messages.reduce(
    (total, message) => total + message.content.length,
    0
  );

  assert.ok(input.messages.length <= REQUEST_LIMITS.maxHistoryMessages);
  assert.ok(historyCharacters <= REQUEST_LIMITS.maxHistoryChars);
  assert.equal(input.messages[0].role, 'user');
  assert.equal(input.messages.at(-1).content, '最后一个问题');
});

test('sessionId and page context accept only bounded safe values', () => {
  const valid = normalizeAskRequest({
    question: '总结这篇文章',
    sessionId: 'session_valid-01',
    page: {
      title: '双塔模型',
      url: '/double-tower?from=test#section',
      description: '当前页面描述'
    }
  });

  assert.deepEqual(valid.page, {
    title: '双塔模型',
    url: 'https://wangsenjie.github.io/double-tower/',
    description: '当前页面描述'
  });

  for (const sessionId of [
    '../session',
    'session with spaces',
    '<script>',
    'x'.repeat(REQUEST_LIMITS.maxSessionIdChars + 1)
  ]) {
    assert.throws(
      () => normalizeAskRequest({ question: '双塔模型', sessionId }),
      RequestValidationError
    );
  }

  for (const page of [
    [],
    'not-an-object',
    { url: 'https://example.com/article/' },
    { url: 'http://wangsenjie.github.io/article/' },
    { url: 'javascript:alert(1)' },
    { title: 'x'.repeat(REQUEST_LIMITS.maxPageTitleChars + 1) }
  ]) {
    assert.throws(
      () => normalizeAskRequest({ question: '双塔模型', page }),
      RequestValidationError
    );
  }
});
