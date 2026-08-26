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

const MEMORY_TOKEN_A = `m1.${'a'.repeat(43)}.${'b'.repeat(43)}`;
const MEMORY_TOKEN_B = `m1.${'c'.repeat(43)}.${'d'.repeat(43)}`;
const THREAD_A = 'thread_10000000-0000-4000-8000-000000000001';
const THREAD_B = 'thread_20000000-0000-4000-8000-000000000002';

function response(status, payload, headers) {
  const values = Object.assign({}, headers || {});
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return values[name] || values[String(name || '').toLowerCase()] || null;
      }
    },
    async json() {
      return payload;
    }
  };
}

function activeMemory(token, threadId, version, options) {
  const settings = options || {};
  return {
    memoryToken: settings.includeToken === false ? undefined : token,
    memory: {
      status: 'active',
      threadId,
      version,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      restored: settings.restored === true
    },
    context: settings.context || {
      summary: '',
      activeTopic: '',
      recentMessages: [],
      articleRefs: []
    }
  };
}

function storedMemory(token, threadId, version) {
  return JSON.stringify({
    schemaVersion: 1,
    memoryToken: token,
    threadId,
    memoryVersion: version,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
}

function createStorage(initialValue, initialKey) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set(initialKey || 'blog-ai-agent-conversation-v1', initialValue);
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
    newConversation: { disabled: false },
    clearMemory: { disabled: false },
    memoryStatus: {
      textContent: '',
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
    },
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

function createHarness(fetchImplementation, storedConversation, options) {
  const settings = options || {};
  let testApi;
  let uuidCounter = 0;
  const sessionStorage = createStorage(storedConversation);
  const localStorage = createStorage(
    settings.storedMemory,
    'blog-ai-agent-memory-v1'
  );
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
      memoryV1Enabled: settings.memoryV1Enabled === true,
      memoryTimeoutMs: 1000,
      testMode: true
    },
    __BLOG_AI_AGENT_TEST_HOOK__(api) {
      testApi = api;
    },
    BlogAIRetrieval: retrievalCore,
    sessionStorage,
    localStorage,
    location: {
      href: 'https://wangsenjie.github.io/test/'
    },
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
      }
    },
    confirm() {
      return settings.confirmClear !== false;
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
    localStorage,
    sessionStorage
  };
}

test('first browser visit creates and stores only the anonymous memory credential', async () => {
  const requests = [];
  const harness = createHarness(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return response(201, activeMemory(MEMORY_TOKEN_A, THREAD_A, 1));
  }, undefined, { memoryV1Enabled: true });

  await harness.api.bootstrapMemory();

  assert.deepEqual(requests, [{
    url: 'https://api.example/api/memory/session',
    body: {}
  }]);
  assert.equal(harness.api.state.memory.status, 'active');
  assert.equal(harness.api.state.memory.version, 1);
  const persisted = harness.localStorage.values.get('blog-ai-agent-memory-v1');
  assert.ok(persisted);
  assert.equal(JSON.parse(persisted).memoryToken, MEMORY_TOKEN_A);
  assert.equal(/messages|summary|articleRefs/.test(persisted), false);
  assert.match(harness.elements.memoryStatus.textContent, /记忆已开启/);
});

test('a later browser visit restores server messages and article references', async () => {
  const context = {
    summary: '正在学习双塔模型',
    activeTopic: '双塔模型',
    recentMessages: [{
      role: 'user',
      content: '双塔模型是什么？'
    }, {
      role: 'assistant',
      content: '双塔模型包含用户塔和物品塔。',
      citations: [{
        chunkId: 'tower#0',
        title: '双塔模型',
        url: 'https://wangsenjie.github.io/double-tower/',
        section: '结构'
      }],
      standaloneQuery: '双塔模型'
    }],
    articleRefs: [{
      chunkId: 'tower#0',
      title: '双塔模型',
      url: 'https://wangsenjie.github.io/double-tower/'
    }]
  };
  const harness = createHarness(async (url, options) => {
    assert.equal(url, 'https://api.example/api/memory/session');
    assert.deepEqual(JSON.parse(options.body), { memoryToken: MEMORY_TOKEN_A });
    return response(200, activeMemory(MEMORY_TOKEN_A, THREAD_A, 7, {
      includeToken: false,
      restored: true,
      context
    }));
  }, undefined, {
    memoryV1Enabled: true,
    storedMemory: storedMemory(MEMORY_TOKEN_A, THREAD_A, 6)
  });

  await harness.api.bootstrapMemory();

  assert.equal(harness.api.state.memory.restored, true);
  assert.equal(harness.api.state.messages.length, 2);
  assert.equal(harness.api.state.lastStandaloneQuery, '双塔模型');
  assert.equal(harness.api.state.lastArticleRefs[0].title, '双塔模型');
  assert.match(harness.elements.messages.innerHTML, /双塔模型包含用户塔和物品塔/);
  assert.match(harness.elements.memoryStatus.textContent, /记忆已恢复/);
});

test('an empty trusted server thread replaces stale tab history on restore', async () => {
  const storedConversation = JSON.stringify({
    version: 1,
    expiresAt: Date.now() + 60000,
    sessionId: 'session_stalehistory123',
    messages: [
      { role: 'user', content: '不应继续保留的问题' },
      { role: 'assistant', content: '不应继续保留的回答' }
    ],
    lastArticleRefs: [{
      chunkId: 'stale#0',
      title: '旧文章',
      url: 'https://wangsenjie.github.io/stale/'
    }],
    lastStandaloneQuery: '旧主题'
  });
  const harness = createHarness(async () => response(200, activeMemory(
    MEMORY_TOKEN_A,
    THREAD_A,
    2,
    { includeToken: false, restored: true }
  )), storedConversation, {
    memoryV1Enabled: true,
    storedMemory: storedMemory(MEMORY_TOKEN_A, THREAD_A, 1)
  });

  harness.api.restoreConversation();
  assert.equal(harness.api.state.messages.length, 2);
  await harness.api.bootstrapMemory();

  assert.equal(harness.api.state.messages.length, 0);
  assert.equal(harness.api.state.lastArticleRefs.length, 0);
  assert.equal(harness.api.state.lastStandaloneQuery, '');
  assert.equal(
    harness.elements.messages.innerHTML.includes('不应继续保留的回答'),
    false
  );
});

test('managed asks carry token, thread, version, and UUID then persist the new version', async () => {
  let askBody;
  const harness = createHarness(async (url, options) => {
    if (String(url).endsWith('/api/memory/session')) {
      return response(201, activeMemory(MEMORY_TOKEN_A, THREAD_A, 1));
    }
    askBody = JSON.parse(options.body);
    return response(200, {
      answer: '服务端回答',
      citations: [],
      related: [],
      memory: {
        status: 'active',
        writeStatus: 'committed',
        threadId: THREAD_A,
        version: 2,
        expiresAt: new Date(Date.now() + 10000).toISOString()
      },
      meta: { standaloneQuery: '双塔模型' }
    });
  }, undefined, { memoryV1Enabled: true });

  await harness.api.bootstrapMemory();
  await harness.api.ask('双塔模型');

  assert.equal(askBody.memoryToken, MEMORY_TOKEN_A);
  assert.equal(askBody.threadId, THREAD_A);
  assert.equal(askBody.expectedMemoryVersion, 1);
  assert.match(
    askBody.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(harness.api.state.memory.version, 2);
  assert.equal(
    JSON.parse(harness.localStorage.values.get('blog-ai-agent-memory-v1')).memoryVersion,
    2
  );
});

test('an expired server record is replaced explicitly with a new anonymous memory', async () => {
  const calls = [];
  const harness = createHarness(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.memoryToken) {
      return response(410, {
        error: 'Memory session is no longer available',
        code: 'MEMORY_SESSION_GONE'
      });
    }
    return response(201, activeMemory(MEMORY_TOKEN_B, THREAD_B, 1));
  }, undefined, {
    memoryV1Enabled: true,
    storedMemory: storedMemory(MEMORY_TOKEN_A, THREAD_A, 3)
  });

  await harness.api.bootstrapMemory();

  assert.deepEqual(calls, [{ memoryToken: MEMORY_TOKEN_A }, {}]);
  assert.equal(harness.api.state.memory.token, MEMORY_TOKEN_B);
  assert.equal(
    JSON.parse(harness.localStorage.values.get('blog-ai-agent-memory-v1')).memoryToken,
    MEMORY_TOKEN_B
  );
});

test('memory outage keeps bounded session history and sends a compatibility ask', async () => {
  let askBody;
  const storedConversation = JSON.stringify({
    version: 1,
    expiresAt: Date.now() + 60000,
    sessionId: 'session_compatibility123',
    messages: [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' }
    ],
    lastArticleRefs: [],
    lastStandaloneQuery: '旧问题'
  });
  const harness = createHarness(async (url, options) => {
    if (String(url).endsWith('/api/memory/session')) {
      return response(503, {
        error: 'Memory service is temporarily unavailable',
        memory: { status: 'degraded' }
      });
    }
    askBody = JSON.parse(options.body);
    return response(200, {
      answer: '兼容历史回答',
      citations: [],
      related: [],
      meta: {}
    });
  }, storedConversation, { memoryV1Enabled: true });

  harness.api.restoreConversation();
  await harness.api.bootstrapMemory();
  await harness.api.ask('继续解释');

  assert.equal(harness.api.state.memory.status, 'degraded');
  assert.equal(Object.hasOwn(askBody, 'memoryToken'), false);
  assert.equal(askBody.messages.some(message => message.content === '旧回答'), true);
  assert.match(harness.elements.memoryStatus.textContent, /当前对话仍可继续/);
});

test('a version conflict restores the latest metadata and retries without local fallback', async () => {
  let askCount = 0;
  let restoreCount = 0;
  const harness = createHarness(async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).endsWith('/api/memory/session')) {
      if (!body.memoryToken) {
        return response(201, activeMemory(MEMORY_TOKEN_A, THREAD_A, 1));
      }
      restoreCount += 1;
      return response(200, activeMemory(MEMORY_TOKEN_A, THREAD_A, 2, {
        includeToken: false,
        restored: true
      }));
    }
    askCount += 1;
    if (askCount === 1) {
      return response(409, {
        error: 'Memory version conflict',
        code: 'MEMORY_VERSION_CONFLICT'
      });
    }
    assert.equal(body.expectedMemoryVersion, 2);
    return response(200, {
      answer: '重试后的回答',
      citations: [],
      related: [],
      memory: {
        status: 'active',
        writeStatus: 'committed',
        threadId: THREAD_A,
        version: 3
      },
      meta: {}
    });
  }, undefined, { memoryV1Enabled: true });

  await harness.api.bootstrapMemory();
  await harness.api.ask('并发后的问题');

  assert.equal(askCount, 2);
  assert.equal(restoreCount, 1);
  assert.equal(harness.api.state.memory.version, 3);
  assert.equal(harness.elements.messages.innerHTML.includes('本地检索'), false);
});

test('new conversation rotates the server thread and clear memory revokes local state', async () => {
  const requests = [];
  const harness = createHarness(async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, method: options.method, body });
    if (String(url).endsWith('/api/memory/session') && options.method === 'POST') {
      return response(201, activeMemory(MEMORY_TOKEN_A, THREAD_A, 1));
    }
    if (String(url).endsWith('/api/memory/thread')) {
      return response(201, activeMemory(MEMORY_TOKEN_A, THREAD_B, 2, {
        includeToken: false
      }));
    }
    return response(204, {});
  }, undefined, { memoryV1Enabled: true });

  await harness.api.bootstrapMemory();
  harness.api.state.messages = [{ role: 'user', content: '旧线程' }];
  assert.equal(await harness.api.resetConversation(), true);
  assert.equal(harness.api.state.memory.threadId, THREAD_B);
  assert.equal(harness.api.state.messages.length, 0);
  assert.equal(
    requests.find(item => String(item.url).endsWith('/api/memory/thread')).body.currentThreadId,
    THREAD_A
  );

  assert.equal(await harness.api.clearMemory({ skipConfirm: true }), true);
  assert.equal(harness.api.state.memory.status, 'cleared');
  assert.equal(harness.api.state.memory.token, '');
  assert.equal(harness.localStorage.values.has('blog-ai-agent-memory-v1'), false);
  assert.equal(
    requests.some(item => item.method === 'DELETE' && item.body.memoryToken === MEMORY_TOKEN_A),
    true
  );
});

test('a failed clear keeps the credential so the user can retry safely', async () => {
  const harness = createHarness(async (url, options) => {
    if (options.method === 'POST') {
      return response(201, activeMemory(MEMORY_TOKEN_A, THREAD_A, 1));
    }
    return response(503, {
      error: 'Memory service is temporarily unavailable',
      memory: { status: 'degraded' }
    });
  }, undefined, { memoryV1Enabled: true });

  await harness.api.bootstrapMemory();
  assert.equal(await harness.api.clearMemory({ skipConfirm: true }), false);
  assert.equal(harness.api.state.memory.status, 'degraded');
  assert.equal(harness.api.state.memory.token, MEMORY_TOKEN_A);
  assert.equal(harness.localStorage.values.has('blog-ai-agent-memory-v1'), true);
});

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

test('a verified natural server answer wins over claim audit text and keeps feedback receipts out of storage', async () => {
  const receipt = 'f1.feedback_payload.feedback_signature';
  const harness = createHarness(async url => {
    assert.equal(url, 'https://api.example/api/ask');
    return {
      ok: true,
      async json() {
        return {
          answer: '双塔模型会分别编码用户与物品，再比较两个向量。[1]',
          claims: [{
            text: '这段 claim 仅用于审计，不应覆盖自然答案。',
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

  assert.match(harness.elements.messages.innerHTML, /分别编码用户与物品/);
  assert.doesNotMatch(harness.elements.messages.innerHTML, /仅用于审计/);
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
