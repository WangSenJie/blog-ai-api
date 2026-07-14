'use strict';

(function() {
  const config = Object.assign(
    {
      apiBaseUrl: '',
      dataBasePath: '/ai-data'
    },
    window.__BLOG_AI_CONFIG__ || {}
  );

  const state = {
    posts: null,
    chunks: null,
    searchIndex: null,
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
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function snippet(value, maxLength) {
    const condensed = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (condensed.length <= maxLength) return condensed;
    return `${condensed.slice(0, maxLength).trim()}...`;
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

    return {
      title: pageTitle ? pageTitle.textContent.trim() : document.title,
      url: window.location.href,
      description: metaDescription ? metaDescription.getAttribute('content') : ''
    };
  }

  function tokenize(value) {
    const normalized = normalizeText(value);
    const terms = normalized.match(/[a-z0-9][a-z0-9_.+#-]*/g) || [];
    const hanSequences = normalized.match(/[\u4e00-\u9fff]+/g) || [];

    for (const sequence of hanSequences) {
      if (sequence.length === 1) {
        terms.push(sequence);
        continue;
      }

      for (let index = 0; index < sequence.length - 1; index += 1) {
        terms.push(sequence.slice(index, index + 2));
      }
    }

    return terms;
  }

  function countTerms(value) {
    const frequency = new Map();
    for (const term of tokenize(value)) {
      frequency.set(term, (frequency.get(term) || 0) + 1);
    }
    return frequency;
  }

  function buildSearchIndex(chunks) {
    const documents = [];
    const documentFrequency = new Map();
    let totalLength = 0;

    for (const [position, chunk] of (chunks || []).entries()) {
      const termFrequency = countTerms(chunk.content);
      const length = Math.max(
        Array.from(termFrequency.values()).reduce((total, count) => total + count, 0),
        1
      );
      totalLength += length;

      for (const term of termFrequency.keys()) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }

      documents.push({ chunk, position, termFrequency, length });
    }

    return {
      documents,
      documentFrequency,
      averageLength: documents.length ? totalLength / documents.length : 1
    };
  }

  function detectMode(question) {
    const text = String(question || '');
    if (/总结|概括|摘要/.test(text)) return 'page_summary';
    if (/这篇|本文|本页|当前页|这一页/.test(text)) return 'page';
    return 'site';
  }

  async function loadCorpus() {
    if (state.posts && state.chunks) {
      return { posts: state.posts, chunks: state.chunks };
    }

    if (state.loadingCorpus) {
      return state.loadingCorpus;
    }

    const basePath = String(config.dataBasePath || '/ai-data').replace(/\/$/, '');

    state.loadingCorpus = Promise.all([
      fetch(`${basePath}/posts.json`).then(response => {
        if (!response.ok) throw new Error('Failed to load posts.json');
        return response.json();
      }),
      fetch(`${basePath}/chunks.json`).then(response => {
        if (!response.ok) throw new Error('Failed to load chunks.json');
        return response.json();
      })
    ]).then(([posts, chunks]) => {
      state.posts = posts;
      state.chunks = chunks;
      state.searchIndex = buildSearchIndex(chunks);
      return { posts, chunks };
    });

    return state.loadingCorpus;
  }

  function scoreChunk(document, question, mode, context) {
    const { chunk, termFrequency, length } = document;
    const index = state.searchIndex;
    const title = normalizeText(chunk.postTitle);
    const metadata = normalizeText([
      (chunk.tags || []).join(' '),
      (chunk.categories || []).join(' '),
      chunk.sectionTitle
    ].join(' '));
    const content = normalizeText(chunk.content);
    const normalizedQuestion = normalizeText(question);
    const terms = [...new Set(tokenize(question))];
    let score = 0;

    if (normalizedQuestion && content.includes(normalizedQuestion)) {
      score += 8;
    }
    if (normalizedQuestion && title.includes(normalizedQuestion)) {
      score += 12;
    }

    for (const term of terms) {
      const frequency = termFrequency.get(term) || 0;
      if (frequency) {
        const documentsWithTerm = index.documentFrequency.get(term) || 0;
        const inverseDocumentFrequency = Math.log(1 + (index.documents.length - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5));
        const k1 = 1.2;
        const b = 0.75;
        const normalization = k1 * (1 - b + b * (length / index.averageLength));
        score += inverseDocumentFrequency * ((frequency * (k1 + 1)) / (frequency + normalization));
      }
      if (title.includes(term)) {
        score += 4;
      }
      if (metadata.includes(term)) {
        score += 2;
      }
    }

    if (context.url && chunk.postUrl === context.url) {
      score += mode === 'page_summary' ? 20 : 8;
    }

    return score;
  }

  function rankChunks(question, mode, context) {
    const searchIndex = state.searchIndex || buildSearchIndex(state.chunks);
    const ranked = [];

    for (const document of searchIndex.documents) {
      const { chunk } = document;
      const score = scoreChunk(document, question, mode, context);

      if (mode === 'page_summary' && context.url) {
        if (chunk.postUrl === context.url) {
          ranked.push({ chunk, score, position: document.position });
        }
        continue;
      }

      if (score > 0) {
        ranked.push({ chunk, score, position: document.position });
      }
    }

    if (mode === 'page_summary' && context.url) {
      ranked.sort((left, right) => left.position - right.position);
    } else {
      ranked.sort((left, right) => right.score - left.score);
    }
    return ranked;
  }

  function buildRetrievalSources(ranked, limit) {
    return (ranked || []).slice(0, limit).map(item => ({
      id: item.chunk.id,
      title: item.chunk.postTitle,
      url: item.chunk.postUrl,
      section: item.chunk.sectionTitle || '',
      content: item.chunk.content,
      score: Number(item.score.toFixed(3))
    }));
  }

  function uniqueCitations(ranked, limit) {
    const seen = new Set();
    const citations = [];

    for (const item of ranked) {
      const chunk = item.chunk;
      const key = `${chunk.postUrl}::${chunk.content.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        title: chunk.postTitle,
        url: chunk.postUrl,
        snippet: snippet(chunk.content, 140)
      });
      if (citations.length >= limit) break;
    }

    return citations;
  }

  function uniqueRelated(ranked, context, limit) {
    const seen = new Set();
    const related = [];

    for (const item of ranked) {
      const chunk = item.chunk;
      if (!chunk.postUrl || seen.has(chunk.postUrl) || chunk.postUrl === context.url) continue;
      seen.add(chunk.postUrl);
      related.push({
        title: chunk.postTitle,
        url: chunk.postUrl
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

  async function remoteAsk(question, mode, context, sources) {
    const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');
    if (!apiBaseUrl) return null;

    const response = await fetch(`${apiBaseUrl}/api/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        question,
        mode,
        page: context,
        retrieval: {
          sources
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Remote API failed: ${response.status}`);
    }

    return response.json();
  }

  function enrichRemoteResult(result, ranked, context) {
    const answer = result && typeof result.answer === 'string' ? result.answer : '';
    const safeRanked = ranked || [];
    const citations = Array.isArray(result && result.citations) && result.citations.length
      ? result.citations
      : uniqueCitations(safeRanked, 3);
    const related = Array.isArray(result && result.related) && result.related.length
      ? result.related
      : uniqueRelated(safeRanked, context, 3);

    return { answer, citations, related };
  }

  function renderAssistantMessage(result, isFallback) {
    const citationsHtml = (result.citations || []).map(citation => (
      `<a class="blog-ai-agent__citation" href="${citation.url}" target="_blank" rel="noopener noreferrer">
        <strong>${escapeHtml(citation.title)}</strong>
        <span>${escapeHtml(citation.snippet || '')}</span>
      </a>`
    )).join('');

    const relatedHtml = (result.related || []).map(item => (
      `<a class="blog-ai-agent__related-link" href="${item.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>`
    )).join('');

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
      let ranked = null;

      try {
        await loadCorpus();
        ranked = rankChunks(trimmed, mode, context);
      } catch (error) {
        // The remote API can still answer when the static corpus is unavailable.
      }

      try {
        result = await remoteAsk(trimmed, mode, context, buildRetrievalSources(ranked, mode === 'page_summary' ? 6 : 5));
        result = enrichRemoteResult(result, ranked, context);
      } catch (error) {
        result = await localAsk(trimmed, mode, context, ranked);
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
