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

test('registry exposes only the three allow-listed read-only tools', () => {
  const registry = createAgentTools(makeCorpus());

  assert.deepEqual(registry.names, [
    'search_blog',
    'get_article',
    'get_related_articles'
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
    ['get_related_articles', { postId: 'post-a', delete: true }]
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
