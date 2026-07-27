'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TOOL_NAMES,
  TOOL_SCHEMAS,
  createAgentTools
} = require('../tools');

function makeCorpus() {
  const posts = [
    {
      id: 'post-a',
      title: 'Alpha Foundations',
      url: '/alpha/',
      tags: ['alpha'],
      categories: ['Guides']
    },
    {
      id: 'post-b',
      title: 'Beta Retrieval',
      url: '/beta/',
      tags: ['retrieval', 'shared'],
      categories: ['AI']
    },
    {
      id: 'post-c',
      title: 'Gamma Retrieval',
      url: '/gamma/',
      tags: ['retrieval'],
      categories: ['AI']
    }
  ];
  const chunks = [
    {
      id: 'post-a#2',
      postId: 'post-a',
      postTitle: 'Alpha Foundations',
      postUrl: '/alpha/',
      tags: ['alpha'],
      categories: ['Guides'],
      sectionTitle: 'Second Section',
      content: 'Alpha source second section.'
    },
    {
      id: 'post-b#0',
      postId: 'post-b',
      postTitle: 'Beta Retrieval',
      postUrl: '/beta/',
      tags: ['retrieval', 'shared'],
      categories: ['AI'],
      sectionTitle: 'Overview',
      content: 'Sentinel alpha retrieval evidence from beta.'
    },
    {
      id: 'post-a#0',
      postId: 'post-a',
      postTitle: 'Alpha Foundations',
      postUrl: '/alpha/',
      tags: ['alpha'],
      categories: ['Guides'],
      sectionTitle: 'First Section',
      content: 'Alpha source first section.'
    },
    {
      id: 'post-b#1',
      postId: 'post-b',
      postTitle: 'Beta Retrieval',
      postUrl: '/beta/',
      tags: ['retrieval', 'shared'],
      categories: ['AI'],
      sectionTitle: 'Details',
      content: 'Sentinel alpha retrieval has additional beta evidence.'
    },
    {
      id: 'post-c#0',
      postId: 'post-c',
      postTitle: 'Gamma Retrieval',
      postUrl: '/gamma/',
      tags: ['retrieval'],
      categories: ['AI'],
      sectionTitle: 'Overview',
      content: 'Sentinel alpha vector retrieval evidence from gamma.'
    }
  ];

  return { posts, chunks };
}

function makePhase5Corpus() {
  const posts = [
    {
      id: 'post-foundation',
      title: '检索基础',
      url: '/retrieval-foundations/',
      tags: ['检索'],
      categories: ['AI']
    },
    {
      id: 'post-bm25',
      title: 'BM25 检索',
      url: '/bm25-retrieval/',
      tags: ['检索', 'RAG'],
      categories: ['AI']
    },
    {
      id: 'post-hybrid',
      title: '混合检索',
      url: '/hybrid-retrieval/',
      tags: ['检索', 'RAG'],
      categories: ['AI']
    }
  ];
  const chunks = [
    {
      id: 'post-foundation#0',
      postId: 'post-foundation',
      postTitle: '检索基础',
      postUrl: '/retrieval-foundations/',
      tags: ['检索'],
      categories: ['AI'],
      sectionTitle: '基础概念',
      headingPath: ['基础概念'],
      content: '检索基础介绍文档、查询与候选集之间的关系。',
      contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    {
      id: 'post-bm25#0',
      postId: 'post-bm25',
      postTitle: 'BM25 检索',
      postUrl: '/bm25-retrieval/',
      tags: ['检索', 'RAG'],
      categories: ['AI'],
      sectionTitle: '实现方法',
      headingPath: ['实现方法'],
      content: 'BM25 的实现方法根据词频、逆文档频率和长度归一化计算相关性。',
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    },
    {
      id: 'post-bm25#1',
      postId: 'post-bm25',
      postTitle: 'BM25 检索',
      postUrl: '/bm25-retrieval/',
      tags: ['检索', 'RAG'],
      categories: ['AI'],
      sectionTitle: '代码示例',
      headingPath: ['代码示例'],
      content: '代码示例展示如何将查询词传入 BM25 检索器并返回候选文档。',
      contentHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    },
    {
      id: 'post-hybrid#0',
      postId: 'post-hybrid',
      postTitle: '混合检索',
      postUrl: '/hybrid-retrieval/',
      tags: ['检索', 'RAG'],
      categories: ['AI'],
      sectionTitle: '实现方法',
      headingPath: ['实现方法'],
      content: '混合检索的实现方法结合关键词检索和向量检索，再进行融合排序。',
      contentHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    }
  ];
  const nodes = [
    {
      id: 'retrieval-foundation',
      postId: 'post-foundation',
      title: '检索基础',
      url: '/retrieval-foundations/',
      order: 1,
      level: 'beginner',
      aliases: ['检索基础'],
      trackId: 'retrieval'
    },
    {
      id: 'bm25',
      postId: 'post-bm25',
      title: 'BM25 检索',
      url: '/bm25-retrieval/',
      order: 2,
      level: 'beginner',
      aliases: ['BM25'],
      trackId: 'retrieval'
    },
    {
      id: 'hybrid',
      postId: 'post-hybrid',
      title: '混合检索',
      url: '/hybrid-retrieval/',
      order: 3,
      level: 'intermediate',
      aliases: ['混合检索', 'RAG'],
      trackId: 'retrieval'
    }
  ];
  const codeBlocks = [
    {
      id: 'code_aaaaaaaaaaaaaaaaaaaaaaaa',
      anchor: 'blog-ai-code-aaaaaaaaaaaaaaaaaaaaaaaa',
      postId: 'post-bm25',
      postTitle: 'BM25 检索',
      postUrl: '/bm25-retrieval/',
      sectionTitle: '代码示例',
      headingPath: ['代码示例'],
      ordinal: 1,
      language: 'javascript',
      code: 'const results = bm25.search(query);\n',
      sourceLineStart: 4,
      sourceLineEnd: 6,
      contextChunkIds: ['post-bm25#1'],
      contentHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    }
  ];

  return {
    posts,
    chunks,
    codeBlocks,
    learningGraph: {
      schemaVersion: 1,
      version: 'test-author-curated-v1',
      policy: 'explicit_author_curated_only',
      nodes,
      tracks: [{
        id: 'retrieval',
        title: '检索学习路径',
        aliases: ['检索', 'RAG'],
        description: '作者维护的检索阅读顺序。',
        nodes
      }],
      edges: [
        {
          id: 'retrieval:next:retrieval-foundation:bm25',
          trackId: 'retrieval',
          from: 'retrieval-foundation',
          to: 'bm25',
          relation: 'next',
          reason: '作者维护的阅读顺序'
        },
        {
          id: 'retrieval:next:bm25:hybrid',
          trackId: 'retrieval',
          from: 'bm25',
          to: 'hybrid',
          relation: 'next',
          reason: '作者维护的阅读顺序'
        }
      ]
    }
  };
}

test('registry exposes only the allow-listed read-only tools', () => {
  const registry = createAgentTools(makeCorpus());

  assert.deepEqual(registry.names, [
    'search_blog',
    'get_article',
    'get_related_articles',
    'compare_articles',
    'recommend_learning_path',
    'explain_code_block'
  ]);
  assert.deepEqual(registry.toolNames, TOOL_NAMES);
  assert.deepEqual(registry.list(), TOOL_NAMES);
  assert.deepEqual(Object.keys(registry.tools), TOOL_NAMES);
  assert.deepEqual(Object.keys(registry.schemas), TOOL_NAMES);

  for (const name of TOOL_NAMES) {
    assert.equal(registry.tools[name].name, name);
    assert.equal(typeof registry.tools[name].execute, 'function');
    assert.equal(registry.tools[name].schema, TOOL_SCHEMAS[name]);
    assert.equal(registry.tools[name].schema.additionalProperties, false);
  }

  assert.throws(
    () => registry.execute('delete_article', {}),
    error => error.code === 'UNKNOWN_AGENT_TOOL'
  );
  assert.throws(
    () => registry.execute('constructor', {}),
    error => error.code === 'UNKNOWN_AGENT_TOOL'
  );
});

test('compare_articles returns a source-backed dimension matrix for known articles', () => {
  const registry = createAgentTools(makePhase5Corpus());
  const result = registry.execute('compare_articles', {
    urls: ['/bm25-retrieval/', '/hybrid-retrieval/'],
    dimensions: ['implementation'],
    query: '实现方法',
    topK: 2
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.total, 4);
  assert.deepEqual(result.articles.map(article => article.url), [
    'https://wangsenjie.github.io/bm25-retrieval/',
    'https://wangsenjie.github.io/hybrid-retrieval/'
  ]);
  assert.deepEqual(result.dimensions.map(dimension => dimension.id), [
    'core',
    'implementation'
  ]);
  assert.equal(result.comparison.rows.length, 2);
  assert.equal(
    result.comparison.rows.every(row => row.cells.every(cell => cell.available)),
    true
  );
  assert.equal(
    result.items.every(item => (
      item.chunk.postUrl === '/bm25-retrieval/' ||
      item.chunk.postUrl === '/hybrid-retrieval/'
    )),
    true
  );
  assert.equal(
    result.items.some(item => item.dimension === 'implementation'),
    true
  );

  const partial = registry.execute('compare_articles', {
    urls: ['/bm25-retrieval/', '/hybrid-retrieval/'],
    dimensions: ['scenario']
  });
  assert.equal(partial.status, 'partial');
  assert.equal(
    partial.comparison.rows.find(row => row.id === 'scenario').cells
      .every(cell => cell.available === false),
    true
  );
  assert.equal(partial.items.every(item => item.dimension === 'core'), true);

  assert.throws(
    () => registry.execute('compare_articles', {
      urls: ['/bm25-retrieval/', 'https://example.com/external/']
    }),
    /valid blog URL/
  );
  assert.throws(
    () => registry.execute('compare_articles', {
      urls: ['/bm25-retrieval/', '/bm25-retrieval/']
    }),
    /at least two distinct articles/
  );
});

test('recommend_learning_path follows only the supplied author-curated graph', () => {
  const registry = createAgentTools(makePhase5Corpus());
  const path = registry.execute('recommend_learning_path', {
    topic: 'RAG',
    level: 'beginner',
    topK: 3
  });

  assert.equal(path.strategy, 'author_curated_learning_graph');
  assert.equal(path.status, 'found');
  assert.equal(path.learningPath.trackId, 'retrieval');
  assert.deepEqual(path.items.map(item => item.url), [
    'https://wangsenjie.github.io/retrieval-foundations/',
    'https://wangsenjie.github.io/bm25-retrieval/',
    'https://wangsenjie.github.io/hybrid-retrieval/'
  ]);
  assert.deepEqual(path.items.map(item => item.order), [1, 2, 3]);
  assert.equal(path.items.every(item => item.trackId === 'retrieval'), true);

  const next = registry.execute('recommend_learning_path', {
    currentPostUrl: '/bm25-retrieval/'
  });
  assert.equal(next.learningPath.kind, 'next');
  assert.deepEqual(next.items.map(item => item.url), [
    'https://wangsenjie.github.io/hybrid-retrieval/'
  ]);
  assert.equal(next.items[0].relation, 'next');

  const missingTrack = registry.execute('recommend_learning_path', {
    topic: '图神经网络'
  });
  assert.equal(missingTrack.status, 'not_configured');
  assert.equal(missingTrack.learningPath, null);

  const invalidCompleted = registry.execute('recommend_learning_path', {
    topic: 'RAG',
    completedUrls: ['/not-in-corpus/']
  });
  assert.equal(invalidCompleted.status, 'invalid_completed_article');
});

test('explain_code_block returns only indexed source code and its article context', () => {
  const corpus = makePhase5Corpus();
  const registry = createAgentTools(corpus);
  const result = registry.execute('explain_code_block', {
    url: '/bm25-retrieval/',
    ordinal: 1,
    query: 'BM25 查询'
  });

  assert.equal(result.strategy, 'source_code_block');
  assert.equal(result.status, 'found');
  assert.equal(result.total, 1);
  assert.equal(
    result.codeExplanation.block.id,
    'code_aaaaaaaaaaaaaaaaaaaaaaaa'
  );
  assert.equal(
    result.codeExplanation.block.code,
    'const results = bm25.search(query);\n'
  );
  assert.equal(result.codeExplanation.contextChunkId, 'post-bm25#1');
  assert.equal(result.items[0].chunk.id, 'post-bm25#1');

  result.codeExplanation.block.code = 'mutated result';
  assert.equal(
    corpus.codeBlocks[0].code,
    'const results = bm25.search(query);\n'
  );

  const foreignBlock = registry.execute('explain_code_block', {
    url: '/retrieval-foundations/',
    blockId: 'code_aaaaaaaaaaaaaaaaaaaaaaaa'
  });
  assert.equal(foreignBlock.status, 'not_found');
  assert.equal(foreignBlock.codeExplanation, null);

  assert.throws(
    () => registry.execute('explain_code_block', {
      url: 'https://example.com/external/',
      ordinal: 1
    }),
    /valid blog URL/
  );
  assert.throws(
    () => registry.execute('explain_code_block', {
      url: '/bm25-retrieval/'
    }),
    /requires blockId, ordinal, section, or query/
  );
});

test('search_blog runs BM25, returns complete chunks, and applies metadata filters', () => {
  const corpus = makeCorpus();
  const originalCorpus = JSON.parse(JSON.stringify(corpus));
  const registry = createAgentTools(corpus);
  const result = registry.execute('search_blog', {
    query: 'sentinel retrieval',
    tags: ['shared'],
    categories: ['AI'],
    topK: 2
  });

  assert.equal(result.strategy, 'bm25');
  assert.equal(result.query, 'sentinel retrieval');
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.results.map(item => item.chunk.id),
    ['post-b#0', 'post-b#1']
  );
  assert.equal(result.results[0].rank, 1);
  assert.ok(result.results[0].score > 0);
  assert.equal(
    result.results[0].chunk.content,
    'Sentinel alpha retrieval evidence from beta.'
  );
  assert.deepEqual(result.results[0].chunk.tags, ['retrieval', 'shared']);
  assert.deepEqual(corpus, originalCorpus);

  result.results[0].chunk.tags.push('mutated-result');
  assert.deepEqual(corpus.chunks[1].tags, ['retrieval', 'shared']);
});

test('search_blog currentPageOnly requires and enforces a safe page URL', () => {
  const registry = createAgentTools(makeCorpus());

  assert.throws(
    () => registry.execute('search_blog', {
      query: 'sentinel',
      currentPageOnly: true
    }),
    /pageUrl is required/
  );

  const result = registry.execute('search_blog', {
    query: 'sentinel',
    currentPageOnly: true,
    pageUrl: '/gamma/',
    topK: 5
  });

  assert.equal(result.strategy, 'bm25');
  assert.deepEqual(
    result.results.map(item => item.chunk.id),
    ['post-c#0']
  );
});

test('get_article preserves corpus source order and supports section and topK', () => {
  const corpus = makeCorpus();
  const registry = createAgentTools(corpus);
  const article = registry.execute('get_article', {
    url: '/alpha/',
    topK: 20
  });

  assert.equal(article.strategy, 'bm25');
  assert.equal(article.selection, 'source_order');
  assert.equal(article.article.id, 'post-a');
  assert.equal(article.total, 2);
  assert.deepEqual(
    article.results.map(item => item.chunk.id),
    ['post-a#2', 'post-a#0']
  );

  const section = registry.execute('get_article', {
    url: 'https://wangsenjie.github.io/alpha/',
    section: 'first',
    topK: 1
  });

  assert.equal(section.total, 1);
  assert.deepEqual(
    section.results.map(item => item.chunk.id),
    ['post-a#0']
  );

  section.article.title = 'Changed result';
  section.results[0].chunk.categories.push('Changed result');
  assert.equal(corpus.posts[0].title, 'Alpha Foundations');
  assert.deepEqual(corpus.chunks[2].categories, ['Guides']);
});

test('get_related_articles accepts URL or postId, excludes self, and deduplicates URLs', () => {
  const registry = createAgentTools(makeCorpus());
  const byUrl = registry.execute('get_related_articles', {
    url: '/alpha/',
    topic: 'sentinel retrieval',
    topK: 5
  });
  const byPostId = registry.execute('get_related_articles', {
    postId: 'post-a',
    topic: 'sentinel retrieval',
    topK: 1
  });
  const relatedUrls = byUrl.results.map(item => item.chunk.postUrl);

  assert.equal(byUrl.strategy, 'bm25');
  assert.equal(byUrl.sourceArticle.id, 'post-a');
  assert.equal(byUrl.total, 2);
  assert.equal(byUrl.results.length, 2);
  assert.equal(new Set(relatedUrls).size, relatedUrls.length);
  assert.equal(relatedUrls.includes('/alpha/'), false);
  assert.deepEqual(new Set(relatedUrls), new Set(['/beta/', '/gamma/']));
  assert.equal(byUrl.results.every(item => item.chunk.content), true);

  assert.equal(byPostId.strategy, 'bm25');
  assert.equal(byPostId.sourceArticle.id, 'post-a');
  assert.equal(byPostId.results.length, 1);
});

test('tools reject unknown parameters, invalid topK values, and off-site URLs', () => {
  const registry = createAgentTools(makeCorpus());

  const unknownArgumentCases = [
    ['search_blog', { query: 'alpha', clientCandidates: [] }],
    ['get_article', { url: '/alpha/', unsafe: true }],
    ['get_related_articles', { postId: 'post-a', delete: true }],
    ['compare_articles', { urls: ['/alpha/', '/beta/'], unsafe: true }],
    ['recommend_learning_path', { topic: 'alpha', unsafe: true }],
    ['explain_code_block', { url: '/alpha/', ordinal: 1, unsafe: true }]
  ];
  for (const [name, args] of unknownArgumentCases) {
    assert.throws(
      () => registry.execute(name, args),
      /unknown argument/
    );
  }

  for (const invalidTopK of [0, 21, 1.5, '2']) {
    assert.throws(
      () => registry.execute('search_blog', {
        query: 'alpha',
        topK: invalidTopK
      }),
      /topK must be an integer between 1 and 20/
    );
    assert.throws(
      () => registry.execute('get_article', {
        url: '/alpha/',
        topK: invalidTopK
      }),
      /topK must be an integer between 1 and 20/
    );
    assert.throws(
      () => registry.execute('get_related_articles', {
        postId: 'post-a',
        topK: invalidTopK
      }),
      /topK must be an integer between 1 and 20/
    );
  }

  assert.throws(
    () => registry.execute('compare_articles', {
      urls: ['/alpha/', '/beta/'],
      topK: 4
    }),
    /topK must be an integer between 1 and 3/
  );
  assert.throws(
    () => registry.execute('recommend_learning_path', {
      topic: 'alpha',
      topK: 9
    }),
    /topK must be an integer between 1 and 8/
  );

  assert.throws(
    () => registry.execute('search_blog', {
      query: 'alpha',
      pageUrl: 'https://example.com/alpha/'
    }),
    /valid blog URL/
  );
  assert.throws(
    () => registry.execute('get_article', {
      url: 'https://example.com/alpha/'
    }),
    /valid blog URL/
  );
  assert.throws(
    () => registry.execute('get_related_articles', {
      url: 'https://example.com/alpha/'
    }),
    /valid blog URL/
  );
});

test('related target validation is unambiguous and missing corpus targets return no results', () => {
  const registry = createAgentTools(makeCorpus());

  assert.throws(
    () => registry.execute('get_related_articles', {
      url: '/alpha/',
      postId: 'post-a'
    }),
    /exactly one of url or postId/
  );
  assert.throws(
    () => registry.execute('get_related_articles', {
      topic: 'alpha'
    }),
    /exactly one of url or postId/
  );

  const missingArticle = registry.execute('get_article', {
    url: '/missing/'
  });
  const missingRelated = registry.execute('get_related_articles', {
    postId: 'missing'
  });

  assert.equal(missingArticle.article, null);
  assert.deepEqual(missingArticle.results, []);
  assert.equal(missingRelated.sourceArticle, null);
  assert.deepEqual(missingRelated.results, []);
});
