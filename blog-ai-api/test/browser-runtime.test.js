'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const agentSource = fs.readFileSync(
  path.resolve(__dirname, '../../source/js/blog-ai-agent.js'),
  'utf8'
);

function createStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set('blog-ai-agent-conversation-v1', initialValue);
  }

  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createElements() {
  const messages = {
    entries: [],
    lastElementChild: null,
    scrollHeight: 0,
    scrollTop: 0,
    attributes: {},
    _innerHTML: '',
    insertAdjacentHTML(position, html) {
      this.entries.push(html);
      this._innerHTML += html;
      this.lastElementChild = { textContent: '' };
      this.scrollHeight = this.entries.length;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
      this.entries = [];
      this.lastElementChild = null;
    }
  };
  const input = {
    disabled: false,
    value: '',
    focusCalls: 0,
    focus() {
      this.focusCalls += 1;
    }
  };

  return {
    messages,
    input,
    submit: {
      disabled: false,
      textContent: ''
    },
    suggestionButtons: [
      { disabled: false },
      { disabled: false }
    ]
  };
}

function createHarness(fetchImplementation, storedConversation) {
  let testApi;
  let uuidCounter = 0;
  const sessionStorage = createStorage(storedConversation);
  const elements = createElements();
  const retrievalCore = {
    normalizeText(value) {
      return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    },
    normalizePostUrl(value) {
      const url = String(value || '').trim();
      return url.startsWith('https://wangsenjie.github.io/') ? url : '';
    },
    snippet(value, limit) {
      return String(value || '').slice(0, limit);
    },
    detectMode() {
      return 'site';
    },
    getQuestionTerms() {
      return [];
    },
    isDefinitionQuestion() {
      return false;
    },
    filterIndexableChunks(chunks) {
      return Array.isArray(chunks) ? chunks : [];
    },
    rankChunks(chunks) {
      return chunks.length
        ? [{ chunk: chunks[0], score: 1, rank: 1 }]
        : [];
    },
    isIndexableChunk(chunk) {
      return Boolean(
        chunk &&
        chunk.id &&
        chunk.postTitle &&
        chunk.postUrl &&
        chunk.content
      );
    }
  };
  const document = {
    title: '测试页',
    querySelector(selector) {
      if (selector === '.site-title') {
        return { textContent: '测试页' };
      }
      if (selector === 'link[rel="canonical"]') {
        return { href: 'https://wangsenjie.github.io/test/' };
      }
      return null;
    }
  };
  const window = {
    __BLOG_AI_CONFIG__: {
      apiBaseUrl: 'https://api.example',
      apiTimeoutMs: 1000,
      testMode: true
    },
    __BLOG_AI_AGENT_TEST_HOOK__(api) {
      testApi = api;
    },
    BlogAIRetrieval: retrievalCore,
    sessionStorage,
    location: {
      href: 'https://wangsenjie.github.io/test/'
    },
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
      }
    },
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(agentSource, {
    AbortController,
    console,
    document,
    fetch: fetchImplementation,
    setTimeout,
    clearTimeout,
    Uint32Array,
    window
  }, {
    filename: 'blog-ai-agent.js'
  });
  assert.ok(testApi, 'browser test hook should expose the initialized controller');
  testApi.setElements(elements);

  return {
    api: testApi,
    elements,
    sessionStorage
  };
}

test('a valid evidence-insufficient server response never enters local fallback', async () => {
  const requestedUrls = [];
  const harness = createHarness(async url => {
    requestedUrls.push(url);
    return {
      ok: true,
      async json() {
        return {
          answer: '站内暂时没有足够信息。',
          citations: [],
          related: [],
          meta: {
            evidenceStatus: 'insufficient',
            standaloneQuery: '不存在的主题'
          }
        };
      }
    };
  });
  harness.api.restoreConversation();

  await harness.api.ask('不存在的主题');

  assert.deepEqual(requestedUrls, ['https://api.example/api/ask']);
  assert.equal(
    requestedUrls.some(url => String(url).includes('/chunks.json')),
    false
  );
  assert.equal(harness.api.state.messages.length, 2);
  assert.equal(
    harness.api.state.messages[1].content,
    '站内暂时没有足够信息。'
  );
});

test('a structured server answer renders inline citations and keeps feedback receipts out of storage', async () => {
  const receipt = 'f1.feedback_payload.feedback_signature';
  const harness = createHarness(async url => {
    assert.equal(url, 'https://api.example/api/ask');
    return {
      ok: true,
      async json() {
        return {
          answer: '此字段只用作无结构化客户端的后备展示。',
          claims: [{
            text: '双塔模型由用户塔和物品塔组成。',
            citationIds: ['tower#0']
          }],
          citations: [{
            chunkId: 'tower#0',
            title: '双塔模型',
            url: 'https://wangsenjie.github.io/double-tower/',
            section: '结构',
            snippet: '双塔模型由用户塔和物品塔组成。'
          }],
          related: [],
          feedback: {
            receipt,
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          },
          meta: { standaloneQuery: '双塔模型' }
        };
      }
    };
  });
  harness.api.restoreConversation();

  await harness.api.ask('双塔模型');

  assert.match(harness.elements.messages.innerHTML, /双塔模型由用户塔和物品塔组成。/);
  assert.match(harness.elements.messages.innerHTML, /blog-ai-agent__claim-citation/);
  assert.match(harness.elements.messages.innerHTML, /data-feedback-receipt/);
  const stored = harness.sessionStorage.values.get(
    'blog-ai-agent-conversation-v1'
  );
  assert.ok(stored);
  assert.equal(stored.includes(receipt), false);
  assert.equal(JSON.parse(stored).messages.some(message => (
    Object.hasOwn(message, 'feedback')
  )), false);
});

test('reset ignores a late server response and does not recommit stale messages', async () => {
  let resolveFetch;
  const harness = createHarness(() => new Promise(resolve => {
    resolveFetch = resolve;
  }));
  harness.api.restoreConversation();
  const staleRequest = harness.api.ask('旧问题');

  await Promise.resolve();
  harness.api.resetConversation();
  resolveFetch({
    ok: true,
    async json() {
      return {
        answer: '迟到的旧回答',
        citations: [],
        related: [],
        meta: {}
      };
    }
  });
  await staleRequest;

  assert.equal(harness.api.state.messages.length, 0);
  assert.equal(
    harness.elements.messages.innerHTML.includes('迟到的旧回答'),
    false
  );
  assert.equal(harness.api.state.busy, false);
});

test('expired session storage is removed instead of restoring stale history', () => {
  const expired = JSON.stringify({
    version: 1,
    expiresAt: Date.now() - 1,
    sessionId: 'session_expired123',
    messages: [
      { role: 'user', content: '过期问题' },
      { role: 'assistant', content: '过期回答' }
    ]
  });
  const harness = createHarness(async () => {
    throw new Error('fetch should not be called');
  }, expired);

  harness.api.restoreConversation();

  assert.equal(harness.api.state.messages.length, 0);
  assert.notEqual(harness.api.state.sessionId, 'session_expired123');
  const stored = harness.sessionStorage.values.get(
    'blog-ai-agent-conversation-v1'
  );
  assert.equal(stored, undefined);
});

test('an empty latest result clears stale article references before fallback', async () => {
  let requestCount = 0;
  const harness = createHarness(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: true,
        async json() {
          return {
            answer: '站内暂时没有足够信息。',
            citations: [],
            related: [],
            meta: {
              standaloneQuery: 'Kafka 重平衡'
            }
          };
        }
      };
    }
    throw new Error('simulated API outage');
  });
  harness.api.restoreConversation();
  harness.api.state.lastArticleRefs = [{
    title: '双塔模型',
    url: 'https://wangsenjie.github.io/double-tower/',
    chunkId: 'tower#0'
  }];
  harness.api.state.lastStandaloneQuery = '双塔模型';

  await harness.api.ask('Kafka 重平衡是什么？');
  assert.equal(harness.api.state.lastArticleRefs.length, 0);
  await harness.api.ask('它有哪些步骤？');

  const lastMessage = harness.api.state.messages[
    harness.api.state.messages.length - 1
  ];
  assert.match(lastMessage.content, /还不确定你指的是哪个概念或哪篇文章/);
  assert.doesNotMatch(lastMessage.content, /双塔模型/);
});

test('network, non-2xx, and invalid server failures execute local BM25 fallback', async t => {
  const fallbackChunk = {
    id: 'local#0',
    postId: 'local',
    postTitle: '本地降级文章',
    postUrl: 'https://wangsenjie.github.io/local-fallback/',
    sectionTitle: '本地证据',
    content: '这是浏览器本地 BM25 降级返回的站内证据。'
  };
  const variants = [{
    name: 'network error',
    remote() {
      throw new Error('offline');
    }
  }, {
    name: 'non-2xx response',
    remote() {
      return { ok: false, status: 503 };
    }
  }, {
    name: 'invalid response body',
    remote() {
      return {
        ok: true,
        async json() {
          return { citations: [] };
        }
      };
    }
  }];

  for (const variant of variants) {
    await t.test(variant.name, async () => {
      const requestedUrls = [];
      const harness = createHarness(async url => {
        requestedUrls.push(url);
        if (String(url).includes('/api/ask')) return variant.remote();
        return {
          ok: true,
          async json() {
            return [fallbackChunk];
          }
        };
      });
      harness.api.restoreConversation();

      await harness.api.ask('本地降级');

      assert.equal(
        requestedUrls.some(url => String(url).includes('/chunks.json')),
        true
      );
      const lastMessage = harness.api.state.messages[
        harness.api.state.messages.length - 1
      ];
      assert.equal(lastMessage.citations.length, 1);
      assert.equal(lastMessage.citations[0].title, '本地降级文章');
      assert.equal(
        harness.elements.messages.innerHTML.includes('本地检索'),
        true
      );
    });
  }
});

test('reset aborts the stale signal and permits an immediate fresh request', async () => {
  const requests = [];
  const harness = createHarness((url, options) => new Promise(resolve => {
    requests.push({
      resolve,
      signal: options.signal
    });
  }));
  harness.api.restoreConversation();
  const staleRequest = harness.api.ask('旧问题');
  await Promise.resolve();
  const staleSignal = requests[0].signal;

  harness.api.resetConversation();
  assert.equal(staleSignal.aborted, true);
  const freshRequest = harness.api.ask('新问题');
  await Promise.resolve();

  assert.equal(requests.length, 2);
  assert.equal(harness.api.state.busy, true);
  assert.equal(
    harness.elements.suggestionButtons.every(button => button.disabled),
    true
  );
  requests[1].resolve({
    ok: true,
    async json() {
      return {
        answer: '新的回答',
        citations: [],
        related: [],
        meta: {
          standaloneQuery: '新问题'
        }
      };
    }
  });
  await freshRequest;
  requests[0].resolve({
    ok: true,
    async json() {
      return {
        answer: '不应提交的旧回答',
        citations: [],
        related: [],
        meta: {}
      };
    }
  });
  await staleRequest;

  assert.equal(harness.api.state.busy, false);
  assert.equal(harness.api.state.activeController, null);
  assert.equal(
    harness.api.state.messages.some(message => (
      message.content === '新的回答'
    )),
    true
  );
  assert.equal(
    harness.api.state.messages.some(message => (
      message.content === '不应提交的旧回答'
    )),
    false
  );
});
