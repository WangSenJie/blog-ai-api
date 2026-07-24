'use strict';

const { createGetArticleTool } = require('./get-article');
const { createGetRelatedArticlesTool } = require('./get-related-articles');
const { createSearchBlogTool } = require('./search-blog');
const {
  TOOL_NAMES,
  TOOL_SCHEMAS
} = require('./schemas');

function createAgentTools(corpus) {
  const posts = corpus && corpus.posts;
  const chunks = corpus && corpus.chunks;
  const vectors = corpus && corpus.vectors;
  if (!Array.isArray(posts) || !Array.isArray(chunks)) {
    throw new TypeError('createAgentTools requires posts and chunks arrays');
  }

  const tools = Object.freeze({
    search_blog: createSearchBlogTool({ chunks, vectors }),
    get_article: createGetArticleTool({ posts, chunks }),
    get_related_articles: createGetRelatedArticlesTool({ posts, chunks, vectors })
  });

  return Object.freeze({
    names: TOOL_NAMES,
    toolNames: TOOL_NAMES,
    schemas: TOOL_SCHEMAS,
    tools,

    list() {
      return TOOL_NAMES.slice();
    },

    execute(name, args) {
      if (
        typeof name !== 'string' ||
        !Object.prototype.hasOwnProperty.call(tools, name)
      ) {
        const error = new Error(`Unknown agent tool: ${String(name)}`);
        error.code = 'UNKNOWN_AGENT_TOOL';
        throw error;
      }
      return tools[name].execute(args);
    }
  });
}

module.exports = {
  TOOL_NAMES,
  TOOL_SCHEMAS,
  createAgentTools
};
