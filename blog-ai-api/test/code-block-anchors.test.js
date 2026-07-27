'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addCodeBlockAnchors,
  postUrl
} = require('../../scripts/code-block-anchors');

test('code-block anchor injection follows Hexo highlight containers rather than nested pre tags', () => {
  const anchors = [
    { anchor: 'blog-ai-code-0123456789abcdef01234567' },
    { anchor: 'blog-ai-code-fedcba9876543210fedcba98' }
  ];
  const content = [
    '<figure class="highlight python"><table><tr>',
    '<td><pre>line number</pre></td><td><pre>source</pre></td>',
    '</tr></table></figure>',
    '<figure class="highlight text"><pre>second source</pre></figure>'
  ].join('');

  const rendered = addCodeBlockAnchors(content, anchors);
  const injected = rendered.match(/id="blog-ai-code-[a-f0-9]{24}"/g) || [];

  assert.equal(injected.length, 2);
  assert.equal(
    rendered.indexOf(anchors[0].anchor) < rendered.indexOf(anchors[1].anchor),
    true
  );
});

test('code-block anchor URL resolution canonicalizes Hexo post fields', () => {
  assert.equal(
    postUrl({
      permalink: 'https://wangsenjie.github.io/2026/07/03/langgraph-foundations/index.html'
    }),
    'https://wangsenjie.github.io/2026/07/03/langgraph-foundations/'
  );
  assert.equal(
    postUrl({ path: '2026/07/03/langgraph-foundations/index.html' }),
    'https://wangsenjie.github.io/2026/07/03/langgraph-foundations/'
  );
  assert.equal(
    postUrl({ date: '2026-07-03', slug: 'langgraph-foundations' }),
    'https://wangsenjie.github.io/2026/07/03/langgraph-foundations/'
  );
});
