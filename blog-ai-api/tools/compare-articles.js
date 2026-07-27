'use strict';

const {
  hybridRankChunks
} = require('../lib/hybrid-retrieve');
const {
  normalizePostUrl,
  normalizeText
} = require('../lib/retrieval-core');
const {
  TOOL_SCHEMAS,
  validateCompareArticlesArgs
} = require('./schemas');

const DIMENSIONS = Object.freeze({
  core: {
    label: '核心原文',
    terms: []
  },
  implementation: {
    label: '实现 / 方法',
    terms: ['实现', '方法', '算法', '代码', '公式']
  },
  workflow: {
    label: '流程 / 步骤',
    terms: ['流程', '步骤', '离线', '线上', '训练', '调用']
  },
  scenario: {
    label: '适用场景',
    terms: ['场景', '适合', '适用', '用于', '应用']
  },
  strengths: {
    label: '优点 / 特点',
    terms: ['优点', '优势', '特点', '好处']
  },
  limitations: {
    label: '局限 / 注意项',
    terms: ['缺点', '不足', '局限', '问题', '不适合']
  }
});

function clonePost(post) {
  if (!post) return null;
  return {
    id: post.id,
    title: post.title,
    url: normalizePostUrl(post.url),
    tags: Array.isArray(post.tags) ? post.tags.slice() : [],
    categories: Array.isArray(post.categories) ? post.categories.slice() : []
  };
}

function cloneChunk(chunk) {
  return Object.assign({}, chunk, {
    tags: Array.isArray(chunk && chunk.tags) ? chunk.tags.slice() : [],
    categories: Array.isArray(chunk && chunk.categories)
      ? chunk.categories.slice()
      : [],
    headingPath: Array.isArray(chunk && chunk.headingPath)
      ? chunk.headingPath.slice()
      : []
  });
}

function hasDimensionEvidence(chunk, dimension) {
  if (dimension === 'core') return true;
  const definition = DIMENSIONS[dimension];
  const text = normalizeText([
    chunk && chunk.sectionTitle,
    chunk && chunk.content
  ].join(' '));
  return Boolean(definition && definition.terms.some(term => (
    text.includes(normalizeText(term))
  )));
}

function selectDimensionEvidence(chunks, vectors, post, dimension, query) {
  const definition = DIMENSIONS[dimension];
  const dimensionQuery = [
    post.title,
    definition && definition.label,
    definition && definition.terms.join(' '),
    query
  ].filter(Boolean).join(' ');
  const retrieval = hybridRankChunks(chunks, vectors, dimensionQuery, 'site', null);
  const evidence = retrieval.ranked.find(item => (
    hasDimensionEvidence(item.chunk, dimension)
  )) || null;
  return { evidence, retrieval };
}

function createCompareArticlesTool(options) {
  const posts = options && options.posts;
  const chunks = options && options.chunks;
  const vectors = options && options.vectors;
  if (!Array.isArray(posts) || !Array.isArray(chunks)) {
    throw new TypeError('createCompareArticlesTool requires posts and chunks arrays');
  }

  return Object.freeze({
    name: 'compare_articles',
    schema: TOOL_SCHEMAS.compare_articles,

    execute(rawArgs) {
      const args = validateCompareArticlesArgs(rawArgs, normalizePostUrl);
      const articles = args.urls.map(url => posts.find(post => (
        normalizePostUrl(post && post.url) === url
      )) || null);
      if (articles.some(article => !article)) {
        return {
          strategy: 'hybrid_rrf_rerank',
          status: 'article_not_found',
          total: 0,
          articles: [],
          dimensions: [],
          comparison: null,
          items: []
        };
      }

      const requestedDimensions = args.dimensions.slice(0, args.topK);
      const dimensionIds = requestedDimensions.includes('core')
        ? requestedDimensions
        : ['core'].concat(requestedDimensions).slice(0, 3);
      const dimensions = dimensionIds.map(id => ({
        id,
        label: DIMENSIONS[id].label
      }));
      const articleSummaries = articles.map(clonePost);
      const rows = [];
      const items = [];
      let allCovered = true;
      let coreCovered = true;
      let hybridUsed = false;

      for (const dimension of dimensions) {
        const cells = [];
        for (const post of articles) {
          const articleChunks = chunks.filter(chunk => (
            normalizePostUrl(chunk && chunk.postUrl) === normalizePostUrl(post.url)
          ));
          const selected = selectDimensionEvidence(
            articleChunks,
            vectors,
            post,
            dimension.id,
            args.query
          );
          if (selected.retrieval.strategy === 'hybrid_rrf_rerank') hybridUsed = true;
          if (!selected.evidence) {
            allCovered = false;
            if (dimension.id === 'core') coreCovered = false;
            cells.push({
              articleUrl: normalizePostUrl(post.url),
              available: false
            });
            continue;
          }
          const item = selected.evidence;
          const chunk = cloneChunk(item.chunk);
          cells.push({
            articleUrl: normalizePostUrl(post.url),
            available: true,
            chunkId: chunk.id
          });
          items.push({
            chunk,
            rank: items.length + 1,
            score: item.score,
            bm25Rank: item.bm25Rank,
            vectorRank: item.vectorRank,
            vectorScore: item.vectorScore,
            rrfScore: item.rrfScore,
            rerankScore: item.rerankScore,
            query: post.title,
            dimension: dimension.id
          });
        }
        rows.push({
          id: dimension.id,
          label: dimension.label,
          cells
        });
      }

      return {
        strategy: hybridUsed ? 'hybrid_rrf_rerank' : 'bm25',
        status: allCovered
          ? 'complete'
          : coreCovered
            ? 'partial'
            : 'evidence_incomplete',
        total: items.length,
        articles: articleSummaries,
        dimensions,
        comparison: {
          articles: articleSummaries,
          rows
        },
        items
      };
    }
  });
}

module.exports = {
  DIMENSIONS,
  createCompareArticlesTool,
  hasDimensionEvidence,
  selectDimensionEvidence
};
