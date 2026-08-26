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
  const remoteCall = ask.indexOf('await remoteAskWithMemoryRecovery(');
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
    'async function remoteAsk(question, mode, context, messages, requestId)',
    'function renderAssistantMessage'
  );

  assert.doesNotMatch(agent, /posts\.json/, 'the browser must not request posts.json');
  assert.match(remoteAsk, /body:\s*JSON\.stringify\s*\(/, 'the remote request must use a JSON body');
  assert.doesNotMatch(remoteAsk, /\bretrieval\s*:/, 'the request must not send retrieval data');
  assert.doesNotMatch(remoteAsk, /\bsources\s*:/, 'the request must not send client candidates');
  assert.doesNotMatch(remoteAsk, /chunks\.json|loadCorpus\s*\(|rankChunks\s*\(/);
});

test('remote requests carry bounded conversation state without duplicating the current user', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const remoteAsk = sourceSection(
    agent,
    'async function remoteAsk(question, mode, context, messages, requestId)',
    'function renderAssistantMessage'
  );
  const ask = sourceSection(agent, 'async function ask(question)', 'function renderConversationHistory');

  assert.match(agent, /const MAX_HISTORY_MESSAGES = 8;/);
  assert.match(remoteAsk, /\bquestion,/);
  assert.match(remoteAsk, /\bsessionId:\s*state\.sessionId,/);
  assert.match(remoteAsk, /\bmessages,/);
  assert.match(remoteAsk, /\bmode,/);
  assert.match(remoteAsk, /\bpage:\s*context/);
  assert.match(
    ask,
    /trimConversationMessages\(\[\s*\.\.\.state\.messages,\s*\{\s*role:\s*'user',\s*content:\s*trimmed\s*\}/
  );
  assert.match(ask, /remoteAskWithMemoryRecovery\(\s*trimmed,\s*mode,\s*context,\s*requestMessages,\s*requestId\s*\)/);

  const currentUserOccurrences = (
    ask.match(/\{\s*role:\s*'user',\s*content:\s*trimmed\s*\}/g) || []
  ).length;
  assert.equal(currentUserOccurrences, 1, 'the current user must enter request history exactly once');
});

test('assistant conversation history keeps only compact article references', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const normalizeMessage = sourceSection(
    agent,
    'function normalizeHistoryMessage(value)',
    'function trimConversationMessages'
  );
  const commitConversation = sourceSection(
    agent,
    'function commitConversation(requestMessages, result, standaloneQuery)',
    'async function ask(question)'
  );

  assert.match(normalizeMessage, /message\.citations/);
  assert.match(normalizeMessage, /message\.related/);
  assert.match(normalizeMessage, /message\.indexVersion/);
  assert.doesNotMatch(normalizeMessage, /\bsnippet\b/);
  assert.match(commitConversation, /citations:\s*result\.citations/);
  assert.match(commitConversation, /related:\s*result\.related/);
  assert.match(commitConversation, /indexVersion:\s*result\.meta && result\.meta\.indexVersion/);
});

test('the verified natural answer renders server-owned inline citations without claim override', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const renderAnswerBody = sourceSection(
    agent,
    'function renderAnswerBody(result)',
    'function feedbackHtml'
  );

  assert.match(renderAnswerBody, /result\.answer/);
  assert.doesNotMatch(renderAnswerBody, /result\.claims/);
  assert.match(renderAnswerBody, /citations\[index - 1\]/);
  assert.match(renderAnswerBody, /blog-ai-agent__claim-citation/);
  assert.match(renderAnswerBody, /escapeHtml\(answer\)/);
  assert.match(renderAnswerBody, /safePostUrl/);
});

test('Phase 5 artifacts are escaped and never masquerade as local BM25 fallback', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const renderComparison = sourceSection(
    agent,
    'function renderComparison(result)',
    'function renderLearningPath'
  );
  const renderLearningPath = sourceSection(
    agent,
    'function renderLearningPath(result)',
    'function renderCodeExplanation'
  );
  const renderCodeExplanation = sourceSection(
    agent,
    'function renderCodeExplanation(result)',
    'function renderPhase5Artifacts'
  );
  const localAsk = sourceSection(
    agent,
    'async function localAsk(question, mode, context, ranked)',
    'async function remoteAsk(question, mode, context, messages, requestId)'
  );

  assert.match(renderComparison, /escapeHtml\(compactText\(cell\.text, 800\)\)/);
  assert.match(renderComparison, /safePostUrl\(article && article\.url\)/);
  assert.match(renderLearningPath, /作者维护的站内学习图谱/);
  assert.match(renderLearningPath, /不由相关文章相似度推断/);
  assert.match(renderCodeExplanation, /safeCodeAnchor\(block\.anchor\)/);
  assert.match(renderCodeExplanation, /safePostUrl\(block\.postUrl\)/);
  assert.match(renderCodeExplanation, /<pre><code class="language-\$\{escapeHtml\(language\)\}">\$\{escapeHtml\(code\)\}<\/code><\/pre>/);
  assert.doesNotMatch(renderCodeExplanation, /\$\{code\}(?!\))/);

  const guardPosition = localAsk.indexOf('if (requiresServerPhase5Feature(question))');
  const corpusLoadPosition = localAsk.indexOf('await loadCorpus()');
  assert.notEqual(guardPosition, -1);
  assert.notEqual(corpusLoadPosition, -1);
  assert.ok(guardPosition < corpusLoadPosition);
  assert.match(localAsk, /answer: unavailablePhase5Answer\(question\)/);
  assert.match(localAsk, /citations: \[\]/);
  assert.match(localAsk, /related: \[\]/);
  assert.match(agent, /对比|比较|有何异同/);
  assert.match(agent, /学习路径|学习路线|阅读顺序/);
  assert.match(agent, /代码块|这段代码/);
});

test('feedback is signed server state, omitted from fallback and never persisted', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const remoteAsk = sourceSection(
    agent,
    'async function remoteAsk(question, mode, context, messages, requestId)',
    'function renderAssistantMessage'
  );
  const feedbackHtml = sourceSection(
    agent,
    'function feedbackHtml(result, isFallback)',
    'function renderAssistantMessage'
  );
  const submitFeedback = sourceSection(
    agent,
    'async function submitFeedback(container, rating)',
    'function setBusy'
  );
  const commitConversation = sourceSection(
    agent,
    'function commitConversation(requestMessages, result, standaloneQuery)',
    'async function ask(question)'
  );

  assert.match(remoteAsk, /feedback:\s*result\.feedback \|\| null/);
  assert.match(feedbackHtml, /!isFallback/);
  assert.match(feedbackHtml, /validFeedbackReceipt/);
  assert.match(feedbackHtml, /data-feedback-receipt/);
  assert.match(submitFeedback, /\/api\/feedback/);
  assert.match(submitFeedback, /credentials:\s*'omit'/);
  assert.match(submitFeedback, /keepalive:\s*true/);
  assert.match(submitFeedback, /JSON\.stringify\(\{ receipt, rating, reason \}\)/);
  assert.doesNotMatch(commitConversation, /feedback/);
});

test('conversation history remains session scoped while memory credentials are local and bounded', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const saveConversation = sourceSection(
    agent,
    'function saveConversation()',
    'function restoreConversation()'
  );
  const restoreConversation = sourceSection(
    agent,
    'function restoreConversation()',
    'function memoryStorage()'
  );
  const saveStoredMemory = sourceSection(
    agent,
    'function saveStoredMemory()',
    'function memoryStatusCopy()'
  );

  assert.match(agent, /blog-ai-agent-conversation-v1/);
  assert.match(agent, /const CONVERSATION_SCHEMA_VERSION = 1;/);
  assert.match(agent, /const CONVERSATION_TTL_MS = 2 \* 60 \* 60 \* 1000;/);
  assert.match(agent, /window\.sessionStorage/);
  assert.match(agent, /blog-ai-agent-memory-v1/);
  assert.match(agent, /window\.localStorage/);
  assert.match(saveConversation, /expiresAt:\s*Date\.now\(\) \+ CONVERSATION_TTL_MS/);
  assert.match(saveConversation, /trimConversationMessages\(state\.messages\)/);
  assert.match(restoreConversation, /serialized\.length <= MAX_STORED_CONVERSATION_CHARACTERS/);
  assert.match(restoreConversation, /payload\.expiresAt <= Date\.now\(\)/);
  assert.match(restoreConversation, /isValidSessionId\(payload\.sessionId\)/);
  assert.match(saveStoredMemory, /memoryToken:\s*state\.memory\.token/);
  assert.match(saveStoredMemory, /memoryVersion:/);
  assert.doesNotMatch(saveStoredMemory, /messages|summary|articleRefs/);
});

test('local fallback conservatively rewrites ordinal and pronoun follow-ups', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const rewrite = sourceSection(
    agent,
    'function rewriteFollowUpQuestion(question, mode, context)',
    'function storage()'
  );
  const ask = sourceSection(agent, 'async function ask(question)', 'function renderConversationHistory');

  assert.match(rewrite, /getOrdinalReferences\(question,\s*references\)/);
  assert.match(rewrite, /我还没有足够的文章顺序/);
  assert.match(rewrite, /继续\|接着\|展开/);
  assert.match(rewrite, /它\|这个\|那个\|上述/);
  assert.match(rewrite, /我还不确定你指的是哪个概念或哪篇文章/);
  assert.match(ask, /fallbackPlan\.clarification/);
  assert.match(ask, /fallbackPlan\.question/);
  assert.match(ask, /await localAsk\(/);
});

test('new conversation rotates the server thread while clear memory stays a separate action', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const setBusy = sourceSection(agent, 'function setBusy(isBusy)', 'function commitConversation');
  const abortActiveWork = sourceSection(
    agent,
    'function abortActiveWork()',
    'function resetLocalConversation()'
  );
  const resetLocalConversation = sourceSection(
    agent,
    'function resetLocalConversation()',
    'async function resetConversation()'
  );
  const resetConversation = sourceSection(
    agent,
    'async function resetConversation()',
    'async function clearMemory(options)'
  );
  const clearMemory = sourceSection(
    agent,
    'async function clearMemory(options)',
    'function togglePanel'
  );

  assert.match(setBusy, /state\.busy = isBusy/);
  assert.match(setBusy, /state\.elements\.suggestionButtons\.forEach/);
  assert.match(setBusy, /button\.disabled = isBusy/);
  assert.match(abortActiveWork, /state\.requestEpoch \+= 1/);
  assert.match(abortActiveWork, /state\.activeController\.abort\(\)/);
  assert.match(resetLocalConversation, /state\.sessionId = createSessionId\(\)/);
  assert.match(resetLocalConversation, /state\.messages = \[\]/);
  assert.match(resetLocalConversation, /state\.lastArticleRefs = \[\]/);
  assert.match(resetLocalConversation, /saveConversation\(\)/);
  assert.match(resetConversation, /\/api\/memory\/thread/);
  assert.match(resetConversation, /currentThreadId:\s*state\.memory\.threadId/);
  assert.match(clearMemory, /\/api\/memory\/session/);
  assert.match(clearMemory, /'DELETE'/);
  assert.match(clearMemory, /clearMemoryCredential\('cleared'/);
  assert.match(agent, /blog-ai-agent__new-conversation/);
  assert.match(agent, /blog-ai-agent__clear-memory/);
});

test('chunks.json is loaded only by the local fallback implementation', () => {
  const agent = readWorkspaceFile('source/js/blog-ai-agent.js');
  const loadCorpusStart = agent.indexOf('async function loadCorpus()');
  const rankChunksStart = agent.indexOf('function rankChunks', loadCorpusStart);
  const loadCorpus = sourceSection(agent, 'async function loadCorpus()', 'function rankChunks');
  const localAsk = sourceSection(
    agent,
    'async function localAsk(question, mode, context, ranked)',
    'async function remoteAsk(question, mode, context, messages, requestId)'
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
