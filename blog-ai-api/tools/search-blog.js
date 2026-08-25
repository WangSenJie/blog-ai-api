'use strict';

const {
  normalizePostUrl,
  normalizeText
} = require('../lib/retrieval-core');
const { hybridRankChunksAsync } = require('../lib/hybrid-retrieve');
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
  const vectors = options && options.vectors;
  const manifest = options && options.manifest;
  const provider = options && options.embeddingProvider;
  if (!Array.isArray(chunks)) {
    throw new TypeError('createSearchBlogTool requires a chunks array');
  }

  return Object.freeze({
    name: 'search_blog',
    schema: TOOL_SCHEMAS.search_blog,

    async execute(rawArgs, executionOptions) {
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
      const retrieval = await hybridRankChunksAsync(
        candidates,
        vectors,
        args.query,
        'site',
        page,
        Object.assign({
          manifest,
          provider,
          signal: executionOptions && executionOptions.signal
        }, args.currentPageOnly ? { maxChunksPerPost: Math.max(8, args.topK) } : {})
      );
      const results = retrieval.ranked.slice(0, args.topK).map((item, index) => ({
        chunk: cloneChunk(item.chunk),
        score: item.score,
        rank: index + 1,
        bm25Rank: item.bm25Rank,
        vectorRank: item.vectorRank,
        vectorScore: item.vectorScore,
        rrfScore: item.rrfScore,
        rerankScore: item.rerankScore
      }));

      return {
        strategy: retrieval.strategy,
        query: args.query,
        total: retrieval.ranked.length,
        retrieval: retrieval.stats,
        results
      };
    }
  });
}

module.exports = {
  createSearchBlogTool
};
