'use strict';

const TOOL_NAMES = Object.freeze([
  'search_blog',
  'get_article',
  'get_related_articles'
]);

const MAX_TOP_K = 20;
const DEFAULT_SEARCH_TOP_K = 12;
const DEFAULT_ARTICLE_TOP_K = 20;
const DEFAULT_RELATED_TOP_K = 5;

const TOOL_SCHEMAS = deepFreeze({
  search_blog: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      },
      tags: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 100
        }
      },
      categories: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 100
        }
      },
      currentPageOnly: {
        type: 'boolean'
      },
      pageUrl: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
        format: 'blog-url'
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TOP_K
      }
    }
  },
  get_article: {
    type: 'object',
    additionalProperties: false,
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
        format: 'blog-url'
      },
      section: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TOP_K
      }
    }
  },
  get_related_articles: {
    type: 'object',
    additionalProperties: false,
    oneOf: [
      {
        required: ['url'],
        not: {
          required: ['postId']
        }
      },
      {
        required: ['postId'],
        not: {
          required: ['url']
        }
      }
    ],
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
        format: 'blog-url'
      },
      postId: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      topic: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TOP_K
      }
    }
  }
});

class ToolValidationError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'ToolValidationError';
    this.code = 'INVALID_TOOL_ARGUMENTS';
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function assertPlainObject(args, toolName) {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.getPrototypeOf(args) !== Object.prototype
  ) {
    throw new ToolValidationError(`${toolName} arguments must be a plain object`);
  }
}

function assertKnownKeys(args, toolName, allowedKeys) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(args).filter(key => !allowed.has(key));
  if (unknown.length) {
    throw new ToolValidationError(
      `${toolName} received unknown argument: ${unknown[0]}`
    );
  }
}

function requireString(args, key, toolName, maxLength) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) {
    throw new ToolValidationError(`${toolName}.${key} is required`);
  }
  return validateString(args[key], key, toolName, maxLength);
}

function optionalString(args, key, toolName, maxLength) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return '';
  return validateString(args[key], key, toolName, maxLength);
}

function validateString(value, key, toolName, maxLength) {
  if (typeof value !== 'string') {
    throw new ToolValidationError(`${toolName}.${key} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new ToolValidationError(`${toolName}.${key} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new ToolValidationError(
      `${toolName}.${key} must not exceed ${maxLength} characters`
    );
  }
  return normalized;
}

function optionalStringArray(args, key, toolName) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return [];
  const value = args[key];

  if (!Array.isArray(value)) {
    throw new ToolValidationError(`${toolName}.${key} must be an array`);
  }
  if (value.length > 5) {
    throw new ToolValidationError(`${toolName}.${key} must not contain more than 5 items`);
  }

  return value.map((item, index) => (
    validateString(item, `${key}[${index}]`, toolName, 100)
  ));
}

function optionalBoolean(args, key, toolName, defaultValue) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return defaultValue;
  if (typeof args[key] !== 'boolean') {
    throw new ToolValidationError(`${toolName}.${key} must be a boolean`);
  }
  return args[key];
}

function resolveTopK(args, toolName, defaultValue) {
  if (!Object.prototype.hasOwnProperty.call(args, 'topK')) return defaultValue;
  const value = args.topK;

  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TOP_K) {
    throw new ToolValidationError(
      `${toolName}.topK must be an integer between 1 and ${MAX_TOP_K}`
    );
  }
  return value;
}

function validateSearchBlogArgs(args, normalizePostUrl) {
  const toolName = 'search_blog';
  assertPlainObject(args, toolName);
  assertKnownKeys(
    args,
    toolName,
    ['query', 'tags', 'categories', 'currentPageOnly', 'pageUrl', 'topK']
  );

  const query = requireString(args, 'query', toolName, 500);
  const tags = optionalStringArray(args, 'tags', toolName);
  const categories = optionalStringArray(args, 'categories', toolName);
  const currentPageOnly = optionalBoolean(
    args,
    'currentPageOnly',
    toolName,
    false
  );
  const rawPageUrl = optionalString(args, 'pageUrl', toolName, 2048);
  const pageUrl = rawPageUrl ? normalizePostUrl(rawPageUrl) : '';

  if (rawPageUrl && !pageUrl) {
    throw new ToolValidationError(`${toolName}.pageUrl must be a valid blog URL`);
  }
  if (currentPageOnly && !pageUrl) {
    throw new ToolValidationError(
      `${toolName}.pageUrl is required when currentPageOnly is true`
    );
  }

  return {
    query,
    tags,
    categories,
    currentPageOnly,
    pageUrl,
    topK: resolveTopK(args, toolName, DEFAULT_SEARCH_TOP_K)
  };
}

function validateGetArticleArgs(args, normalizePostUrl) {
  const toolName = 'get_article';
  assertPlainObject(args, toolName);
  assertKnownKeys(args, toolName, ['url', 'section', 'topK']);

  const rawUrl = requireString(args, 'url', toolName, 2048);
  const url = normalizePostUrl(rawUrl);
  if (!url) {
    throw new ToolValidationError(`${toolName}.url must be a valid blog URL`);
  }

  return {
    url,
    section: optionalString(args, 'section', toolName, 200),
    topK: resolveTopK(args, toolName, DEFAULT_ARTICLE_TOP_K)
  };
}

function validateGetRelatedArticlesArgs(args, normalizePostUrl) {
  const toolName = 'get_related_articles';
  assertPlainObject(args, toolName);
  assertKnownKeys(args, toolName, ['url', 'postId', 'topic', 'topK']);

  const hasUrl = Object.prototype.hasOwnProperty.call(args, 'url');
  const hasPostId = Object.prototype.hasOwnProperty.call(args, 'postId');
  if (hasUrl === hasPostId) {
    throw new ToolValidationError(
      `${toolName} requires exactly one of url or postId`
    );
  }

  let url = '';
  let postId = '';
  if (hasUrl) {
    const rawUrl = requireString(args, 'url', toolName, 2048);
    url = normalizePostUrl(rawUrl);
    if (!url) {
      throw new ToolValidationError(`${toolName}.url must be a valid blog URL`);
    }
  } else {
    postId = requireString(args, 'postId', toolName, 200);
  }

  return {
    url,
    postId,
    topic: optionalString(args, 'topic', toolName, 500),
    topK: resolveTopK(args, toolName, DEFAULT_RELATED_TOP_K)
  };
}

module.exports = {
  DEFAULT_ARTICLE_TOP_K,
  DEFAULT_RELATED_TOP_K,
  DEFAULT_SEARCH_TOP_K,
  MAX_TOP_K,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  ToolValidationError,
  validateGetArticleArgs,
  validateGetRelatedArticlesArgs,
  validateSearchBlogArgs
};
