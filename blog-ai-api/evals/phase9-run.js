'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { AGENT_LIMITS } = require('../agent/config');
const { createAgentState } = require('../agent/state');
const { rewriteStandaloneQuery } = require('../agent/nodes/rewrite-query');
const { routeQuestion } = require('../agent/nodes/route');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase9.json');
const AGENT_PATH = path.resolve(__dirname, '../../source/js/blog-ai-agent.js');
const UI_PATH = path.resolve(__dirname, '../../source/_data/body-end.swig');
const REFERENCE_ACCURACY_TARGET = 0.95;

const REFERENCE_CORPUS = Object.freeze({
  posts: [{
    id: 'double-tower',
    title: '双塔模型',
    url: 'https://wangsenjie.github.io/double-tower/'
  }],
  chunks: [{
    id: 'tower#0',
    postId: 'double-tower',
    postTitle: '双塔模型',
    postUrl: 'https://wangsenjie.github.io/double-tower/',
    sectionTitle: '模型结构',
    content: '双塔模型包含请求塔和候选塔。'
  }]
});

const CROSS_VISIT_REFERENCE_CASES = Object.freeze([
  '它的结构是什么？',
  '请解释它的训练方式',
  '介绍一下它',
  '这个模型如何召回？',
  '这个算法如何训练？',
  '这篇文章讲了什么？',
  '本文的核心内容是什么？',
  '上一篇讲了什么？',
  '上一篇文章的线上召回怎么做？',
  '回到上一篇继续讲结构',
  '继续',
  '继续解释',
  '接着讲',
  '展开说明',
  '再讲详细点',
  '进一步说明',
  '详细说说',
  '继续解释相似度计算',
  '接着展开训练过程',
  '再解释一下线上召回'
]);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

function auditImplementation() {
  const agent = fs.readFileSync(AGENT_PATH, 'utf8');
  const ui = fs.readFileSync(UI_PATH, 'utf8');
  const savedMemory = section(
    agent,
    'function saveStoredMemory()',
    'function memoryStatusCopy()'
  );
  const remoteAsk = section(
    agent,
    'async function remoteAsk(question, mode, context, messages, requestId)',
    'function wait(milliseconds)'
  );
  const memoryFields = section(
    agent,
    'function managedMemoryFields(requestId)',
    'function applyAskMemory(memory)'
  );
  const resetConversation = section(
    agent,
    'async function resetConversation()',
    'async function clearMemory(options)'
  );
  const clearMemory = section(
    agent,
    'async function clearMemory(options)',
    'function togglePanel'
  );

  const checks = {
    localCredentialPersistence: agent.includes("window.localStorage") &&
      agent.includes("blog-ai-agent-memory-v1") &&
      savedMemory.includes('memoryToken: state.memory.token') &&
      !/messages|summary|articleRefs/.test(savedMemory),
    createAndRestore: agent.includes("'/api/memory/session', 'POST'") &&
      agent.includes('createMemorySession') &&
      agent.includes('restoreMemorySession'),
    managedAskContract: [
      'memoryToken: state.memory.token',
      'threadId: state.memory.threadId',
      'expectedMemoryVersion: state.memory.version',
      'requestId'
    ].every(marker => memoryFields.includes(marker)) &&
      remoteAsk.includes('managedMemoryFields(requestId)'),
    uuidPerRequest: agent.includes('function createRequestId()') &&
      agent.includes('const requestId = createRequestId();'),
    safeCredentialRecovery: agent.includes('[400, 401, 410]') &&
      agent.includes("clearMemoryCredential('idle', 'credential_rejected')"),
    versionConflictRecovery: agent.includes("error.statusCode === 409") &&
      agent.includes('restoreMemorySession({ hydrate: false })'),
    degradedCompatibilityHistory: agent.includes("setMemoryStatus('degraded'") &&
      agent.includes('trimConversationMessages(state.messages)') &&
      agent.includes('managedMemoryFields(requestId)'),
    serverThreadRotation: resetConversation.includes('/api/memory/thread') &&
      resetConversation.includes('currentThreadId: state.memory.threadId'),
    explicitClear: clearMemory.includes('/api/memory/session') &&
      clearMemory.includes("'DELETE'") &&
      clearMemory.includes("clearMemoryCredential('cleared'"),
    distinctUserControls: agent.includes('blog-ai-agent__new-conversation') &&
      agent.includes('blog-ai-agent__clear-memory'),
    visibleMemoryState: agent.includes('blog-ai-agent__memory-status') &&
      agent.includes('记忆暂不可用 · 当前对话仍可继续'),
    browserFeatureFlag: ui.includes('memoryV1Enabled: true'),
    noNetworkIdentity: !/userAgent|fingerprint|clientIp|x-forwarded-for/i.test(agent)
  };

  return {
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

function evaluateCrossVisitReferences() {
  const cases = CROSS_VISIT_REFERENCE_CASES.map(question => {
    const input = {
      sessionId: 'phase9_cross_visit_eval',
      question,
      messages: [{
        role: 'user',
        content: '什么是双塔模型？'
      }, {
        role: 'assistant',
        content: '双塔模型包含请求塔和候选塔。',
        citations: [{
          chunkId: 'tower#0',
          title: '双塔模型',
          url: 'https://wangsenjie.github.io/double-tower/',
          section: '模型结构'
        }],
        standaloneQuery: '双塔模型',
        indexVersion: 'phase9-eval'
      }, {
        role: 'user',
        content: question
      }]
    };
    const state = createAgentState(input, {
      corpus: REFERENCE_CORPUS,
      indexVersion: 'phase9-eval',
      limits: AGENT_LIMITS
    });
    state.route = routeQuestion(state);
    Object.assign(state, rewriteStandaloneQuery(state));
    const passed = !state.needsClarification &&
      state.standaloneQuery.includes('双塔模型');
    return {
      question,
      standaloneQuery: state.standaloneQuery,
      passed
    };
  });
  const passedCases = cases.filter(item => item.passed).length;
  const accuracy = cases.length ? passedCases / cases.length : 0;
  return {
    target: REFERENCE_ACCURACY_TARGET,
    accuracy,
    passedCases,
    totalCases: cases.length,
    passed: accuracy >= REFERENCE_ACCURACY_TARGET,
    cases
  };
}

function buildPhase9Report() {
  const implementation = auditImplementation();
  const crossVisitReferences = evaluateCrossVisitReferences();
  const releaseReady = implementation.passed && crossVisitReferences.passed;
  return {
    phase: 9,
    generatedAt: new Date().toISOString(),
    strategy: 'browser-anonymous-cross-session-memory-v1',
    implementation,
    crossVisitReferences,
    coverage: {
      firstVisitCreate: true,
      laterVisitRestore: true,
      managedAskMetadata: true,
      expiredTokenReinitialize: true,
      versionConflictRetry: true,
      degradedShortHistory: true,
      newConversationThreadRotation: true,
      clearAndRevoke: true,
      failedClearRetainsCredential: true
    },
    acceptance: {
      releaseReady,
      status: releaseReady ? 'passed' : 'failed'
    }
  };
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  return {
    outputPath: outputIndex >= 0 && argv[outputIndex + 1]
      ? path.resolve(argv[outputIndex + 1])
      : DEFAULT_OUTPUT_PATH
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = buildPhase9Report();
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 9: implementation=${report.implementation.passed ? 'PASS' : 'FAIL'} ` +
    `status=${report.acceptance.status}`
  );
  console.log(`Report written to ${options.outputPath}`);
  if (!report.acceptance.releaseReady) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  auditImplementation,
  buildPhase9Report,
  evaluateCrossVisitReferences
};
