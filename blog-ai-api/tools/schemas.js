'use strict';

const TOOL_NAMES = Object.freeze([
  'search_blog',
  'get_article',
  'get_related_articles',
  'compare_articles',
  'recommend_learning_path',
  'explain_code_block'
]);

const MAX_TOP_K = 20;
const MAX_COMPARE_ARTICLES = 4;
const MAX_COMPARE_DIMENSIONS = 3;
const MAX_LEARNING_TOP_K = 8;
const MAX_COMPLETED_ARTICLES = 8;
const DEFAULT_SEARCH_TOP_K = 12;
const DEFAULT_ARTICLE_TOP_K = 20;
const DEFAULT_RELATED_TOP_K = 5;
const DEFAULT_COMPARE_TOP_K = 3;
const DEFAULT_LEARNING_TOP_K = 5;
const LEARNING_LEVELS = Object.freeze([
  'beginner',
  'intermediate',
  'advanced'
]);
const COMPARE_DIMENSIONS = Object.freeze([
  'core',
  'implementation',
  'workflow',
  'scenario',
  'strengths',
  'limitations'
]);

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
  },
  compare_articles: {
    type: 'object',
    additionalProperties: false,
    required: ['urls'],
    properties: {
      urls: {
        type: 'array',
        minItems: 2,
        maxItems: MAX_COMPARE_ARTICLES,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 2048,
          format: 'blog-url'
        }
      },
      dimensions: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_COMPARE_DIMENSIONS,
        items: {
          type: 'string',
          enum: COMPARE_DIMENSIONS.slice()
        }
      },
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_COMPARE_DIMENSIONS
      }
    }
  },
  recommend_learning_path: {
    type: 'object',
    additionalProperties: false,
    properties: {
      topic: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      },
      currentPostUrl: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
        format: 'blog-url'
      },
      level: {
        type: 'string',
        enum: LEARNING_LEVELS.slice()
      },
      goal: {
        type: 'string',
        minLength: 1,
        maxLength: 500
      },
      completedUrls: {
        type: 'array',
        maxItems: MAX_COMPLETED_ARTICLES,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: 2048,
          format: 'blog-url'
        }
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LEARNING_TOP_K
      }
    }
  },
  explain_code_block: {
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
      blockId: {
        type: 'string',
        minLength: 5,
        maxLength: 80,
        pattern: '^code_[a-f0-9]{24}$'
      },
      ordinal: {
        type: 'integer',
        minimum: 1,
        maximum: 999
      },
      section: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 500
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

function optionalEnum(args, key, toolName, values, defaultValue) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return defaultValue;
  const value = validateString(args[key], key, toolName, 100);
  if (!values.includes(value)) {
    throw new ToolValidationError(
      `${toolName}.${key} must be one of: ${values.join(', ')}`
    );
  }
  return value;
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

function resolveBoundedTopK(args, toolName, defaultValue, maximum) {
  if (!Object.prototype.hasOwnProperty.call(args, 'topK')) return defaultValue;
  const value = args.topK;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ToolValidationError(
      `${toolName}.topK must be an integer between 1 and ${maximum}`
    );
  }
  return value;
}

function optionalUrlArray(args, key, toolName, normalizePostUrl, maximum) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return [];
  const values = args[key];
  if (!Array.isArray(values) || values.length > maximum) {
    throw new ToolValidationError(
      `${toolName}.${key} must contain at most ${maximum} URLs`
    );
  }
  const urls = [];
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    const raw = validateString(value, `${key}[${index}]`, toolName, 2048);
    const url = normalizePostUrl(raw);
    if (!url) {
      throw new ToolValidationError(`${toolName}.${key}[${index}] must be a valid blog URL`);
    }
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
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

function validateCompareArticlesArgs(args, normalizePostUrl) {
  const toolName = 'compare_articles';
  assertPlainObject(args, toolName);
  assertKnownKeys(args, toolName, ['urls', 'dimensions', 'query', 'topK']);
  if (!Array.isArray(args.urls)) {
    throw new ToolValidationError(`${toolName}.urls must be an array`);
  }
  if (args.urls.length < 2 || args.urls.length > MAX_COMPARE_ARTICLES) {
    throw new ToolValidationError(
      `${toolName}.urls must contain between 2 and ${MAX_COMPARE_ARTICLES} URLs`
    );
  }
  const urls = optionalUrlArray(
    args,
    'urls',
    toolName,
    normalizePostUrl,
    MAX_COMPARE_ARTICLES
  );
  if (urls.length < 2) {
    throw new ToolValidationError(`${toolName}.urls must identify at least two distinct articles`);
  }

  let dimensions = ['core'];
  if (Object.prototype.hasOwnProperty.call(args, 'dimensions')) {
    if (!Array.isArray(args.dimensions) || !args.dimensions.length ||
      args.dimensions.length > MAX_COMPARE_DIMENSIONS) {
      throw new ToolValidationError(
        `${toolName}.dimensions must contain between 1 and ${MAX_COMPARE_DIMENSIONS} values`
      );
    }
    dimensions = [...new Set(args.dimensions.map((value, index) => {
      const dimension = validateString(
        value,
        `dimensions[${index}]`,
        toolName,
        40
      );
      if (!COMPARE_DIMENSIONS.includes(dimension)) {
        throw new ToolValidationError(`${toolName}.dimensions[${index}] is not supported`);
      }
      return dimension;
    }))];
  }

  return {
    urls,
    dimensions,
    query: optionalString(args, 'query', toolName, 500),
    topK: resolveBoundedTopK(
      args,
      toolName,
      DEFAULT_COMPARE_TOP_K,
      MAX_COMPARE_DIMENSIONS
    )
  };
}

function validateRecommendLearningPathArgs(args, normalizePostUrl) {
  const toolName = 'recommend_learning_path';
  assertPlainObject(args, toolName);
  assertKnownKeys(args, toolName, [
    'topic',
    'currentPostUrl',
    'level',
    'goal',
    'completedUrls',
    'topK'
  ]);
  const topic = optionalString(args, 'topic', toolName, 500);
  const goal = optionalString(args, 'goal', toolName, 500);
  const rawCurrentUrl = optionalString(args, 'currentPostUrl', toolName, 2048);
  const currentPostUrl = rawCurrentUrl ? normalizePostUrl(rawCurrentUrl) : '';
  if (rawCurrentUrl && !currentPostUrl) {
    throw new ToolValidationError(`${toolName}.currentPostUrl must be a valid blog URL`);
  }
  if (!topic && !goal && !currentPostUrl) {
    throw new ToolValidationError(
      `${toolName} requires at least one of topic, goal, or currentPostUrl`
    );
  }
  return {
    topic,
    goal,
    currentPostUrl,
    level: optionalEnum(
      args,
      'level',
      toolName,
      LEARNING_LEVELS,
      'beginner'
    ),
    completedUrls: optionalUrlArray(
      args,
      'completedUrls',
      toolName,
      normalizePostUrl,
      MAX_COMPLETED_ARTICLES
    ),
    topK: resolveBoundedTopK(
      args,
      toolName,
      DEFAULT_LEARNING_TOP_K,
      MAX_LEARNING_TOP_K
    )
  };
}

function validateExplainCodeBlockArgs(args, normalizePostUrl) {
  const toolName = 'explain_code_block';
  assertPlainObject(args, toolName);
  assertKnownKeys(args, toolName, ['url', 'blockId', 'ordinal', 'section', 'query']);
  const rawUrl = requireString(args, 'url', toolName, 2048);
  const url = normalizePostUrl(rawUrl);
  if (!url) throw new ToolValidationError(`${toolName}.url must be a valid blog URL`);
  const blockId = optionalString(args, 'blockId', toolName, 80);
  if (blockId && !/^code_[a-f0-9]{24}$/.test(blockId)) {
    throw new ToolValidationError(`${toolName}.blockId is invalid`);
  }
  let ordinal = 0;
  if (Object.prototype.hasOwnProperty.call(args, 'ordinal')) {
    ordinal = args.ordinal;
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 999) {
      throw new ToolValidationError(`${toolName}.ordinal must be an integer between 1 and 999`);
    }
  }
  const section = optionalString(args, 'section', toolName, 200);
  const query = optionalString(args, 'query', toolName, 500);
  if (!blockId && !ordinal && !section && !query) {
    throw new ToolValidationError(
      `${toolName} requires blockId, ordinal, section, or query`
    );
  }
  if (blockId && ordinal) {
    throw new ToolValidationError(`${toolName} cannot combine blockId and ordinal`);
  }
  return { url, blockId, ordinal, section, query };
}

module.exports = {
  COMPARE_DIMENSIONS,
  DEFAULT_COMPARE_TOP_K,
  DEFAULT_LEARNING_TOP_K,
  DEFAULT_ARTICLE_TOP_K,
  DEFAULT_RELATED_TOP_K,
  DEFAULT_SEARCH_TOP_K,
  LEARNING_LEVELS,
  MAX_COMPARE_ARTICLES,
  MAX_COMPARE_DIMENSIONS,
  MAX_COMPLETED_ARTICLES,
  MAX_LEARNING_TOP_K,
  MAX_TOP_K,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  ToolValidationError,
  validateCompareArticlesArgs,
  validateExplainCodeBlockArgs,
  validateGetArticleArgs,
  validateGetRelatedArticlesArgs,
  validateRecommendLearningPathArgs,
  validateSearchBlogArgs
};
