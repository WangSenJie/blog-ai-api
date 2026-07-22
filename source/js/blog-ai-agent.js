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

  const state = {
    chunks: null,
    loadingCorpus: null,
    elements: null,
    mathJaxReady: null
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
    if (/推荐|下一篇|延伸/.test(question)) {
      return `让我看看哦...我帮你翻到几篇更贴近的文章啦。排在最前面的是《${top.postTitle}》，内容重点大致是：${lead}`;
    }

    if (isDefinitionQuestion(question)) {
      return `《${top.postTitle}》中介绍：${definitionSnippet(top, question)}`;
    }

    return `锵锵，向导在站内翻到了 ${relatedCount} 篇比较相关的内容。最贴近的是《${top.postTitle}》，先给你一个小结：${lead}`;
  }

  async function localAsk(question, mode, context, ranked) {
    if (!ranked) {
      await loadCorpus();
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

  async function remoteAsk(question, mode, context) {
    const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');
    if (!apiBaseUrl) throw new Error('Remote API is not configured');
    const configuredTimeout = Number(config.apiTimeoutMs);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(Math.max(Math.round(configuredTimeout), 1000), 60000)
      : 20000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${apiBaseUrl}/api/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question,
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
    }
  }

  function renderAssistantMessage(result, isFallback) {
    const citationsHtml = (result.citations || []).map(citation => {
      const url = safePostUrl(citation && citation.url);
      if (!url) return '';
      const section = citation.section
        ? `<small>${escapeHtml(citation.section)}</small>`
        : '';
      return `<a class="blog-ai-agent__citation" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <strong>${escapeHtml(citation.title)}</strong>
        ${section}
        <span>${escapeHtml(citation.snippet || '')}</span>
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

  function appendMessage(html) {
    state.elements.messages.insertAdjacentHTML('beforeend', html);
    const message = state.elements.messages.lastElementChild;
    state.elements.messages.scrollTop = state.elements.messages.scrollHeight;
    typesetMath(message);
    return message;
  }

  function setBusy(isBusy) {
    state.elements.submit.disabled = isBusy;
    state.elements.input.disabled = isBusy;
    state.elements.submit.textContent = isBusy ? '让我翻翻...' : '发给向导';
  }

  async function ask(question) {
    const trimmed = String(question || '').trim();
    if (!trimmed) return;

    const context = getCurrentContext();
    const mode = detectMode(trimmed);

    appendMessage(`
      <div class="blog-ai-agent__message blog-ai-agent__message--user">
        <div class="blog-ai-agent__message-label">你</div>
        <div class="blog-ai-agent__message-body">${escapeHtml(trimmed)}</div>
      </div>
    `);

    setBusy(true);
    state.elements.input.value = '';

    try {
      let result = null;
      let usedFallback = false;

      try {
        result = await remoteAsk(trimmed, mode, context);
      } catch (error) {
        result = await localAsk(trimmed, mode, context);
        usedFallback = true;
      }

      appendMessage(renderAssistantMessage(result, usedFallback));
    } catch (error) {
      appendMessage(`
        <div class="blog-ai-agent__message blog-ai-agent__message--assistant">
          <div class="blog-ai-agent__message-label">向导</div>
          <div class="blog-ai-agent__message-body">哎呀，向导刚刚脑袋打结了，暂时没法回答。你可以稍后再来找我，或者先用站内搜索顶一下。</div>
        </div>
      `);
    } finally {
      setBusy(false);
      state.elements.input.focus();
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
          <button class="blog-ai-agent__close" type="button" aria-label="关闭">×</button>
        </header>
        <div class="blog-ai-agent__suggestions">
          <button type="button" data-question="总结这篇文章">总结本页</button>
          <button type="button" data-question="这篇文章适合什么基础的人看？">这篇适合谁</button>
          <button type="button" data-question="我下一篇应该看什么？">推荐下一篇</button>
        </div>
        <div class="blog-ai-agent__messages">
          <div class="blog-ai-agent__message blog-ai-agent__message--assistant">
            <div class="blog-ai-agent__message-label">向导</div>
            <div class="blog-ai-agent__message-body">嘿嘿，我是你的站内向导。有什么问题？只要站内有的我都能回答哦。</div>
          </div>
        </div>
        <form class="blog-ai-agent__form">
          <textarea class="blog-ai-agent__input" rows="3" placeholder="想问什么？交给向导吧。"></textarea>
          <button class="blog-ai-agent__submit" type="submit">发给向导</button>
        </form>
      </section>
    `;

    state.elements = {
      root,
      toggle: root.querySelector('.blog-ai-agent__toggle'),
      panel: root.querySelector('.blog-ai-agent__panel'),
      close: root.querySelector('.blog-ai-agent__close'),
      messages: root.querySelector('.blog-ai-agent__messages'),
      form: root.querySelector('.blog-ai-agent__form'),
      input: root.querySelector('.blog-ai-agent__input'),
      submit: root.querySelector('.blog-ai-agent__submit'),
      suggestionButtons: Array.from(root.querySelectorAll('.blog-ai-agent__suggestions button'))
    };

    state.elements.toggle.addEventListener('click', () => togglePanel());
    state.elements.close.addEventListener('click', () => togglePanel(false));

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
  }

  function init() {
    const root = document.getElementById('blog-ai-agent-root');
    if (!root) return;
    createUi(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
