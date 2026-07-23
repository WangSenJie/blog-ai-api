'use strict';

const {
  normalizePostUrl,
  normalizeText,
  rankChunks
} = require('../lib/retrieval-core');
const {
  TOOL_SCHEMAS,
  validateSearchBlogArgs
} = require('./schemas');

function cloneChunk(chunk) {
  const copy = Object.assign({}, chunk);
  if (Array.isArray(chunk.tags)) copy.tags = chunk.tags.slice();
  if (Array.isArray(chunk.categories)) copy.categories = chunk.categories.slice();
  return copy;
}

function matchesMetadataFilter(values, requestedValues) {
  if (!requestedValues.length) return true;
  const available = new Set((values || []).map(normalizeText).filter(Boolean));
  return requestedValues.every(value => available.has(normalizeText(value)));
}

function createSearchBlogTool(options) {
  const chunks = options && options.chunks;
  if (!Array.isArray(chunks)) {
    throw new TypeError('createSearchBlogTool requires a chunks array');
  }

  return Object.freeze({
    name: 'search_blog',
    schema: TOOL_SCHEMAS.search_blog,

    execute(rawArgs) {
      const args = validateSearchBlogArgs(rawArgs, normalizePostUrl);
      const candidates = chunks.filter(chunk => {
        const postUrl = normalizePostUrl(chunk && chunk.postUrl);
        if (args.currentPageOnly && postUrl !== args.pageUrl) return false;
        if (!matchesMetadataFilter(chunk && chunk.tags, args.tags)) return false;
        if (!matchesMetadataFilter(chunk && chunk.categories, args.categories)) {
          return false;
        }
        return true;
      });
      const page = args.pageUrl ? { url: args.pageUrl } : null;
      const ranked = rankChunks(candidates, args.query, 'site', page);
      const results = ranked.slice(0, args.topK).map((item, index) => ({
        chunk: cloneChunk(item.chunk),
        score: item.score,
        rank: index + 1
      }));

      return {
        strategy: 'bm25',
        query: args.query,
        total: ranked.length,
        results
      };
    }
  });
}

module.exports = {
  createSearchBlogTool
};
