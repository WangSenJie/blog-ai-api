'use strict';

const {
  normalizePostUrl
} = require('../lib/retrieval-core');
const { hybridRankChunks } = require('../lib/hybrid-retrieve');
const {
  TOOL_SCHEMAS,
  validateGetRelatedArticlesArgs
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

function createGetRelatedArticlesTool(options) {
  const posts = options && options.posts;
  const chunks = options && options.chunks;
  const vectors = options && options.vectors;
  if (!Array.isArray(posts) || !Array.isArray(chunks)) {
    throw new TypeError(
      'createGetRelatedArticlesTool requires posts and chunks arrays'
    );
  }

  return Object.freeze({
    name: 'get_related_articles',
    schema: TOOL_SCHEMAS.get_related_articles,

    execute(rawArgs) {
      const args = validateGetRelatedArticlesArgs(rawArgs, normalizePostUrl);
      const sourcePost = args.url
        ? posts.find(post => normalizePostUrl(post && post.url) === args.url)
        : posts.find(post => String(post && post.id || '') === args.postId);

      if (!sourcePost) {
        return {
          strategy: 'bm25',
          sourceArticle: null,
          query: args.topic,
          total: 0,
          results: []
        };
      }

      const sourceUrl = normalizePostUrl(sourcePost.url);
      const query = [
        args.topic,
        sourcePost.title,
        (sourcePost.tags || []).join(' '),
        (sourcePost.categories || []).join(' ')
      ].filter(Boolean).join(' ');
      const retrieval = hybridRankChunks(chunks, vectors, query, 'site', null);
      const seenUrls = new Set();
      const related = [];

      for (const item of retrieval.ranked) {
        const postUrl = normalizePostUrl(item.chunk && item.chunk.postUrl);
        if (!postUrl || postUrl === sourceUrl || seenUrls.has(postUrl)) continue;

        seenUrls.add(postUrl);
        related.push({
          chunk: cloneChunk(item.chunk),
          score: item.score,
          rank: related.length + 1,
          bm25Rank: item.bm25Rank,
          vectorRank: item.vectorRank,
          vectorScore: item.vectorScore,
          rrfScore: item.rrfScore,
          rerankScore: item.rerankScore
        });
      }

      return {
        strategy: retrieval.strategy,
        sourceArticle: clonePost(sourcePost),
        query,
        total: related.length,
        retrieval: retrieval.stats,
        results: related.slice(0, args.topK)
      };
    }
  });
}

module.exports = {
  createGetRelatedArticlesTool
};
