'use strict';

const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_ENDPOINT = 'https://blog-ai-api.vercel.app/api/ask';
const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase11-production.json');
const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'manifest.json');

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute' || argument === '--help') {
      flags.add(argument);
      continue;
    }
    if (!argument.startsWith('--') || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    values.set(argument, argv[index + 1]);
    index += 1;
  }
  const endpoint = values.get('--endpoint') || DEFAULT_ENDPOINT;
  if (new URL(endpoint).protocol !== 'https:') {
    throw new Error('Production endpoint must use HTTPS');
  }
  const timeoutMs = Number(values.get('--timeout-ms') || 35000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new Error('timeout-ms must be an integer from 1000 to 60000');
  }
  return {
    execute: flags.has('--execute'),
    help: flags.has('--help'),
    endpoint,
    proxy: values.get('--proxy') || '',
    timeoutMs,
    outputPath: path.resolve(values.get('--output') || DEFAULT_OUTPUT_PATH)
  };
}

async function requestJson(url, method, payload, options) {
  const marker = '__PHASE11_HTTP_STATUS__:';
  const args = [
    '--silent',
    '--show-error',
    '--connect-timeout',
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
    '--max-time',
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
    '--request',
    method,
    url,
    '--header',
    'Content-Type: application/json',
    '--data-binary',
    JSON.stringify(payload || {}),
    '--write-out',
    `\n${marker}%{http_code}`
  ];
  if (options.proxy) args.unshift('--proxy', options.proxy);
  const startedAt = Date.now();
  const { stdout } = await execFileAsync('curl', args, {
    timeout: options.timeoutMs + 5000,
    maxBuffer: 4 * 1024 * 1024
  });
  const markerIndex = stdout.lastIndexOf(`\n${marker}`);
  if (markerIndex < 0) throw new Error('curl response is missing HTTP status');
  const status = Number(stdout.slice(markerIndex + marker.length + 1));
  const bodyText = stdout.slice(0, markerIndex);
  let body = null;
  if (bodyText.trim()) {
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      throw new Error('Production response is not valid JSON');
    }
  }
  return { status, body, clientElapsedMs: Date.now() - startedAt };
}

function stageMetrics(body) {
  const meta = body && body.meta || {};
  const calls = Array.isArray(meta.toolCalls) ? meta.toolCalls : [];
  const result = {
    bm25Candidates: 0,
    denseCandidates: 0,
    rrfCandidates: 0,
    rerankerCandidates: 0,
    finalCandidates: Number(meta.retrieval && meta.retrieval.selectedChunks) || 0,
    embeddingRequests: 0,
    embeddingFailures: 0,
    embedding429: 0,
    embedding5xx: 0,
    contractPresent: false
  };
  for (const call of calls) {
    const stats = call && call.retrieval;
    if (!stats || typeof stats !== 'object') continue;
    const keys = [
      'bm25Candidates',
      'vectorCandidates',
      'fusedCandidates',
      'rerankedCandidates',
      'embeddingRequests',
      'embeddingFailures',
      'embedding429',
      'embedding5xx'
    ];
    if (keys.every(key => Object.hasOwn(stats, key))) result.contractPresent = true;
    result.bm25Candidates += Number(stats.bm25Candidates) || 0;
    result.denseCandidates += Number(stats.vectorCandidates) || 0;
    result.rrfCandidates += Number(stats.fusedCandidates) || 0;
    result.rerankerCandidates += Number(stats.rerankedCandidates) || 0;
    result.embeddingRequests += Number(stats.embeddingRequests) || 0;
    result.embeddingFailures += Number(stats.embeddingFailures) || 0;
    result.embedding429 += Number(stats.embedding429) || 0;
    result.embedding5xx += Number(stats.embedding5xx) || 0;
  }
  return result;
}

function askRecord(id, response) {
  const body = response.body || {};
  const meta = body.meta || {};
  const flags = meta.releaseFlags || {};
  const timings = meta.timings || {};
  return {
    id,
    status: response.status,
    traceId: String(meta.traceId || ''),
    indexVersion: String(meta.indexVersion || ''),
    releaseFlags: flags,
    retrievalStrategy: String(meta.retrieval && meta.retrieval.strategy || ''),
    stageMetrics: stageMetrics(body),
    claims: Array.isArray(body.claims) ? body.claims.length : 0,
    citations: Array.isArray(body.citations) ? body.citations.length : 0,
    verificationStatus: String(
      meta.citationVerification && meta.citationVerification.status || ''
    ),
    memory: {
      status: String(body.memory && body.memory.status || ''),
      writeStatus: String(body.memory && body.memory.writeStatus || ''),
      replayed: Boolean(body.memory && body.memory.replayed),
      ttlPresent: Boolean(body.memory && body.memory.expiresAt)
    },
    latencyMs: {
      retrieval: Number.isFinite(Number(timings.retrievalMs))
        ? Number(timings.retrievalMs)
        : null,
      generation: Number.isFinite(Number(timings.generationMs))
        ? Number(timings.generationMs)
        : null,
      verification: Number.isFinite(Number(timings.semanticVerificationMs))
        ? Number(timings.semanticVerificationMs)
        : Number.isFinite(Number(timings.citationVerificationMs))
          ? Number(timings.citationVerificationMs)
          : null,
      total: Number.isFinite(Number(timings.totalMs))
        ? Number(timings.totalMs)
        : null,
      client: response.clientElapsedMs
    }
  };
}

function percentile(values, ratio) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
    : null;
}

function allFlagsPresent(flags) {
  return [
    'ragChunkV2',
    'remoteEmbedding',
    'semanticReranker',
    'memoryV1',
    'naturalAnswerV2',
    'semanticVerifier'
  ].every(key => typeof flags[key] === 'boolean');
}

async function runProductionAudit(options) {
  const expectedIndexVersion = String(
    JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).corpusVersion || ''
  );
  const baseUrl = new URL(options.endpoint);
  const memoryUrl = `${baseUrl.origin}/api/memory/session`;
  const session = await requestJson(memoryUrl, 'POST', {}, options);
  if (session.status !== 201 || !session.body || !session.body.memoryToken) {
    throw new Error(`Unable to create production memory session: HTTP ${session.status}`);
  }
  const memoryToken = session.body.memoryToken;
  const memory = session.body.memory || {};
  const requestId = randomUUID();
  const managedPayload = {
    question: '双塔模型是什么？',
    memoryToken,
    threadId: memory.threadId,
    expectedMemoryVersion: memory.version,
    requestId
  };
  const results = [];
  let clear = { status: 0 };
  try {
    const answer = await requestJson(options.endpoint, 'POST', {
      question: '双塔模型的结构是什么？',
      sessionId: 'phase10_gray_10'
    }, options);
    results.push(askRecord('answer', answer));
    const refusal = await requestJson(options.endpoint, 'POST', {
      question: '博客里如何证明量子引力的弦理论对偶？',
      sessionId: 'phase10_gray_10'
    }, options);
    results.push(askRecord('refusal', refusal));
    const managed = await requestJson(
      options.endpoint,
      'POST',
      managedPayload,
      options
    );
    results.push(askRecord('memory_write', managed));
    const replay = await requestJson(
      options.endpoint,
      'POST',
      managedPayload,
      options
    );
    results.push(askRecord('memory_replay', replay));
  } finally {
    clear = await requestJson(memoryUrl, 'DELETE', {
      memoryToken,
      requestId: randomUUID()
    }, options).catch(() => ({ status: 0 }));
  }

  const answer = results.find(item => item.id === 'answer');
  const refusal = results.find(item => item.id === 'refusal');
  const managed = results.find(item => item.id === 'memory_write');
  const replay = results.find(item => item.id === 'memory_replay');
  const checks = {
    httpSuccess: results.every(item => item.status === 200),
    indexVersionCurrent: Boolean(expectedIndexVersion) &&
      results.every(item => item.indexVersion === expectedIndexVersion),
    featureFlagContract: results.every(item => allFlagsPresent(item.releaseFlags)),
    productionFlagsEnabled: [
      'ragChunkV2', 'remoteEmbedding', 'semanticReranker', 'memoryV1',
      'naturalAnswerV2', 'semanticVerifier'
    ].every(key => answer.releaseFlags[key] === true),
    candidateMetricContract: results
      .filter(item => item.id !== 'memory_replay')
      .some(item => item.stageMetrics.contractPresent),
    hybridObserved: results.some(item => (
      item.retrievalStrategy === 'hybrid_rrf_rerank'
    )),
    answerPublishedWithCitation: answer.claims > 0 && answer.citations > 0,
    refusalSafe: refusal.claims === 0 && refusal.citations === 0,
    memoryCommitted: managed.memory.status === 'active' &&
      managed.memory.writeStatus === 'committed' && managed.memory.ttlPresent,
    idempotencyReplay: replay.memory.replayed ||
      replay.memory.writeStatus === 'duplicate',
    explicitClear: clear.status === 204,
    latencyP95: percentile(
      results.map(item => item.latencyMs.total),
      0.95
    ) <= 12000
  };
  return {
    phase: 11,
    kind: 'production-release-audit',
    generatedAt: new Date().toISOString(),
    endpointHost: baseUrl.host,
    expectedIndexVersion,
    memorySession: {
      createStatus: session.status,
      ttlPresent: Boolean(memory.expiresAt),
      clearStatus: clear.status
    },
    results,
    metrics: {
      requests: results.length,
      serverP95Ms: percentile(results.map(item => item.latencyMs.total), 0.95),
      clientP95Ms: percentile(results.map(item => item.latencyMs.client), 0.95),
      embeddingRequests: results.reduce(
        (total, item) => total + item.stageMetrics.embeddingRequests,
        0
      ),
      embeddingFailures: results.reduce(
        (total, item) => total + item.stageMetrics.embeddingFailures,
        0
      )
    },
    acceptance: {
      checks,
      passed: Object.values(checks).every(Boolean)
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node evals/phase11-production-run.js --execute ' +
      '[--proxy http://127.0.0.1:7890] [--endpoint https://.../api/ask]'
    );
    return;
  }
  if (!options.execute) {
    console.log('Phase 11 production audit preview: 4 asks plus create and clear.');
    console.log('Add --execute to send production requests.');
    return;
  }
  const report = await runProductionAudit(options);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 11 production: requests=${report.metrics.requests} ` +
    `p95=${report.metrics.serverP95Ms}ms ` +
    `acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`
  );
  console.log(`Report written to ${options.outputPath}`);
  if (!report.acceptance.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  allFlagsPresent,
  askRecord,
  parseArgs,
  percentile,
  runProductionAudit,
  stageMetrics
};
