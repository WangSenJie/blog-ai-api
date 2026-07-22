'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspaceRoot = path.resolve(__dirname, '../..');

function readWorkspaceFile(relativePath, encoding = 'utf8') {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), encoding);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('browser retrieval core is the byte-for-byte server core', () => {
  const serverCore = readWorkspaceFile('blog-ai-api/lib/retrieval-core.js', null);
  const browserCore = readWorkspaceFile('source/js/blog-ai-retrieval.js', null);

  assert.deepEqual(browserCore, serverCore);
});

test('shared retrieval core loads before the browser agent', () => {
  const bodyEnd = readWorkspaceFile('source/_data/body-end.swig');
  const coreScript = '<script src="/js/blog-ai-retrieval.js"></script>';
  const agentScript = '<script src="/js/blog-ai-agent.js"></script>';
  const corePosition = bodyEnd.indexOf(coreScript);
  const agentPosition = bodyEnd.indexOf(agentScript);

  assert.notEqual(corePosition, -1, 'shared retrieval script must be included');
  assert.notEqual(agentPosition, -1, 'browser agent script must be included');
  assert.ok(corePosition < agentPosition, 'shared retrieval core must load before the agent');
});

test('the normal browser flow asks the server before entering local fallback', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const ask = sourceSection(agent, 'async function ask(question)', 'function togglePanel');
  const remoteCall = ask.indexOf('await remoteAsk(');
  const fallbackCatch = ask.indexOf('} catch (error) {', remoteCall);
  const localCall = ask.indexOf('await localAsk(');

  assert.notEqual(remoteCall, -1, 'ask must call the remote API');
  assert.notEqual(localCall, -1, 'ask must retain a local fallback');
  assert.ok(remoteCall < fallbackCatch, 'the remote call must happen before its fallback catch');
  assert.ok(fallbackCatch < localCall, 'the local call must be inside the failure path');
});

test('remote requests do not load or send browser-side retrieval candidates', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const remoteAsk = sourceSection(
    agent,
    'async function remoteAsk(question, mode, context)',
    'function renderAssistantMessage'
  );

  assert.doesNotMatch(agent, /posts\.json/, 'the browser must not request posts.json');
  assert.match(remoteAsk, /body:\s*JSON\.stringify\s*\(/, 'the remote request must use a JSON body');
  assert.doesNotMatch(remoteAsk, /\bretrieval\s*:/, 'the request must not send retrieval data');
  assert.doesNotMatch(remoteAsk, /\bsources\s*:/, 'the request must not send client candidates');
  assert.doesNotMatch(remoteAsk, /chunks\.json|loadCorpus\s*\(|rankChunks\s*\(/);
});

test('chunks.json is loaded only by the local fallback implementation', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const loadCorpusStart = agent.indexOf('async function loadCorpus()');
  const rankChunksStart = agent.indexOf('function rankChunks', loadCorpusStart);
  const loadCorpus = sourceSection(agent, 'async function loadCorpus()', 'function rankChunks');
  const localAsk = sourceSection(
    agent,
    'async function localAsk(question, mode, context, ranked)',
    'async function remoteAsk(question, mode, context)'
  );
  const outsideLoadCorpus = agent.slice(0, loadCorpusStart) + agent.slice(rankChunksStart);

  assert.match(loadCorpus, /fetch\(`\$\{basePath\}\/chunks\.json`/);
  assert.match(localAsk, /await loadCorpus\(\)/, 'local fallback must lazily load chunks');
  assert.doesNotMatch(
    outsideLoadCorpus,
    /chunks\.json/,
    'chunks.json must not be loaded outside the fallback corpus loader'
  );

  const loadCorpusReferences = agent.match(/\bloadCorpus\s*\(/g) || [];
  assert.equal(
    loadCorpusReferences.length,
    2,
    'loadCorpus should only appear in its declaration and local fallback call'
  );
});
