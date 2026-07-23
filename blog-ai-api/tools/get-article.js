'use strict';

const {
  normalizePostUrl,
  normalizeText
} = require('../lib/retrieval-core');
const {
  TOOL_SCHEMAS,
  validateGetArticleArgs
} = require('./schemas');

function clonePost(post) {
  if (!post) return null;
  const copy = Object.assign({}, post);
  if (Array.isArray(post.tags)) copy.tags = post.tags.slice();
  if (Array.isArray(post.categories)) copy.categories = post.categories.slice();
  return copy;
}

function cloneChunk(chunk) {
  const copy = Object.assign({}, chunk);
  if (Array.isArray(chunk.tags)) copy.tags = chunk.tags.slice();
  if (Array.isArray(chunk.categories)) copy.categories = chunk.categories.slice();
  return copy;
}

function createGetArticleTool(options) {
  const posts = options && options.posts;
  const chunks = options && options.chunks;
  if (!Array.isArray(posts) || !Array.isArray(chunks)) {
    throw new TypeError('createGetArticleTool requires posts and chunks arrays');
  }

  return Object.freeze({
    name: 'get_article',
    schema: TOOL_SCHEMAS.get_article,

    execute(rawArgs) {
      const args = validateGetArticleArgs(rawArgs, normalizePostUrl);
      const post = posts.find(item => normalizePostUrl(item && item.url) === args.url);
      if (!post) {
        return {
          strategy: 'bm25',
          selection: 'source_order',
          article: null,
          total: 0,
          results: []
        };
      }

      const normalizedSection = normalizeText(args.section);
      const matchingChunks = chunks.filter(chunk => (
        normalizePostUrl(chunk && chunk.postUrl) === args.url &&
        (
          !normalizedSection ||
          normalizeText(chunk.sectionTitle).includes(normalizedSection)
        )
      ));
      const results = matchingChunks
        .slice(0, args.topK)
        .map((chunk, index) => ({
          chunk: cloneChunk(chunk),
          rank: index + 1
        }));

      return {
        strategy: 'bm25',
        selection: 'source_order',
        article: clonePost(post),
        total: matchingChunks.length,
        results
      };
    }
  });
}

module.exports = {
  createGetArticleTool
};
