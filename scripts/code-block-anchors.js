'use strict';

// Hexo loads files in /scripts automatically.  The anchor IDs are generated
// from the same signed code-block corpus used by the API, so a code response
// can link to an exact block without trusting a client-supplied fragment.
const fs = require('fs');
const path = require('path');
const { normalizePostUrl } = require('../blog-ai-api/lib/retrieval-core');
const { formatDatePrefix } = require('./slug-utils');

const codeBlocksPath = path.join(__dirname, '..', 'data', 'code-blocks.json');
let blocksByUrl = null;

function getBlocksByUrl() {
  if (blocksByUrl) return blocksByUrl;
  const blocks = fs.existsSync(codeBlocksPath)
    ? JSON.parse(fs.readFileSync(codeBlocksPath, 'utf8'))
    : [];
  blocksByUrl = new Map();
  for (const block of blocks) {
    const url = normalizePostUrl(block && block.postUrl);
    if (!url) continue;
    if (!blocksByUrl.has(url)) blocksByUrl.set(url, []);
    blocksByUrl.get(url).push(block);
  }
  return blocksByUrl;
}

function postUrl(data) {
  const rawPermalink = String(data && data.permalink || '')
    .replace(/\/index\.html?$/i, '/');
  const permalink = normalizePostUrl(rawPermalink);
  if (permalink) return permalink;
  const datePrefix = formatDatePrefix(data && data.date);
  const slug = String(data && data.slug || '').trim();
  if (datePrefix && slug) {
    return normalizePostUrl(
      `https://wangsenjie.github.io/${datePrefix}/${slug}/`
    );
  }
  const pathName = String(data && data.path || '')
    .replace(/^\/+/, '')
    .replace(/(?:^|\/)index\.html?$/i, '');
  return pathName
    ? normalizePostUrl(`https://wangsenjie.github.io/${pathName}`)
    : '';
}

function addCodeBlockAnchors(content, blocks) {
  let index = 0;
  const insertAnchor = match => {
    const block = blocks[index];
    index += 1;
    if (!block || !/^blog-ai-code-[a-f0-9]{24}$/.test(String(block.anchor || ''))) {
      return match;
    }
    return `<span id="${block.anchor}" class="blog-ai-code-anchor" aria-hidden="true"></span>${match}`;
  };
  const source = String(content || '');
  // Hexo's configured highlighter wraps one fenced block in one
  // <figure class="highlight …"> (and creates two nested <pre>s for line
  // numbers and source). Prefer that outer container so the ordinal remains
  // identical to the parsed Markdown fence ordinal.
  const figurePattern = /<figure\b[^>]*\bclass=(["'])[^"']*\bhighlight\b[^"']*\1[^>]*>/gi;
  if (figurePattern.test(source)) {
    return source.replace(
      /<figure\b[^>]*\bclass=(["'])[^"']*\bhighlight\b[^"']*\1[^>]*>/gi,
      insertAnchor
    );
  }
  // Keep a small compatibility fallback for renderers configured without the
  // Hexo highlight wrapper, where every fenced block produces one <pre>.
  return source.replace(/<pre(?:\s[^>]*)?>/gi, insertAnchor);
}

if (typeof hexo !== 'undefined' && hexo.extend && hexo.extend.filter) {
  hexo.extend.filter.register('after_post_render', data => {
    const blocks = getBlocksByUrl().get(postUrl(data)) || [];
    if (!blocks.length || !data || typeof data.content !== 'string') return data;
    data.content = addCodeBlockAnchors(data.content, blocks);
    return data;
  });
}

module.exports = {
  addCodeBlockAnchors,
  postUrl
};
