'use strict';

(function() {
  const config = Object.assign(
    {
      apiBaseUrl: '',
      dataBasePath: '/ai-data',
      apiTimeoutMs: 20000
    },
    window.__BLOG_AI_CONFIG__ || {}
  );
  const retrievalCore = window.BlogAIRetrieval || null;
  const CONVERSATION_STORAGE_KEY = 'blog-ai-agent-conversation-v1';
  const CONVERSATION_SCHEMA_VERSION = 1;
  const CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;
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
    activeController: null
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
    const pronoun = /它|这个|那个|上述|前面(?:的)?/.test(question);
    if (!continuation && !pronoun) {
      return { question, mode, context };
    }

    const anchor = references[0] || null;
    if (
      (pronoun && !anchor) ||
      (!anchor && !state.lastStandaloneQuery)
    ) {
      return {
        clarification: '我还不确定你指的是哪个概念或哪篇文章。可以补充一下名称吗？',
        question,
        mode,
        context
      };
    }

    const anchorTitle = anchor ? `《${anchor.title}》` : state.lastStandaloneQuery;
    const rewritten = pronoun
      ? question.replace(/它|这个|那个|上述|前面(?:的)?/g, anchorTitle)
      : `${state.lastStandaloneQuery || anchorTitle}：${question}`;

    return {
      question: rewritten,
      mode: anchor ? 'page' : mode,
      context: anchor
        ? {
            title: anchor.title,
            url: anchor.url,
            description: ''
          }
        : context
    };
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

  async function localAsk(question, mode, context, ranked) {
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

  async function remoteAsk(question, mode, context, messages) {
    const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');
    if (!apiBaseUrl) throw new Error('Remote API is not configured');
    const configuredTimeout = Number(config.apiTimeoutMs);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(Math.max(Math.round(configuredTimeout), 1000), 60000)
      : 20000;
    const controller = new AbortController();
    state.activeController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
          sessionId: state.sessionId,
          messages,
          mode,
          page: context
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Remote API failed: ${response.status}`);
      }

      const result = await response.json();
      if (!result || typeof result.answer !== 'string' || !result.answer.trim()) {
        throw new Error('Remote API returned an invalid response');
      }

      return {
        answer: result.answer,
        citations: Array.isArray(result.citations) ? result.citations : [],
        related: Array.isArray(result.related) ? result.related : [],
        meta: result.meta || null
      };
    } finally {
      window.clearTimeout(timeoutId);
      if (state.activeController === controller) {
        state.activeController = null;
      }
    }
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

    return `
      <div class="blog-ai-agent__message blog-ai-agent__message--assistant">
        <div class="blog-ai-agent__message-label">向导${isFallback ? ' · 本地检索' : ''}</div>
        <div class="blog-ai-agent__message-body">${escapeHtml(result.answer || '')}</div>
        ${citationsHtml ? `<div class="blog-ai-agent__citation-list">${citationsHtml}</div>` : ''}
        ${relatedHtml ? `<div class="blog-ai-agent__related">${relatedHtml}</div>` : ''}
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

    const context = getCurrentContext();
    const mode = detectMode(trimmed);
    const fallbackPlan = rewriteFollowUpQuestion(trimmed, mode, context);
    const requestMessages = trimConversationMessages([
      ...state.messages,
      { role: 'user', content: trimmed }
    ]);
    const requestEpoch = ++state.requestEpoch;

    appendMessage(renderUserMessage(trimmed));

    setBusy(true);
    state.elements.input.value = '';

    try {
      let result = null;
      let usedFallback = false;

      try {
        result = await remoteAsk(trimmed, mode, context, requestMessages);
      } catch (error) {
        if (requestEpoch !== state.requestEpoch) return;
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

  function resetConversation() {
    state.requestEpoch += 1;
    if (state.activeController) {
      state.activeController.abort();
      state.activeController = null;
    }

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
            <button class="blog-ai-agent__new-conversation" type="button" aria-label="开始新对话" title="清空当前会话">新对话</button>
            <button class="blog-ai-agent__close" type="button" aria-label="关闭">×</button>
          </div>
        </header>
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
      messages: root.querySelector('.blog-ai-agent__messages'),
      form: root.querySelector('.blog-ai-agent__form'),
      input: root.querySelector('.blog-ai-agent__input'),
      submit: root.querySelector('.blog-ai-agent__submit'),
      suggestionButtons: Array.from(root.querySelectorAll('.blog-ai-agent__suggestions button'))
    };

    state.elements.toggle.addEventListener('click', () => togglePanel());
    state.elements.close.addEventListener('click', () => togglePanel(false));
    state.elements.newConversation.addEventListener('click', resetConversation);

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
  }

  function init() {
    const root = document.getElementById('blog-ai-agent-root');
    if (!root) return;
    restoreConversation();
    createUi(root);
  }

  if (
    config.testMode === true &&
    typeof window.__BLOG_AI_AGENT_TEST_HOOK__ === 'function'
  ) {
    window.__BLOG_AI_AGENT_TEST_HOOK__({
      ask,
      resetConversation,
      restoreConversation,
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
