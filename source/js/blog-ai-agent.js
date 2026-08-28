'use strict';

(function() {
  const config = Object.assign(
    {
      apiBaseUrl: '',
      dataBasePath: '/ai-data',
      apiTimeoutMs: 20000,
      memoryV1Enabled: true,
      memoryTimeoutMs: 5000
    },
    window.__BLOG_AI_CONFIG__ || {}
  );
  const retrievalCore = window.BlogAIRetrieval || null;
  const CONVERSATION_STORAGE_KEY = 'blog-ai-agent-conversation-v1';
  const CONVERSATION_SCHEMA_VERSION = 1;
  const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;
  const MEMORY_STORAGE_KEY = 'blog-ai-agent-memory-v1';
  const MEMORY_SCHEMA_VERSION = 1;
  const MAX_STORED_MEMORY_CHARACTERS = 1000;
  const MAX_HISTORY_MESSAGES = 8;
  const MAX_HISTORY_CHARACTERS = 8000;
  const MAX_MESSAGE_CHARACTERS = 2000;
  const MAX_HISTORY_REFERENCES = 6;
  const MAX_STORED_CONVERSATION_CHARACTERS = 50000;
  const GREETING_HTML = `
    <div class="blog-ai-agent__message blog-ai-agent__message--assistant">
      <div class="blog-ai-agent__message-label">向导</div>
      <div class="blog-ai-agent__message-body">嘿嘿，我是你的站内向导。有什么问题？只要站内有的我都能回答哦。</div>
    </div>
  `;

  const state = {
    chunks: null,
    loadingCorpus: null,
    elements: null,
    mathJaxReady: null,
    sessionId: '',
    messages: [],
    lastArticleRefs: [],
    lastStandaloneQuery: '',
    busy: false,
    requestEpoch: 0,
    activeController: null,
    memoryBootstrap: null,
    memoryActionBusy: false,
    memory: {
      status: config.memoryV1Enabled === false ? 'disabled' : 'idle',
      token: '',
      threadId: '',
      version: null,
      expiresAt: '',
      restored: false,
      persistent: false,
      reason: ''
    }
  };
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(value) {
    if (retrievalCore) return retrievalCore.normalizeText(value);
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function snippet(value, maxLength) {
    if (retrievalCore) return retrievalCore.snippet(value, maxLength);
    const condensed = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (condensed.length <= maxLength) return condensed;
    return `${condensed.slice(0, maxLength).trim()}...`;
  }

  function safePostUrl(value) {
    return retrievalCore ? retrievalCore.normalizePostUrl(value) : '';
  }

  function compactText(value, limit) {
    const text = String(value || '').trim();
    return text.length <= limit ? text : text.slice(0, limit).trim();
  }

  function createSessionId() {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return `session_${cryptoApi.randomUUID()}`;
    }

    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const values = new Uint32Array(4);
      cryptoApi.getRandomValues(values);
      return `session_${Array.from(values, value => value.toString(16).padStart(8, '0')).join('')}`;
    }

    return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  }

  function isValidSessionId(value) {
    return /^session_[A-Za-z0-9_-]{8,72}$/.test(String(value || ''));
  }

  function createRequestId() {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }

    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    }

    return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;
  }

  function isValidMemoryToken(value) {
    return /^m1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(String(value || ''));
  }

  function isValidThreadId(value) {
    return /^thread_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function isValidMemoryVersion(value) {
    return Number.isSafeInteger(value) && value >= 1;
  }

  function apiBaseUrl() {
    return String(config.apiBaseUrl || '').replace(/\/$/, '');
  }

  function boundedTimeout(value, fallback) {
    const timeout = Number(value);
    return Number.isFinite(timeout) && timeout > 0
      ? Math.min(Math.max(Math.round(timeout), 1000), 60000)
      : fallback;
  }

  function compactCitation(value) {
    const citation = value && typeof value === 'object' ? value : {};
    const url = safePostUrl(citation.url);
    const title = compactText(citation.title, 200);
    const chunkId = compactText(citation.chunkId, 200);
    if (!url || !title || !chunkId) return null;

    return {
      chunkId,
      title,
      url
    };
  }

  function compactRelated(value) {
    const item = value && typeof value === 'object' ? value : {};
    const url = safePostUrl(item.url);
    const title = compactText(item.title, 200);
    if (!url || !title) return null;

    return { title, url };
  }

  function uniqueCompactReferences(values, compact, limit) {
    const seen = new Set();
    const references = [];

    for (const value of Array.isArray(values) ? values : []) {
      const reference = compact(value);
      if (!reference || seen.has(reference.url)) continue;
      seen.add(reference.url);
      references.push(reference);
      if (references.length >= limit) break;
    }

    return references;
  }

  function normalizeHistoryMessage(value) {
    const message = value && typeof value === 'object' ? value : {};
    if (message.role !== 'user' && message.role !== 'assistant') return null;
    const content = compactText(message.content, MAX_MESSAGE_CHARACTERS);
    if (!content) return null;

    const normalized = {
      role: message.role,
      content
    };

    if (message.role === 'assistant') {
      const citations = uniqueCompactReferences(
        message.citations,
        compactCitation,
        MAX_HISTORY_REFERENCES
      );
      const related = uniqueCompactReferences(
        message.related,
        compactRelated,
        MAX_HISTORY_REFERENCES
      );
      const indexVersion = compactText(message.indexVersion, 128);
      const standaloneQuery = compactText(
        message.standaloneQuery,
        1000
      );
      if (citations.length) normalized.citations = citations;
      if (related.length) normalized.related = related;
      if (indexVersion) normalized.indexVersion = indexVersion;
      if (standaloneQuery) normalized.standaloneQuery = standaloneQuery;
    }

    return normalized;
  }

  function trimConversationMessages(values) {
    const messages = (Array.isArray(values) ? values : [])
      .map(normalizeHistoryMessage)
      .filter(Boolean)
      .slice(-MAX_HISTORY_MESSAGES);
    let totalCharacters = messages.reduce((total, message) => total + message.content.length, 0);

    while (messages.length > 1 && totalCharacters > MAX_HISTORY_CHARACTERS) {
      totalCharacters -= messages.shift().content.length;
    }

    while (messages.length && messages[0].role === 'assistant') {
      messages.shift();
    }

    return messages;
  }

  function collectArticleReferences(citations, related) {
    const references = [];
    const seen = new Set();
    const candidates = [
      ...(Array.isArray(citations) ? citations : []),
      ...(Array.isArray(related) ? related : [])
    ];

    for (const candidate of candidates) {
      const url = safePostUrl(candidate && candidate.url);
      const title = compactText(candidate && candidate.title, 200);
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);
      references.push({
        title,
        url,
        chunkId: compactText(candidate && candidate.chunkId, 200),
        section: compactText(candidate && candidate.section, 200)
      });
      if (references.length >= MAX_HISTORY_REFERENCES) break;
    }

    return references;
  }

  function parseChineseOrdinal(value) {
    if (/^\d+$/.test(value)) return Number(value);
    const numbers = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10
    };
    if (Object.prototype.hasOwnProperty.call(numbers, value)) return numbers[value];
    if (/^十[一二三四五六七八九]$/.test(value)) return 10 + numbers[value.slice(1)];
    return 0;
  }

  function getOrdinalReferences(question, references) {
    const selected = [];
    const indexes = [];
    const ordinalPattern = /第\s*([一二两三四五六七八九十\d]+)\s*(?:篇|个|条)/g;
    let match;

    while ((match = ordinalPattern.exec(question))) {
      const ordinal = parseChineseOrdinal(match[1]);
      if (ordinal > 0 && !indexes.includes(ordinal)) indexes.push(ordinal);
    }

    if (/前者/.test(question) && !indexes.includes(1)) indexes.push(1);
    if (/后者/.test(question) && !indexes.includes(2)) indexes.push(2);
    if (/上一篇(?:文章)?/.test(question) && !indexes.includes(1)) indexes.push(1);

    for (const index of indexes) {
      const reference = references[index - 1];
      if (!reference) {
        return {
          requested: true,
          missing: true,
          selected: []
        };
      }
      selected.push(reference);
    }

    return {
      requested: indexes.length > 0,
      missing: false,
      selected
    };
  }

  function rewriteFollowUpQuestion(question, mode, context) {
    const references = state.lastArticleRefs;
    const ordinal = getOrdinalReferences(question, references);
    if (ordinal.missing) {
      return {
        clarification: '我还没有足够的文章顺序来判断你指的是哪一篇。可以直接告诉我文章标题吗？',
        question,
        mode,
        context
      };
    }

    if (ordinal.selected.length) {
      const titles = ordinal.selected.map(reference => `《${reference.title}》`).join(' 与 ');
      return {
        question: `${titles}：${question}`,
        mode: ordinal.selected.length === 1 ? 'page' : mode,
        context: ordinal.selected.length === 1
          ? {
              title: ordinal.selected[0].title,
              url: ordinal.selected[0].url,
              description: ''
            }
          : context
      };
    }

    const continuation = /继续|接着|展开|详细(?:说|讲|解释)|再(?:说|讲|解释)|然后呢/.test(question);
    const conceptPronoun = /(?:它|他|她|其)(?=的|有|是|能|会|可|应|如何|怎么|怎样|为什么|为何|哪些|什么|呢|和|与|跟|相比|[，。！？?]|$)|(?:这个|那个|上述|前面(?:提到|说到)?的?)(?:模型|方法|算法|框架|概念|技术|主题|问题|机制|系统|过程|(?=有|是|能|会|可|应|如何|怎么|怎样|为什么|为何|哪些|什么|呢|[，。！？?]|$))/.test(question);
    if (!continuation && !conceptPronoun) {
      return { question, mode, context };
    }

    const anchor = references[0] || null;
    const topic = references.length
      ? inferConversationTopic(state.lastStandaloneQuery) ||
        anchor && anchor.title ||
        ''
      : '';
    if (
      (conceptPronoun && !topic) ||
      (!topic && !state.lastStandaloneQuery)
    ) {
      return {
        clarification: '我还不确定你指的是哪个概念或哪篇文章。可以补充一下名称吗？',
        question,
        mode,
        context
      };
    }

    const replaceTopic = () => topic;
    const rewritten = conceptPronoun
      ? question
        .replace(
          /(?:这个|那个|上述|前面(?:提到|说到)?的?)(?:模型|方法|算法|框架|概念|技术|主题|问题|机制|系统|过程)/g,
          replaceTopic
        )
        .replace(
          /(?:它|他|她|其)(?=的|有|是|能|会|可|应|如何|怎么|怎样|为什么|为何|哪些|什么|呢|和|与|跟|相比|[，。！？?]|$)|(?:这个|那个|上述|前面(?:提到|说到)?的?)(?=有|是|能|会|可|应|如何|怎么|怎样|为什么|为何|哪些|什么|呢|[，。！？?]|$)/g,
          replaceTopic
        )
      : `${topic || state.lastStandaloneQuery}：${question}`;

    return {
      question: rewritten,
      mode,
      context
    };
  }

  function inferConversationTopic(value) {
    let text = String(value || '')
      .replace(/[《》]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[，。；：！？?、,.!]+$/g, '')
      .trim();
    if (!text) return '';
    text = text.replace(
      /^(?:请|麻烦|帮我|给我)?\s*(?:介绍|解释|说明|讲讲|说说)(?:一下)?\s*/,
      ''
    ).trim();
    const definition = text.match(/^(?:什么是|何为)\s*(.{2,160})$/);
    if (definition) return definition[1].replace(/的$/g, '').trim();
    const subject = text.match(
      /^(.{2,160}?)(?:的)?(?:是什么|有哪些|有什么|有何|如何|怎么|怎样|为什么|为何|是否|能否|包含什么|包括什么)/
    );
    if (subject) return subject[1].replace(/的$/g, '').trim();
    return text.length <= 160 ? text : '';
  }

  function storage() {
    try {
      return window.sessionStorage || null;
    } catch (error) {
      return null;
    }
  }

  function saveConversation() {
    const sessionStorage = storage();
    if (!sessionStorage) return;

    const payload = {
      version: CONVERSATION_SCHEMA_VERSION,
      expiresAt: Date.now() + CONVERSATION_TTL_MS,
      sessionId: state.sessionId,
      messages: trimConversationMessages(state.messages),
      lastArticleRefs: collectArticleReferences(state.lastArticleRefs, []),
      lastStandaloneQuery: compactText(state.lastStandaloneQuery, MAX_MESSAGE_CHARACTERS)
    };

    try {
      sessionStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // The widget remains usable when session storage is unavailable or full.
    }
  }

  function restoreConversation() {
    const sessionStorage = storage();
    let payload = null;

    try {
      const serialized = sessionStorage
        ? sessionStorage.getItem(CONVERSATION_STORAGE_KEY)
        : null;
      payload = serialized && serialized.length <= MAX_STORED_CONVERSATION_CHARACTERS
        ? JSON.parse(serialized)
        : null;
    } catch (error) {
      payload = null;
    }

    if (
      !payload ||
      payload.version !== CONVERSATION_SCHEMA_VERSION ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now() ||
      !isValidSessionId(payload.sessionId)
    ) {
      if (sessionStorage) {
        try {
          sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
        } catch (error) {
          // Ignore storage cleanup failures.
        }
      }
      state.sessionId = createSessionId();
      state.messages = [];
      state.lastArticleRefs = [];
      state.lastStandaloneQuery = '';
      return;
    }

    state.sessionId = payload.sessionId;
    state.messages = trimConversationMessages(payload.messages);
    state.lastArticleRefs = collectArticleReferences(payload.lastArticleRefs, []);
    state.lastStandaloneQuery = compactText(
      payload.lastStandaloneQuery,
      MAX_MESSAGE_CHARACTERS
    );
  }

  function memoryStorage() {
    try {
      return window.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function removeStoredMemory() {
    const localStorage = memoryStorage();
    if (!localStorage) return;
    try {
      localStorage.removeItem(MEMORY_STORAGE_KEY);
    } catch (error) {
      // The widget remains usable when persistent browser storage is blocked.
    }
  }

  function readStoredMemory() {
    const localStorage = memoryStorage();
    if (!localStorage) return null;
    let payload;
    try {
      const serialized = localStorage.getItem(MEMORY_STORAGE_KEY);
      if (!serialized || serialized.length > MAX_STORED_MEMORY_CHARACTERS) {
        return null;
      }
      payload = JSON.parse(serialized);
    } catch (error) {
      payload = null;
    }

    const expiresAt = String(payload && payload.expiresAt || '');
    const expiresAtMs = Date.parse(expiresAt);
    if (
      !payload ||
      payload.schemaVersion !== MEMORY_SCHEMA_VERSION ||
      !isValidMemoryToken(payload.memoryToken) ||
      (expiresAt && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()))
    ) {
      removeStoredMemory();
      return null;
    }

    return {
      memoryToken: payload.memoryToken,
      threadId: isValidThreadId(payload.threadId) ? payload.threadId : '',
      memoryVersion: isValidMemoryVersion(payload.memoryVersion)
        ? payload.memoryVersion
        : null,
      expiresAt
    };
  }

  function saveStoredMemory() {
    if (!isValidMemoryToken(state.memory.token)) return false;
    const localStorage = memoryStorage();
    if (!localStorage) return false;
    const payload = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      memoryToken: state.memory.token,
      threadId: isValidThreadId(state.memory.threadId)
        ? state.memory.threadId
        : '',
      memoryVersion: isValidMemoryVersion(state.memory.version)
        ? state.memory.version
        : null,
      expiresAt: state.memory.expiresAt || ''
    };
    try {
      localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (error) {
      return false;
    }
  }

  function memoryStatusCopy() {
    const status = state.memory.status;
    if (status === 'active') {
      if (state.memory.persistent === false) {
        return '记忆已开启 · 浏览器存储受限，关闭页面后无法恢复';
      }
      return state.memory.restored
        ? '记忆已恢复 · 30 天未使用后自动删除'
        : '记忆已开启 · 本浏览器可恢复最近对话，30 天未使用后自动删除';
    }
    if (status === 'initializing') return '正在连接匿名记忆…';
    if (status === 'degraded') return '记忆暂不可用 · 当前对话仍可继续';
    if (status === 'cleared') return '记忆已清除 · 后续将从空白记忆开始';
    return '记忆未启用 · 仅保留当前标签页短历史';
  }

  function updateMemoryUi() {
    if (!state.elements) return;
    if (state.elements.memoryStatus) {
      state.elements.memoryStatus.textContent = memoryStatusCopy();
      state.elements.memoryStatus.setAttribute(
        'data-memory-state',
        state.memory.status
      );
    }
    if (state.elements.clearMemory) {
      state.elements.clearMemory.disabled = (
        state.memoryActionBusy ||
        state.memory.status === 'initializing' ||
        !isValidMemoryToken(state.memory.token)
      );
    }
    if (state.elements.newConversation) {
      state.elements.newConversation.disabled = (
        state.memoryActionBusy || state.memory.status === 'initializing'
      );
    }
  }

  function setMemoryStatus(status, values) {
    state.memory = Object.assign({}, state.memory, values || {}, { status });
    updateMemoryUi();
  }

  function clearMemoryCredential(status, reason) {
    removeStoredMemory();
    state.memory = {
      status: status || 'cleared',
      token: '',
      threadId: '',
      version: null,
      expiresAt: '',
      restored: false,
      persistent: false,
      reason: reason || ''
    };
    updateMemoryUi();
  }

  function replaceConversationHistory() {
    if (!state.elements || !state.elements.messages) return;
    state.elements.messages.innerHTML = GREETING_HTML;
    renderConversationHistory();
  }

  function hydrateMemoryContext(context) {
    const source = context && typeof context === 'object' ? context : {};
    const recentMessages = trimConversationMessages(source.recentMessages);
    state.messages = recentMessages;
    replaceConversationHistory();

    state.lastArticleRefs = collectArticleReferences(source.articleRefs, []);
    const latestAssistant = [...recentMessages].reverse().find(message => (
      message.role === 'assistant' && message.standaloneQuery
    ));
    state.lastStandaloneQuery = compactText(
      latestAssistant && latestAssistant.standaloneQuery || source.activeTopic,
      MAX_MESSAGE_CHARACTERS
    );
    saveConversation();
  }

  function applyActiveMemory(payload, options) {
    const settings = options || {};
    const memory = payload && payload.memory;
    const token = String(
      settings.memoryToken || state.memory.token || payload && payload.memoryToken || ''
    );
    if (
      !memory || memory.status !== 'active' ||
      !isValidMemoryToken(token) ||
      !isValidThreadId(memory.threadId) ||
      !isValidMemoryVersion(memory.version)
    ) {
      throw new Error('Memory API returned an invalid response');
    }

    state.memory = {
      status: 'active',
      token,
      threadId: memory.threadId,
      version: memory.version,
      expiresAt: String(memory.expiresAt || ''),
      restored: memory.restored === true || settings.restored === true,
      persistent: false,
      reason: ''
    };
    state.memory.persistent = saveStoredMemory();
    updateMemoryUi();
    if (settings.hydrate && payload.context) {
      hydrateMemoryContext(payload.context);
    }
    return state.memory;
  }

  async function memoryApiRequest(path, method, body) {
    const baseUrl = apiBaseUrl();
    if (!baseUrl) throw new Error('Remote API is not configured');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      boundedTimeout(config.memoryTimeoutMs, 5000)
    );
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
      let payload = {};
      if (response.status !== 204) {
        try {
          payload = await response.json();
        } catch (error) {
          payload = {};
        }
      }
      if (!response.ok) {
        const requestError = new Error(payload.error || `Memory API failed: ${response.status}`);
        requestError.statusCode = response.status;
        requestError.code = payload.code || '';
        requestError.memoryStatus = payload.memory && payload.memory.status;
        const retryAfter = response.headers && response.headers.get
          ? Number(response.headers.get('Retry-After'))
          : 0;
        requestError.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 3000)
          : 0;
        throw requestError;
      }
      return { payload, statusCode: response.status };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function createMemorySession(options) {
    const settings = options || {};
    const response = await memoryApiRequest('/api/memory/session', 'POST', {});
    return applyActiveMemory(response.payload, {
      memoryToken: response.payload.memoryToken,
      hydrate: settings.hydrate === true,
      restored: false
    });
  }

  async function restoreMemorySession(options) {
    const settings = options || {};
    const token = settings.memoryToken || state.memory.token;
    if (!isValidMemoryToken(token)) throw new Error('Memory token is unavailable');
    const response = await memoryApiRequest('/api/memory/session', 'POST', {
      memoryToken: token
    });
    return applyActiveMemory(response.payload, {
      memoryToken: token,
      hydrate: settings.hydrate !== false,
      restored: true
    });
  }

  function memoryUnavailable(error) {
    const status = error && error.memoryStatus === 'disabled'
      ? 'disabled'
      : 'degraded';
    setMemoryStatus(status, {
      reason: error && error.code || 'memory_unavailable'
    });
  }

  async function bootstrapMemory() {
    const stored = readStoredMemory();
    if (stored) {
      state.memory.token = stored.memoryToken;
      state.memory.threadId = stored.threadId;
      state.memory.version = stored.memoryVersion;
      state.memory.expiresAt = stored.expiresAt;
      state.memory.persistent = true;
    }
    if (config.memoryV1Enabled === false || !apiBaseUrl()) {
      setMemoryStatus('disabled', { reason: 'feature_disabled' });
      return state.memory;
    }

    setMemoryStatus('initializing', { reason: '' });
    if (stored) {
      try {
        return await restoreMemorySession({
          memoryToken: stored.memoryToken,
          hydrate: true
        });
      } catch (error) {
        if (![400, 401, 410].includes(error && error.statusCode)) {
          memoryUnavailable(error);
          return state.memory;
        }
        clearMemoryCredential('initializing', 'credential_rejected');
      }
    }

    try {
      return await createMemorySession({ hydrate: false });
    } catch (error) {
      memoryUnavailable(error);
      return state.memory;
    }
  }

  function startMemoryBootstrap() {
    if (!state.memoryBootstrap) {
      state.memoryBootstrap = bootstrapMemory().finally(() => {
        state.memoryBootstrap = null;
      });
    }
    return state.memoryBootstrap;
  }

  async function ensureMemoryReady() {
    if (state.memoryBootstrap) await state.memoryBootstrap;
    if (state.memory.status === 'idle' || state.memory.status === 'cleared') {
      await startMemoryBootstrap();
    }
    return state.memory;
  }

  function managedMemoryFields(requestId) {
    if (
      state.memory.status !== 'active' ||
      !isValidMemoryToken(state.memory.token) ||
      !isValidThreadId(state.memory.threadId) ||
      !isValidMemoryVersion(state.memory.version)
    ) {
      return {};
    }
    return {
      memoryToken: state.memory.token,
      threadId: state.memory.threadId,
      expectedMemoryVersion: state.memory.version,
      requestId
    };
  }

  function applyAskMemory(memory) {
    if (!memory || typeof memory !== 'object') return;
    if (
      memory.status === 'active' &&
      isValidThreadId(memory.threadId) &&
      isValidMemoryVersion(memory.version)
    ) {
      state.memory = Object.assign({}, state.memory, {
        status: 'active',
        threadId: memory.threadId,
        version: memory.version,
        expiresAt: String(memory.expiresAt || state.memory.expiresAt || ''),
        restored: state.memory.restored,
        persistent: state.memory.persistent,
        reason: memory.writeStatus && memory.writeStatus !== 'committed'
          ? memory.writeStatus
          : ''
      });
      state.memory.persistent = saveStoredMemory();
      updateMemoryUi();
      return;
    }
    if (memory.status === 'degraded' || memory.status === 'disabled') {
      setMemoryStatus(memory.status, {
        reason: memory.reason || memory.writeStatus || 'memory_unavailable'
      });
    }
  }

  function ensureMathJaxLoaded() {
    if (state.mathJaxReady) {
      return state.mathJaxReady;
    }

    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
      state.mathJaxReady = Promise.resolve(window.MathJax);
      return state.mathJaxReady;
    }

    state.mathJaxReady = new Promise((resolve, reject) => {
      if (typeof window.MathJax === 'undefined') {
        window.MathJax = {
          tex: {
            inlineMath: [['$', '$'], ['\\(', '\\)']],
            displayMath: [['$$', '$$'], ['\\[', '\\]']],
            tags: 'ams'
          }
        };
      }

      const existingScript = document.querySelector('script[data-blog-ai-mathjax]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.MathJax), { once: true });
        existingScript.addEventListener('error', reject, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml-full.js';
      script.defer = true;
      script.setAttribute('data-blog-ai-mathjax', 'true');
      script.addEventListener('load', () => resolve(window.MathJax), { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });

    return state.mathJaxReady;
  }

  async function typesetMath(target) {
    const text = target && target.textContent ? target.textContent : '';
    if (!text || !/[\\$]/.test(text)) {
      return;
    }

    try {
      const mathJax = await ensureMathJaxLoaded();
      if (!mathJax || typeof mathJax.typesetPromise !== 'function') {
        return;
      }

      if (mathJax.startup && mathJax.startup.document) {
        mathJax.startup.document.state(0);
      }
      if (typeof mathJax.texReset === 'function') {
        mathJax.texReset();
      }
      await mathJax.typesetPromise([target]);
    } catch (error) {
      // Keep raw LaTeX visible if MathJax fails.
    }
  }

  function getCurrentContext() {
    const metaDescription = document.querySelector('meta[name="description"]');
    const pageTitle = document.querySelector('.post-title') || document.querySelector('.site-title');
    const canonical = document.querySelector('link[rel="canonical"]');

    return {
      title: pageTitle ? pageTitle.textContent.trim() : document.title,
      url: canonical && canonical.href ? canonical.href : window.location.href,
      description: metaDescription ? metaDescription.getAttribute('content') : ''
    };
  }

  function getQuestionTerms(question) {
    return retrievalCore ? retrievalCore.getQuestionTerms(question) : [];
  }

  function isDefinitionQuestion(question) {
    return retrievalCore
      ? retrievalCore.isDefinitionQuestion(question)
      : /什么是|是什么|定义|指什么|指的是/.test(String(question || ''));
  }

  function detectMode(question) {
    if (retrievalCore) return retrievalCore.detectMode(question);
    const text = String(question || '');
    if (/总结|概括|摘要/.test(text)) return 'page_summary';
    if (/这篇|本文|本页|当前页|这一页/.test(text)) return 'page';
    return 'site';
  }

  async function loadCorpus() {
    if (state.chunks) {
      return { chunks: state.chunks };
    }

    if (state.loadingCorpus) {
      return state.loadingCorpus;
    }

    const basePath = String(config.dataBasePath || '/ai-data').replace(/\/$/, '');

    state.loadingCorpus = fetch(`${basePath}/chunks.json`, { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error('Failed to load chunks.json');
        return response.json();
      })
      .then(chunks => {
        if (!retrievalCore) throw new Error('Local retrieval core is unavailable');
        state.chunks = retrievalCore.filterIndexableChunks(chunks);
        return { chunks: state.chunks };
      })
      .catch(error => {
        state.loadingCorpus = null;
        throw error;
      });

    return state.loadingCorpus;
  }

  function rankChunks(question, mode, context) {
    if (!retrievalCore) throw new Error('Local retrieval core is unavailable');
    return retrievalCore.rankChunks(state.chunks, question, mode, context);
  }

  function uniqueCitations(ranked, limit) {
    const seen = new Set();
    const citations = [];

    for (const item of ranked) {
      const chunk = item.chunk;
      if (!retrievalCore || !retrievalCore.isIndexableChunk(chunk)) continue;
      const postUrl = safePostUrl(chunk.postUrl);
      if (!postUrl) continue;
      const key = chunk.id;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        chunkId: chunk.id,
        title: chunk.postTitle,
        url: postUrl,
        section: chunk.sectionTitle || '',
        snippet: snippet(chunk.content, 140)
      });
      if (citations.length >= limit) break;
    }

    return citations;
  }

  function uniqueRelated(ranked, context, limit) {
    const seen = new Set();
    const related = [];
    const currentUrl = safePostUrl(context && context.url);

    for (const item of ranked) {
      const chunk = item.chunk;
      const postUrl = safePostUrl(chunk && chunk.postUrl);
      if (!postUrl || seen.has(postUrl) || postUrl === currentUrl) continue;
      seen.add(postUrl);
      related.push({
        title: chunk.postTitle,
        url: postUrl
      });
      if (related.length >= limit) break;
    }

    return related;
  }

  function buildSummaryAnswer(ranked, context) {
    const sentences = [];

    for (const item of ranked) {
      const parts = String(item.chunk.content || '')
        .split(/[。！？\n]+/)
        .map(part => part.trim())
        .filter(Boolean);

      for (const part of parts) {
        if (part.length < 8) continue;
        sentences.push(part);
        if (sentences.length >= 3) break;
      }

      if (sentences.length >= 3) break;
    }

    if (!sentences.length) {
      return '唔，这页内容有点绕，向导还没摘出特别稳的小总结。不过别急，线索已经给你摆在下面啦，先看看引用也可以。';
    }

    return `嘿嘿，向导来帮你划重点啦：\n- ${sentences.join('\n- ')}`;
  }

  function definitionSnippet(chunk, question) {
    const terms = getQuestionTerms(question);
    const sentences = String(chunk.content || '')
      .split(/[。！？\n]+/)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length >= 8);
    const includesQuestionTerm = sentence => {
      const normalizedSentence = normalizeText(sentence);
      return terms.some(term => normalizedSentence.includes(term));
    };
    const definition = sentences.find(sentence => (
      includesQuestionTerm(sentence) && /是一种|指的是|称为/.test(sentence)
    )) || sentences.find(includesQuestionTerm) || sentences[0] || chunk.content;

    return snippet(definition, 280);
  }

  function buildSearchAnswer(question, ranked) {
    const top = ranked[0] && ranked[0].chunk;
    const relatedCount = Math.min(ranked.length, 3);

    if (!top) {
      return '欸？这次我还没翻到特别贴近的内容呢。你可以换个关键词试试，或者直接把文章标题、标签、主题词丢给我呀。';
    }

    const lead = snippet(top.content, 180);
    if (isDefinitionQuestion(question)) {
      return `《${top.postTitle}》中介绍：${definitionSnippet(top, question)}`;
    }

    if (isRelatedArticleRequest(question)) {
      return `让我看看哦...我帮你翻到几篇更贴近的文章啦。排在最前面的是《${top.postTitle}》，内容重点大致是：${lead}`;
    }

    return `锵锵，向导在站内翻到了 ${relatedCount} 篇比较相关的内容。最贴近的是《${top.postTitle}》，先给你一个小结：${lead}`;
  }

  function isRelatedArticleRequest(question) {
    const text = String(question || '');
    if (/相关文章|相关推荐|延伸阅读|下一篇|类似文章/.test(text)) {
      return true;
    }
    return (
      /(?:请|帮我|给我|能否|可以|我想(?:看|读))[^。！？?!]{0,20}推荐/.test(text) ||
      /推荐(?:给我)?\s*(?:几|一|两|三|一些|若干)(?:篇|个|本)?/.test(text) ||
      /推荐(?:给我)?\s*(?:文章|阅读|一下)/.test(text)
    );
  }

  function isGenericRelatedRequest(question) {
    if (!isRelatedArticleRequest(question)) {
      return false;
    }
    const remaining = String(question || '')
      .toLowerCase()
      .replace(
        /相关文章|相关推荐|延伸阅读|类似文章|下一篇|推荐|文章|几篇|一些|我|请|帮我|给我|应该|想要|想看|看看|阅读|读|看|什么|哪些|一下|有|吗/g,
        ''
      )
      .replace(
        /可以|能否|麻烦/g,
        ''
      )
      .replace(/[\s，。；：！？?、,.!]/g, '');
    return remaining.length < 2;
  }

  function requiresServerPhase5Feature(question) {
    const text = String(question || '');
    return /学习路径|学习路线|阅读顺序|学习计划|下一篇|下一步(?:该)?(?:看|学|读)|接下来(?:该)?(?:看|学|读)|(?:先|应该先)(?:看|学|读)|代码块|这段代码|第\s*[一二两三四五六七八九十\d]+\s*段代码|解释.{0,30}代码|逐行(?:解释|讲解)|对比|比较|有何异同|哪个(?:更好|更适合)/.test(text);
  }

  function unavailablePhase5Answer(question) {
    if (/代码/.test(String(question || ''))) {
      return '代码块解释需要服务端按原文代码索引定位；服务暂不可用时，我不会用本地检索猜测代码含义。';
    }
    if (/对比|比较|异同|哪个/.test(String(question || ''))) {
      return '多文章维度对齐需要服务端逐项核对原文证据；服务暂不可用时，我不会用本地相似度代替对比结论。';
    }
    return '学习路径和“下一篇”依赖服务端维护的文章图谱；服务暂不可用时，我不会把本地相关文章检索当作前置关系。';
  }

  async function localAsk(question, mode, context, ranked) {
    if (requiresServerPhase5Feature(question)) {
      return {
        answer: unavailablePhase5Answer(question),
        citations: [],
        related: []
      };
    }
    if (!ranked) {
      await loadCorpus();
      if (isGenericRelatedRequest(question)) {
        const contextUrl = safePostUrl(context && context.url);
        const hasIndexedContext = state.chunks.some(chunk => (
          safePostUrl(chunk && chunk.postUrl) === contextUrl
        ));
        if (!hasIndexedContext) {
          return {
            answer: '我还不能确定你想从哪篇文章继续阅读。请先打开一篇文章，或直接告诉我感兴趣的主题。',
            citations: [],
            related: []
          };
        }
      }
      ranked = rankChunks(question, mode, context);
    }
    if (!ranked.length) {
      return {
        answer: '欸？这次我还没翻到特别贴近的内容呢。你可以换个关键词试试，或者直接把文章标题、标签、主题词丢给我呀。',
        citations: [],
        related: []
      };
    }

    return {
      answer: mode === 'page_summary'
        ? buildSummaryAnswer(ranked, context)
        : buildSearchAnswer(question, ranked),
      citations: uniqueCitations(ranked, 3),
      related: uniqueRelated(ranked, context, 3)
    };
  }

  async function remoteAsk(question, mode, context, messages, requestId) {
    const baseUrl = apiBaseUrl();
    if (!baseUrl) throw new Error('Remote API is not configured');
    const timeoutMs = boundedTimeout(config.apiTimeoutMs, 20000);
    const controller = new AbortController();
    state.activeController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/api/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'omit',
        body: JSON.stringify(Object.assign({
          question,
          sessionId: state.sessionId,
          messages,
          mode,
          page: context
        }, managedMemoryFields(requestId))),
        signal: controller.signal
      });
      if (!response.ok) {
        let errorPayload = {};
        try {
          errorPayload = await response.json();
        } catch (error) {
          errorPayload = {};
        }
        const requestError = new Error(
          errorPayload.error || `Remote API failed: ${response.status}`
        );
        requestError.statusCode = response.status;
        requestError.code = errorPayload.code || '';
        const retryAfter = response.headers && response.headers.get
          ? Number(response.headers.get('Retry-After'))
          : 0;
        requestError.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 3000)
          : 0;
        throw requestError;
      }

      const result = await response.json();
      if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
        throw new Error('Remote API returned an invalid response');
      }
      applyAskMemory(result.memory);

      return {
        answer: result.answer,
        citations: Array.isArray(result.citations) ? result.citations : [],
        claims: Array.isArray(result.claims) ? result.claims : [],
        unansweredSubquestions: Array.isArray(result.unansweredSubquestions)
          ? result.unansweredSubquestions
          : [],
        related: Array.isArray(result.related) ? result.related : [],
        comparison: result.comparison && typeof result.comparison === 'object'
          ? result.comparison
          : null,
        learningPath: result.learningPath && typeof result.learningPath === 'object'
          ? result.learningPath
          : null,
        codeExplanation: result.codeExplanation && typeof result.codeExplanation === 'object'
          ? result.codeExplanation
          : null,
        meta: result.meta || null,
        feedback: result.feedback || null,
        memory: result.memory || null
      };
    } finally {
      window.clearTimeout(timeoutId);
      if (state.activeController === controller) {
        state.activeController = null;
      }
    }
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function remoteAskWithMemoryRecovery(
    question,
    mode,
    context,
    messages,
    requestId
  ) {
    try {
      return await remoteAsk(question, mode, context, messages, requestId);
    } catch (error) {
      const hadManagedMemory = isValidMemoryToken(state.memory.token);
      if (!hadManagedMemory) throw error;

      if ([400, 401, 410].includes(error && error.statusCode)) {
        clearMemoryCredential('idle', 'credential_rejected');
        await startMemoryBootstrap();
        if (state.memory.status !== 'active') throw error;
        return remoteAsk(question, mode, context, messages, requestId);
      }

      if (error && error.statusCode === 409) {
        if (error.code === 'MEMORY_REQUEST_PROCESSING' && error.retryAfterMs) {
          await wait(error.retryAfterMs);
        } else {
          try {
            await restoreMemorySession({ hydrate: false });
          } catch (restoreError) {
            memoryUnavailable(restoreError);
          }
        }
        return remoteAsk(question, mode, context, messages, requestId);
      }

      if (error && error.statusCode === 503) {
        memoryUnavailable(error);
        return remoteAsk(question, mode, context, messages, requestId);
      }

      throw error;
    }
  }

  function validFeedbackReceipt(value) {
    const feedback = value && typeof value === 'object' ? value : null;
    const receipt = feedback && String(feedback.receipt || '').trim();
    const expiresAt = feedback && String(feedback.expiresAt || '').trim();
    if (!/^f1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(receipt || '')) {
      return null;
    }
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      return null;
    }
    return { receipt, expiresAt };
  }

  function renderAnswerBody(result) {
    const citations = Array.isArray(result.citations) ? result.citations : [];
    const answer = String(result.answer || '').trim();
    if (!answer) return '';
    const linked = escapeHtml(answer).replace(/\[(\d+)\]/g, (marker, value) => {
      const index = Number(value);
      const citation = citations[index - 1];
      if (!citation) return marker;
      const url = safePostUrl(citation.url);
      return url
        ? `<a class="blog-ai-agent__claim-citation" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="查看回答引用 ${index}">[${index}]</a>`
        : `<span class="blog-ai-agent__claim-citation">[${index}]</span>`;
    });
    return linked
      .split(/\n+/)
      .map(line => `<p class="blog-ai-agent__claim">${line.replace(/^-\s*/, '')}</p>`)
      .join('');
  }

  function safeCodeAnchor(value) {
    const anchor = String(value || '').trim();
    return /^blog-ai-code-[a-f0-9]{24}$/.test(anchor) ? anchor : '';
  }

  function renderComparison(result) {
    const comparison = result && result.comparison;
    if (!comparison || !Array.isArray(comparison.articles) ||
      !Array.isArray(comparison.rows) || !comparison.articles.length) {
      return '';
    }
    const citations = Array.isArray(result.citations) ? result.citations : [];
    const citationsById = new Map(citations.map((citation, index) => [
      String(citation && citation.chunkId || ''),
      { citation, index: index + 1 }
    ]));
    const headings = comparison.articles.map(article => {
      const url = safePostUrl(article && article.url);
      const title = compactText(article && article.title, 200);
      if (!title) return '<th scope="col">文章</th>';
      const label = escapeHtml(title);
      return `<th scope="col">${url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label}</th>`;
    }).join('');
    const rows = comparison.rows.map(row => {
      const cells = comparison.articles.map(article => {
        const articleUrl = safePostUrl(article && article.url);
        const cell = (row.cells || []).find(item => (
          safePostUrl(item && item.articleUrl) === articleUrl
        ));
        if (!cell || !cell.available || !compactText(cell.text, 800)) {
          return '<td class="blog-ai-agent__comparison-empty">暂无可展示的站内原文</td>';
        }
        const citation = citationsById.get(String(cell.citationId || ''));
        const citationLink = citation && safePostUrl(citation.citation && citation.citation.url)
          ? `<a class="blog-ai-agent__claim-citation" href="${escapeHtml(safePostUrl(citation.citation.url))}" target="_blank" rel="noopener noreferrer" aria-label="查看原文引用 ${citation.index}">[${citation.index}]</a>`
          : '';
        return `<td>${escapeHtml(compactText(cell.text, 800))} ${citationLink}</td>`;
      }).join('');
      return `<tr><th scope="row">${escapeHtml(compactText(row && row.label, 80) || '原文')}</th>${cells}</tr>`;
    }).join('');
    return `<section class="blog-ai-agent__comparison" aria-label="多文章对比">
      <div class="blog-ai-agent__phase5-title">按维度对齐的原文证据</div>
      <div class="blog-ai-agent__comparison-scroll"><table><thead><tr><th scope="col">维度</th>${headings}</tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
  }

  function renderLearningPath(result) {
    const path = result && result.learningPath;
    const steps = path && Array.isArray(path.steps) ? path.steps : [];
    if (!path) return '';
    const relationLabels = {
      prerequisite: '前置',
      next: '下一步',
      start: '起点'
    };
    const items = steps.map(step => {
      const url = safePostUrl(step && step.url);
      const title = compactText(step && step.title, 200);
      if (!url || !title) return '';
      const relation = relationLabels[String(step.relation || '')] || '阅读';
      return `<li><span>${escapeHtml(relation)}</span><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></li>`;
    }).filter(Boolean).join('');
    return `<section class="blog-ai-agent__learning-path" aria-label="学习路径">
      <div class="blog-ai-agent__phase5-title">${escapeHtml(compactText(path.trackTitle, 120) || '站内学习路径')}</div>
      ${items ? `<ol>${items}</ol>` : '<p>该路径当前没有未完成的下一步。</p>'}
      <small>顺序来自作者维护的站内学习图谱，不由相关文章相似度推断。</small>
    </section>`;
  }

  function renderCodeExplanation(result) {
    const explanation = result && result.codeExplanation;
    const block = explanation && explanation.block;
    if (!block || typeof block !== 'object') return '';
    const code = String(block.code || '');
    const anchor = safeCodeAnchor(block.anchor);
    const articleUrl = safePostUrl(block.postUrl);
    const sourceUrl = articleUrl && anchor ? `${articleUrl}#${anchor}` : articleUrl;
    if (!code || !articleUrl || !anchor) return '';
    const language = compactText(block.language, 40) || 'text';
    const section = compactText(block.sectionTitle, 200);
    return `<section class="blog-ai-agent__code-explanation" aria-label="原文代码块">
      <div class="blog-ai-agent__phase5-title">原文代码块 · ${escapeHtml(language)}</div>
      <div class="blog-ai-agent__code-meta">${section ? escapeHtml(section) : '未命名小节'} · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">定位到文章代码块</a></div>
      <pre><code class="language-${escapeHtml(language)}">${escapeHtml(code)}</code></pre>
    </section>`;
  }

  function renderPhase5Artifacts(result) {
    return [
      renderComparison(result),
      renderLearningPath(result),
      renderCodeExplanation(result)
    ].filter(Boolean).join('');
  }

  function feedbackHtml(result, isFallback) {
    const feedback = !isFallback && validFeedbackReceipt(result.feedback);
    if (!feedback) return '';

    return `
      <div class="blog-ai-agent__feedback" data-feedback-receipt="${escapeHtml(feedback.receipt)}">
        <span class="blog-ai-agent__feedback-question">这个回答有帮助吗？</span>
        <div class="blog-ai-agent__feedback-actions">
          <button type="button" data-feedback-rating="helpful">有帮助</button>
          <button type="button" data-feedback-rating="not_helpful">需要改进</button>
        </div>
        <label class="blog-ai-agent__feedback-reason-label">改进原因
          <select class="blog-ai-agent__feedback-reason" aria-label="选择需要改进的原因">
            <option value="answer_incorrect">内容不准确</option>
            <option value="citation_mismatch">引用不匹配</option>
            <option value="should_have_refused">本应拒答</option>
            <option value="should_have_answer">本应回答</option>
            <option value="missing_content">缺少内容</option>
          </select>
        </label>
        <span class="blog-ai-agent__feedback-status" aria-live="polite"></span>
      </div>
    `;
  }

  function renderAssistantMessage(result, isFallback) {
    const citationsHtml = (result.citations || []).map(citation => {
      const url = safePostUrl(citation && citation.url);
      if (!url) return '';
      const section = citation.section
        ? `<small>${escapeHtml(citation.section)}</small>`
        : '';
      const citationSnippet = citation.snippet
        ? `<span>${escapeHtml(citation.snippet)}</span>`
        : '';
      return `<a class="blog-ai-agent__citation" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <strong>${escapeHtml(citation.title)}</strong>
        ${section}
        ${citationSnippet}
      </a>`;
    }).join('');

    const relatedHtml = (result.related || []).map(item => {
      const url = safePostUrl(item && item.url);
      if (!url) return '';
      return `<a class="blog-ai-agent__related-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`;
    }).join('');
    const phase5Html = !isFallback ? renderPhase5Artifacts(result) : '';

    return `
      <div class="blog-ai-agent__message blog-ai-agent__message--assistant">
        <div class="blog-ai-agent__message-label">向导${isFallback ? ' · 本地检索' : ''}</div>
        <div class="blog-ai-agent__message-body">${renderAnswerBody(result)}</div>
        ${phase5Html}
        ${citationsHtml ? `<div class="blog-ai-agent__citation-list">${citationsHtml}</div>` : ''}
        ${relatedHtml ? `<div class="blog-ai-agent__related">${relatedHtml}</div>` : ''}
        ${feedbackHtml(result, isFallback)}
      </div>
    `;
  }

  function renderUserMessage(content) {
    return `
      <div class="blog-ai-agent__message blog-ai-agent__message--user">
        <div class="blog-ai-agent__message-label">你</div>
        <div class="blog-ai-agent__message-body">${escapeHtml(content)}</div>
      </div>
    `;
  }

  function appendMessage(html) {
    state.elements.messages.insertAdjacentHTML('beforeend', html);
    const message = state.elements.messages.lastElementChild;
    state.elements.messages.scrollTop = state.elements.messages.scrollHeight;
    typesetMath(message);
    return message;
  }

  async function submitFeedback(container, rating) {
    if (!container || container.classList.contains('is-pending') ||
      container.classList.contains('is-submitted')) {
      return false;
    }
    const receipt = String(container.getAttribute('data-feedback-receipt') || '').trim();
    if (!validFeedbackReceipt({
      receipt,
      expiresAt: new Date(Date.now() + 1).toISOString()
    })) {
      return false;
    }
    if (rating !== 'helpful' && rating !== 'not_helpful') return false;

    const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');
    if (!apiBaseUrl) return false;
    const reasonElement = container.querySelector('.blog-ai-agent__feedback-reason');
    const reason = rating === 'not_helpful' && reasonElement
      ? String(reasonElement.value || '')
      : '';
    const status = container.querySelector('.blog-ai-agent__feedback-status');
    const buttons = Array.from(
      container.querySelectorAll('button[data-feedback-rating]')
    );
    container.classList.add('is-pending');
    buttons.forEach(button => {
      button.disabled = true;
    });
    if (status) status.textContent = '正在发送反馈…';

    try {
      const response = await fetch(`${apiBaseUrl}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'omit',
        keepalive: true,
        body: JSON.stringify({ receipt, rating, reason })
      });
      if (!response.ok) throw new Error(`Feedback API failed: ${response.status}`);

      container.classList.remove('is-pending');
      container.classList.add('is-submitted');
      if (status) {
        status.textContent = rating === 'helpful'
          ? '收到，感谢你的反馈。'
          : '收到，我们会据此改进。';
      }
      return true;
    } catch (error) {
      container.classList.remove('is-pending');
      buttons.forEach(button => {
        button.disabled = false;
      });
      if (status) status.textContent = '反馈暂时未送达，可以稍后重试。';
      return false;
    }
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    state.elements.submit.disabled = isBusy;
    state.elements.input.disabled = isBusy;
    state.elements.suggestionButtons.forEach(button => {
      button.disabled = isBusy;
    });
    state.elements.messages.setAttribute('aria-busy', String(isBusy));
    state.elements.submit.textContent = isBusy ? '让我翻翻...' : '发给向导';
  }

  function commitConversation(requestMessages, result, standaloneQuery) {
    const assistantMessage = normalizeHistoryMessage({
      role: 'assistant',
      content: result.answer,
      citations: result.citations,
      related: result.related,
      indexVersion: result.meta && result.meta.indexVersion,
      standaloneQuery: result.meta && result.meta.standaloneQuery ||
        standaloneQuery
    });
    state.messages = trimConversationMessages([
      ...requestMessages,
      assistantMessage
    ]);

    const articleReferences = collectArticleReferences(result.citations, result.related);
    state.lastArticleRefs = articleReferences;

    const serverStandaloneQuery = result.meta && result.meta.standaloneQuery;
    const nextStandaloneQuery = compactText(
      serverStandaloneQuery || standaloneQuery,
      MAX_MESSAGE_CHARACTERS
    );
    if (nextStandaloneQuery) {
      state.lastStandaloneQuery = nextStandaloneQuery;
    }

    saveConversation();
  }

  async function ask(question) {
    const trimmed = compactText(question, MAX_MESSAGE_CHARACTERS);
    if (!trimmed || state.busy) return;
    const requestEpoch = ++state.requestEpoch;
    setBusy(true);
    state.elements.input.value = '';

    try {
      await ensureMemoryReady();
      if (requestEpoch !== state.requestEpoch) return;

      const context = getCurrentContext();
      const mode = detectMode(trimmed);
      const fallbackPlan = rewriteFollowUpQuestion(trimmed, mode, context);
      const requestMessages = trimConversationMessages([
        ...state.messages,
        { role: 'user', content: trimmed }
      ]);
      const requestId = createRequestId();
      appendMessage(renderUserMessage(trimmed));

      let result = null;
      let usedFallback = false;

      try {
        result = await remoteAskWithMemoryRecovery(
          trimmed,
          mode,
          context,
          requestMessages,
          requestId
        );
      } catch (error) {
        if (requestEpoch !== state.requestEpoch) return;
        if (isValidMemoryToken(state.memory.token)) {
          setMemoryStatus('degraded', { reason: 'api_unavailable' });
        }
        result = fallbackPlan.clarification
          ? {
              answer: fallbackPlan.clarification,
              citations: [],
              related: []
            }
          : await localAsk(
              fallbackPlan.question,
              fallbackPlan.mode,
              fallbackPlan.context
            );
        usedFallback = true;
      }

      if (requestEpoch !== state.requestEpoch) return;
      appendMessage(renderAssistantMessage(result, usedFallback));
      commitConversation(
        requestMessages,
        result,
        fallbackPlan.clarification ? '' : fallbackPlan.question
      );
    } catch (error) {
      if (requestEpoch !== state.requestEpoch) return;
      appendMessage(`
        <div class="blog-ai-agent__message blog-ai-agent__message--assistant">
          <div class="blog-ai-agent__message-label">向导</div>
          <div class="blog-ai-agent__message-body">哎呀，向导刚刚脑袋打结了，暂时没法回答。你可以稍后再来找我，或者先用站内搜索顶一下。</div>
        </div>
      `);
    } finally {
      if (requestEpoch === state.requestEpoch) {
        setBusy(false);
        state.elements.input.focus();
      }
    }
  }

  function renderConversationHistory() {
    for (const message of state.messages) {
      if (message.role === 'user') {
        appendMessage(renderUserMessage(message.content));
        continue;
      }

      appendMessage(renderAssistantMessage({
        answer: message.content,
        citations: message.citations || [],
        related: message.related || []
      }, false));
    }
  }

  function abortActiveWork() {
    state.requestEpoch += 1;
    if (state.activeController) {
      state.activeController.abort();
      state.activeController = null;
    }
  }

  function resetLocalConversation() {
    state.sessionId = createSessionId();
    state.messages = [];
    state.lastArticleRefs = [];
    state.lastStandaloneQuery = '';
    state.elements.messages.innerHTML = GREETING_HTML;
    setBusy(false);
    saveConversation();
    state.elements.input.value = '';
    state.elements.input.focus();
  }

  async function resetConversation() {
    abortActiveWork();
    const canRotateManagedThread = (
      config.memoryV1Enabled !== false &&
      state.memory.status !== 'disabled' &&
      isValidMemoryToken(state.memory.token) &&
      isValidThreadId(state.memory.threadId) &&
      isValidMemoryVersion(state.memory.version)
    );
    if (!canRotateManagedThread) {
      resetLocalConversation();
      return true;
    }

    state.memoryActionBusy = true;
    updateMemoryUi();
    setBusy(true);
    try {
      let response;
      try {
        response = await memoryApiRequest('/api/memory/thread', 'POST', {
          memoryToken: state.memory.token,
          currentThreadId: state.memory.threadId,
          expectedMemoryVersion: state.memory.version,
          requestId: createRequestId()
        });
      } catch (error) {
        if (error && error.statusCode === 409) {
          await restoreMemorySession({ hydrate: false });
          response = await memoryApiRequest('/api/memory/thread', 'POST', {
            memoryToken: state.memory.token,
            currentThreadId: state.memory.threadId,
            expectedMemoryVersion: state.memory.version,
            requestId: createRequestId()
          });
        } else {
          throw error;
        }
      }
      applyActiveMemory(response.payload, {
        memoryToken: state.memory.token,
        hydrate: false,
        restored: true
      });
      resetLocalConversation();
      return true;
    } catch (error) {
      if ([400, 401, 410].includes(error && error.statusCode)) {
        clearMemoryCredential('idle', 'credential_rejected');
        resetLocalConversation();
        return true;
      }
      memoryUnavailable(error);
      return false;
    } finally {
      state.memoryActionBusy = false;
      setBusy(false);
      updateMemoryUi();
    }
  }

  async function clearMemory(options) {
    const settings = options || {};
    const confirmed = settings.skipConfirm === true || (
      typeof window.confirm === 'function' &&
      window.confirm('清除记忆会删除服务端最近对话，且无法恢复。确定继续吗？')
    );
    if (!confirmed) return false;

    abortActiveWork();
    state.memoryActionBusy = true;
    updateMemoryUi();
    setBusy(true);
    try {
      if (isValidMemoryToken(state.memory.token)) {
        await memoryApiRequest('/api/memory/session', 'DELETE', {
          memoryToken: state.memory.token,
          requestId: createRequestId()
        });
      }
      clearMemoryCredential('cleared', 'user_cleared');
      resetLocalConversation();
      return true;
    } catch (error) {
      if ([400, 401, 410].includes(error && error.statusCode)) {
        clearMemoryCredential('cleared', 'credential_rejected');
        resetLocalConversation();
        return true;
      }
      memoryUnavailable(error);
      return false;
    } finally {
      state.memoryActionBusy = false;
      setBusy(false);
      updateMemoryUi();
    }
  }

  function togglePanel(forceOpen) {
    const nextState = typeof forceOpen === 'boolean'
      ? forceOpen
      : !state.elements.panel.classList.contains('is-open');

    state.elements.panel.classList.toggle('is-open', nextState);
    state.elements.toggle.setAttribute('aria-expanded', String(nextState));

    if (nextState) {
      state.elements.input.focus();
    }
  }

  function createUi(root) {
    root.innerHTML = `
      <button class="blog-ai-agent__toggle" type="button" aria-expanded="false" aria-controls="blog-ai-agent-panel">
        向导
      </button>
      <section class="blog-ai-agent__panel" id="blog-ai-agent-panel" aria-label="博客向导">
        <header class="blog-ai-agent__header">
          <div>
            <h3>站内向导</h3>
            <p>向导会先翻翻站内资料帮你找答案，慢一点点，但会认真找哦。</p>
          </div>
          <div class="blog-ai-agent__header-actions">
            <button class="blog-ai-agent__new-conversation" type="button" aria-label="开始新对话并保留长期记忆" title="新建线程，保留长期记忆">新对话</button>
            <button class="blog-ai-agent__clear-memory" type="button" aria-label="清除全部匿名记忆" title="删除服务端记忆并撤销此浏览器令牌">清除记忆</button>
            <button class="blog-ai-agent__close" type="button" aria-label="关闭">×</button>
          </div>
        </header>
        <div class="blog-ai-agent__memory-bar">
          <span class="blog-ai-agent__memory-status" data-memory-state="${escapeHtml(state.memory.status)}" role="status" aria-live="polite">${escapeHtml(memoryStatusCopy())}</span>
        </div>
        <div class="blog-ai-agent__suggestions">
          <button type="button" data-question="总结这篇文章">总结本页</button>
          <button type="button" data-question="这篇文章适合什么基础的人看？">这篇适合谁</button>
          <button type="button" data-question="我下一篇应该看什么？">推荐下一篇</button>
        </div>
        <div class="blog-ai-agent__messages" role="log" aria-live="polite" aria-relevant="additions" aria-busy="false">${GREETING_HTML}</div>
        <form class="blog-ai-agent__form">
          <textarea class="blog-ai-agent__input" rows="3" maxlength="${MAX_MESSAGE_CHARACTERS}" placeholder="想问什么？交给向导吧。"></textarea>
          <button class="blog-ai-agent__submit" type="submit">发给向导</button>
        </form>
      </section>
    `;

    state.elements = {
      root,
      toggle: root.querySelector('.blog-ai-agent__toggle'),
      panel: root.querySelector('.blog-ai-agent__panel'),
      close: root.querySelector('.blog-ai-agent__close'),
      newConversation: root.querySelector('.blog-ai-agent__new-conversation'),
      clearMemory: root.querySelector('.blog-ai-agent__clear-memory'),
      memoryStatus: root.querySelector('.blog-ai-agent__memory-status'),
      messages: root.querySelector('.blog-ai-agent__messages'),
      form: root.querySelector('.blog-ai-agent__form'),
      input: root.querySelector('.blog-ai-agent__input'),
      submit: root.querySelector('.blog-ai-agent__submit'),
      suggestionButtons: Array.from(root.querySelectorAll('.blog-ai-agent__suggestions button'))
    };

    state.elements.toggle.addEventListener('click', () => togglePanel());
    state.elements.close.addEventListener('click', () => togglePanel(false));
    state.elements.newConversation.addEventListener('click', () => {
      resetConversation();
    });
    state.elements.clearMemory.addEventListener('click', () => {
      clearMemory();
    });
    state.elements.messages.addEventListener('click', event => {
      const button = event.target.closest('button[data-feedback-rating]');
      if (!button) return;
      const container = button.closest('.blog-ai-agent__feedback');
      submitFeedback(container, button.getAttribute('data-feedback-rating'));
    });

    state.elements.form.addEventListener('submit', event => {
      event.preventDefault();
      ask(state.elements.input.value);
    });

    state.elements.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      if (event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229) return;

      event.preventDefault();
      ask(state.elements.input.value);
    });

    state.elements.suggestionButtons.forEach(button => {
      button.addEventListener('click', () => {
        const question = button.getAttribute('data-question') || '';
        state.elements.input.value = question;
        ask(question);
      });
    });

    renderConversationHistory();
    updateMemoryUi();
  }

  function init() {
    const root = document.getElementById('blog-ai-agent-root');
    if (!root) return;
    restoreConversation();
    createUi(root);
    startMemoryBootstrap();
  }

  if (
    config.testMode === true &&
    typeof window.__BLOG_AI_AGENT_TEST_HOOK__ === 'function'
  ) {
    window.__BLOG_AI_AGENT_TEST_HOOK__({
      ask,
      bootstrapMemory,
      clearMemory,
      resetConversation,
      restoreConversation,
      restoreMemorySession,
      submitFeedback,
      setElements(elements) {
        state.elements = elements;
      },
      state
    });
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
