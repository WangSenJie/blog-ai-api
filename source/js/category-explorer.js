'use strict';

(function() {
  const page = document.querySelector('.category-all-page');
  if (!page) return;

  const container = page.querySelector('.category-all');
  const title = page.querySelector('.category-all-title');
  if (!container) return;

  const fallbackMarkup = container.innerHTML;
  const state = {
    nodesByKey: new Map(),
    flatNodes: [],
    topLevelNodes: [],
    selectedKey: '',
    openKeys: new Set()
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sortByName(left, right) {
    return left.name.localeCompare(right.name, 'zh-CN');
  }

  function sortByDate(left, right) {
    return String(right.date || '').localeCompare(String(left.date || '')) ||
      String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
  }

  function createNode(name, path) {
    return {
      name,
      path,
      key: path.map(encodeURIComponent).join('/'),
      children: [],
      childMap: new Map(),
      articles: [],
      articleIds: new Set(),
      total: 0
    };
  }

  function buildTree(posts) {
    const roots = [];
    const rootMap = new Map();

    for (const post of posts || []) {
      const categories = Array.isArray(post.categories)
        ? post.categories.filter(Boolean)
        : [];
      if (!categories.length) continue;

      let currentNodes = roots;
      let currentMap = rootMap;
      let node = null;
      const path = [];

      for (const name of categories) {
        path.push(name);
        if (!currentMap.has(name)) {
          const child = createNode(name, path.slice());
          currentMap.set(name, child);
          currentNodes.push(child);
          state.nodesByKey.set(child.key, child);
          state.flatNodes.push(child);
        }

        node = currentMap.get(name);
        currentNodes = node.children;
        currentMap = node.childMap;
      }

      if (node && !node.articleIds.has(post.id)) {
        node.articleIds.add(post.id);
        node.articles.push({
          id: post.id,
          title: post.title,
          url: post.url,
          date: post.date
        });
      }
    }

    function finalize(nodes) {
      for (const node of nodes) {
        node.children.sort(sortByName);
        node.articles.sort(sortByDate);
        node.total = node.articles.length + finalize(node.children);
      }
      return nodes.reduce((total, node) => total + node.total, 0);
    }

    roots.sort(sortByName);
    finalize(roots);
    state.flatNodes.sort(sortByName);
    return roots;
  }

  function renderPicker() {
    return state.topLevelNodes.map(node => `
      <button class="category-explorer__picker${node.key === state.selectedKey ? ' is-active' : ''}"
              type="button" data-category-key="${escapeHtml(node.key)}">
        <span>${escapeHtml(node.name)}</span>
        <em>${node.total}</em>
      </button>
    `).join('');
  }

  function renderNode(node, expanded) {
    const hasChildren = node.children.length > 0;
    const hasArticles = node.articles.length > 0;
    const canExpand = hasChildren || hasArticles;
    const isOpen = canExpand && (expanded || state.openKeys.has(node.key));
    const categoryUrl = `/categories/${node.path
      .map(name => encodeURIComponent(name.trim().replace(/\s+/g, '-')))
      .join('/')}/`;
    const children = node.children.map(child => renderNode(child, false)).join('');
    const articles = node.articles.map(article => `
      <li class="category-explorer__article">
        <a href="${escapeHtml(article.url)}">${escapeHtml(article.title)}</a>
      </li>
    `).join('');

    return `
      <li class="category-explorer__branch${isOpen ? ' is-open' : ''}" data-branch-key="${escapeHtml(node.key)}">
        <div class="category-explorer__branch-head">
          ${canExpand ? `
            <button class="category-explorer__branch-toggle" type="button" aria-expanded="${isOpen}" aria-label="展开 ${escapeHtml(node.name)}">
              <i></i>
            </button>
          ` : '<span class="category-explorer__branch-dot"></span>'}
          <a class="category-explorer__branch-link" href="${escapeHtml(categoryUrl)}">${escapeHtml(node.name)}</a>
          <span class="category-explorer__branch-count">${node.total}</span>
        </div>
        ${canExpand ? `
          <div class="category-explorer__branch-body">
            <div>
              ${hasChildren ? `<ul class="category-explorer__tree">${children}</ul>` : ''}
              ${hasArticles ? `<ul class="category-explorer__articles">${articles}</ul>` : ''}
            </div>
          </div>
        ` : ''}
      </li>
    `;
  }

  function renderDetail() {
    const selected = state.nodesByKey.get(state.selectedKey);
    if (!selected) return;

    const detail = container.querySelector('.category-explorer__detail');
    detail.innerHTML = `
      <div class="category-explorer__detail-heading">
        <span>知识路径</span>
        <h2>${escapeHtml(selected.name)}</h2>
        <p>展开分类分支，直达对应的文章。</p>
      </div>
      <ul class="category-explorer__tree category-explorer__tree--root">
        ${renderNode(selected, true)}
      </ul>
    `;
  }

  function selectCategory(key) {
    if (!state.nodesByKey.has(key) || key === state.selectedKey) return;
    state.selectedKey = key;
    state.openKeys = new Set([key]);
    container.querySelectorAll('.category-explorer__picker').forEach(button => {
      button.classList.toggle('is-active', button.dataset.categoryKey === key);
    });
    renderDetail();
  }

  function render(roots) {
    const initialNode = roots[0] || state.flatNodes[0];
    if (!initialNode) {
      container.innerHTML = '<p class="category-explorer__empty">暂时还没有分类内容。</p>';
      return;
    }

    state.selectedKey = initialNode.key;
    state.openKeys = new Set([initialNode.key]);
    state.topLevelNodes = roots;
    if (title) title.textContent = `共 ${state.topLevelNodes.length} 个大类，点击左侧展开知识路径`;

    container.innerHTML = `
      <section class="category-explorer" aria-label="分类导航">
        <aside class="category-explorer__catalog" aria-label="全部分类">
          <div class="category-explorer__catalog-label">TOP-LEVEL CATEGORIES</div>
          <div class="category-explorer__picker-list">
            ${renderPicker()}
          </div>
        </aside>
        <div class="category-explorer__detail" aria-live="polite"></div>
      </section>
    `;
    renderDetail();

    container.addEventListener('click', event => {
      const picker = event.target.closest('[data-category-key]');
      if (picker) {
        selectCategory(picker.dataset.categoryKey);
        return;
      }

      const toggle = event.target.closest('.category-explorer__branch-toggle');
      if (!toggle) return;
      const branch = toggle.closest('[data-branch-key]');
      if (!branch) return;

      const key = branch.dataset.branchKey;
      const isOpen = state.openKeys.has(key);
      if (isOpen) {
        state.openKeys.delete(key);
      } else {
        state.openKeys.add(key);
      }
      branch.classList.toggle('is-open', !isOpen);
      toggle.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  fetch('/ai-data/posts.json', { cache: 'no-cache' })
    .then(response => {
      if (!response.ok) throw new Error('Unable to load category data');
      return response.json();
    })
    .then(posts => render(buildTree(posts)))
    .catch(() => {
      container.innerHTML = fallbackMarkup;
    });
})();
