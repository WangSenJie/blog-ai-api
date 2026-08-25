'use strict';

const {
  hybridRankChunksAsync
} = require('../lib/hybrid-retrieve');
const {
  normalizePostUrl,
  normalizeText,
  tokenize
} = require('../lib/retrieval-core');
const {
  TOOL_SCHEMAS,
  validateExplainCodeBlockArgs
} = require('./schemas');

const MAX_RETURN_CODE_CHARS = 12000;

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

function publicBlock(block) {
  return {
    id: block.id,
    anchor: block.anchor,
    postTitle: block.postTitle,
    postUrl: normalizePostUrl(block.postUrl),
    sectionTitle: block.sectionTitle || '',
    headingPath: Array.isArray(block.headingPath) ? block.headingPath.slice() : [],
    ordinal: block.ordinal,
    language: block.language,
    code: block.code,
    sourceLineStart: block.sourceLineStart,
    sourceLineEnd: block.sourceLineEnd,
    contentHash: block.contentHash
  };
}

function candidateSummary(block) {
  return {
    id: block.id,
    ordinal: block.ordinal,
    language: block.language,
    sectionTitle: block.sectionTitle || ''
  };
}

function scoreBlock(block, query) {
  const normalizedQuery = normalizeText(query);
  const text = normalizeText([
    block.sectionTitle,
    (block.headingPath || []).join(' '),
    block.language,
    block.code
  ].join(' '));
  if (!normalizedQuery || !text) return 0;
  const terms = [...new Set(tokenize(query))].filter(term => term.length >= 2);
  const coverage = terms.length
    ? terms.filter(term => text.includes(normalizeText(term))).length / terms.length
    : 0;
  return (text.includes(normalizedQuery) ? 100 : 0) + coverage;
}

function selectBlock(blocks, args) {
  if (args.blockId) {
    const block = blocks.find(item => item.id === args.blockId) || null;
    return block
      ? { status: 'found', block }
      : { status: 'not_found', block: null };
  }
  if (args.ordinal) {
    const block = blocks.find(item => Number(item.ordinal) === args.ordinal) || null;
    return block
      ? { status: 'found', block }
      : { status: 'not_found', block: null };
  }

  let candidates = blocks.slice();
  if (args.section) {
    const section = normalizeText(args.section);
    candidates = candidates.filter(block => (
      normalizeText(block.sectionTitle).includes(section) ||
      normalizeText((block.headingPath || []).join(' ')).includes(section)
    ));
  }
  if (args.query) {
    candidates = candidates
      .map(block => ({ block, score: scoreBlock(block, args.query) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || (
        Number(left.block.ordinal) - Number(right.block.ordinal)
      ));
    if (!candidates.length) return { status: 'not_found', block: null };
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      return {
        status: 'ambiguous',
        block: null,
        candidates: candidates.slice(0, 5).map(item => candidateSummary(item.block))
      };
    }
    return { status: 'found', block: candidates[0].block };
  }
  if (candidates.length === 1) return { status: 'found', block: candidates[0] };
  return {
    status: candidates.length ? 'ambiguous' : 'not_found',
    block: null,
    candidates: candidates.slice(0, 5).map(candidateSummary)
  };
}

async function selectContext(block, chunks, vectors, query, retrievalOptions) {
  const chunksById = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
  const scoped = (block.contextChunkIds || [])
    .map(id => chunksById.get(id))
    .filter(Boolean);
  const isSubstantiveProse = chunk => (
    chunk &&
    chunk.chunkType !== 'code' &&
    /[\u3400-\u9fff]/u.test(String(chunk.content || '')) &&
    normalizeText(chunk.content).length >= 6
  );
  const scopedProse = scoped.filter(isSubstantiveProse);
  const articleProse = (chunks || []).filter(chunk => (
    normalizePostUrl(chunk && chunk.postUrl) === normalizePostUrl(block.postUrl) &&
    isSubstantiveProse(chunk)
  ));
  const sameArticle = scopedProse.length
    ? scopedProse
    : articleProse.length
      ? articleProse
      : scoped;
  if (!sameArticle.length) return null;
  const contextQuery = [
    query,
    block.sectionTitle,
    (block.headingPath || []).join(' '),
    String(block.code || '').slice(0, 1200)
  ]
    .filter(Boolean)
    .join(' ');
  const retrieval = await hybridRankChunksAsync(
    sameArticle,
    vectors,
    contextQuery,
    'site',
    null,
    retrievalOptions
  );
  return retrieval.ranked[0] || null;
}

function createExplainCodeBlockTool(options) {
  const codeBlocks = options && options.codeBlocks;
  const chunks = options && options.chunks;
  const vectors = options && options.vectors;
  const manifest = options && options.manifest;
  const provider = options && options.embeddingProvider;
  if (!Array.isArray(codeBlocks) || !Array.isArray(chunks)) {
    throw new TypeError('createExplainCodeBlockTool requires codeBlocks and chunks arrays');
  }

  return Object.freeze({
    name: 'explain_code_block',
    schema: TOOL_SCHEMAS.explain_code_block,

    async execute(rawArgs, executionOptions) {
      const args = validateExplainCodeBlockArgs(rawArgs, normalizePostUrl);
      const articleBlocks = codeBlocks.filter(block => (
        normalizePostUrl(block && block.postUrl) === args.url
      ));
      const selected = selectBlock(articleBlocks, args);
      if (selected.status !== 'found') {
        return {
          strategy: 'source_code_block',
          status: selected.status,
          total: 0,
          candidates: selected.candidates || [],
          codeExplanation: null,
          items: []
        };
      }
      if (selected.block.code.length > MAX_RETURN_CODE_CHARS) {
        return {
          strategy: 'source_code_block',
          status: 'code_too_large',
          total: 0,
          candidates: [candidateSummary(selected.block)],
          codeExplanation: null,
          items: []
        };
      }
      const context = await selectContext(selected.block, chunks, vectors, args.query, {
        manifest,
        provider,
        signal: executionOptions && executionOptions.signal
      });
      if (!context || !context.chunk) {
        return {
          strategy: 'source_code_block',
          status: 'context_missing',
          total: 0,
          candidates: [candidateSummary(selected.block)],
          codeExplanation: null,
          items: []
        };
      }
      return {
        strategy: 'source_code_block',
        status: 'found',
        total: 1,
        codeExplanation: {
          block: publicBlock(selected.block),
          contextChunkId: context.chunk.id
        },
        items: [{
          chunk: cloneChunk(context.chunk),
          rank: 1,
          score: context.score,
          bm25Rank: context.bm25Rank,
          vectorRank: context.vectorRank,
          vectorScore: context.vectorScore,
          rrfScore: context.rrfScore,
          rerankScore: context.rerankScore,
          query: args.query || selected.block.sectionTitle || selected.block.postTitle
        }]
      };
    }
  });
}

module.exports = {
  MAX_RETURN_CODE_CHARS,
  createExplainCodeBlockTool,
  publicBlock,
  scoreBlock,
  selectBlock,
  selectContext
};
