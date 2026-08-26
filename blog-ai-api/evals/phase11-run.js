'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { phase10Features } = require('../agent/config');
const { buildVectorIndex } = require('../lib/embedding');
const {
  hybridRankChunks,
  hybridRankChunksAsync
} = require('../lib/hybrid-retrieve');
const { loadCorpus } = require('../lib/corpus');
const { getReleaseFlags } = require('../lib/release-flags');
const {
  createMemoryService
} = require('../memory/service');
const {
  InMemoryMemoryStore
} = require('../memory/store');
const { verifyMemoryToken } = require('../memory/token');
const {
  buildCorpus
} = require('../../scripts/build-ai-corpus');
const {
  PROFILE_CHUNKING
} = require('../../scripts/rag-chunk-profiles');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase11.json');
const OPERATIONS_POLICY_PATH = path.join(
  REPOSITORY_ROOT,
  'blog-ai-api',
  'config',
  'phase11-operations.json'
);
const LEGACY_REVISION = '7e6d67b';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeContent(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function idDiff(baseline, candidate) {
  const baselineById = new Map((baseline || []).map(item => [item.id, item]));
  const candidateById = new Map((candidate || []).map(item => [item.id, item]));
  const added = [...candidateById.keys()].filter(id => !baselineById.has(id));
  const deleted = [...baselineById.keys()].filter(id => !candidateById.has(id));
  const retained = [...candidateById.keys()].filter(id => baselineById.has(id));
  const updated = retained.filter(id => (
    String(candidateById.get(id).contentHash || '') !==
    String(baselineById.get(id).contentHash || '')
  ));
  return {
    baseline: baselineById.size,
    candidate: candidateById.size,
    added: added.length,
    deleted: deleted.length,
    retained: retained.length,
    updated: updated.length,
    chunkIdChurnRatio: baselineById.size
      ? (added.length + deleted.length) / baselineById.size
      : candidateById.size ? 1 : 0,
    contentUpdateRatio: retained.length ? updated.length / retained.length : 0,
    samples: {
      added: added.slice(0, 20),
      deleted: deleted.slice(0, 20),
      updated: updated.slice(0, 20)
    }
  };
}

function duplicateAudit(chunks) {
  const groups = new Map();
  for (const chunk of chunks || []) {
    const content = normalizeContent(chunk && chunk.content);
    if (!content) continue;
    if (!groups.has(content)) groups.set(content, []);
    groups.get(content).push(chunk.id);
  }
  const duplicates = [...groups.values()].filter(ids => ids.length > 1);
  return {
    duplicatedChunks: duplicates.reduce((total, ids) => total + ids.length - 1, 0),
    groups: duplicates.length,
    samples: duplicates.slice(0, 20).map(ids => ids.slice(0, 8))
  };
}

function tableHasHeader(chunk) {
  const rows = String(chunk && chunk.content || '')
    .split('\n')
    .map(row => row.split('|').map(cell => cell.trim()).filter(Boolean))
    .filter(cells => cells.length);
  return rows.length >= 2 && rows[0].length >= 2;
}

function formulaLooksSplit(chunk) {
  const content = String(chunk && chunk.content || '');
  const begins = (content.match(/\\begin\{/g) || []).length;
  const ends = (content.match(/\\end\{/g) || []).length;
  return begins !== ends || /(?:<!--|-->)\s*\$\$/.test(content) ||
    /\$\$\s*(?:<!--|-->)/.test(content);
}

function ingestionAudit(corpus) {
  const source = buildCorpus(path.join(REPOSITORY_ROOT, 'source', '_posts'));
  const deployedChunks = corpus.chunks;
  const candidateChunks = readJson(path.join(REPOSITORY_ROOT, 'data', 'chunks.json'));
  const empty = deployedChunks.filter(chunk => !normalizeContent(chunk.content));
  const tooShort = deployedChunks.filter(chunk => Number(chunk.tokenCount) < 8);
  const tooLong = deployedChunks.filter(chunk => {
    const profile = PROFILE_CHUNKING[chunk.profile];
    return profile && Number(chunk.tokenCount) > profile.maxTokens;
  });
  const specialOverflow = deployedChunks.filter(chunk => chunk.overflowReason);
  const codeContamination = deployedChunks.filter(chunk => (
    Array.isArray(chunk.blockTypes) &&
    chunk.blockTypes.includes('code') &&
    chunk.chunkType !== 'code'
  ));
  const tablesMissingHeader = deployedChunks.filter(chunk => (
    chunk.chunkType === 'table' && !tableHasHeader(chunk)
  ));
  const formulaSplit = deployedChunks.filter(chunk => (
    ['formula', 'formula-context'].includes(chunk.chunkType) &&
    formulaLooksSplit(chunk)
  ));
  const ingestion = corpus.manifest.ingestion;

  return {
    profiles: ingestion.stats.profileCounts,
    profileSources: ingestion.stats.profileSourceCounts,
    blockTypes: ingestion.stats.blockTypeCounts,
    chunkTypes: ingestion.stats.chunkTypeCounts,
    tokenCount: ingestion.stats.tokenCount,
    anomalies: {
      empty: empty.map(chunk => chunk.id),
      duplicate: duplicateAudit(deployedChunks),
      tooShort: {
        thresholdTokens: 8,
        count: tooShort.length,
        samples: tooShort.slice(0, 30).map(chunk => ({
          id: chunk.id,
          tokens: chunk.tokenCount,
          type: chunk.chunkType
        }))
      },
      tooLong: {
        definition: 'profile maxTokens exceeded',
        count: tooLong.length,
        samples: tooLong.slice(0, 30).map(chunk => ({
          id: chunk.id,
          tokens: chunk.tokenCount,
          reason: chunk.overflowReason || ''
        }))
      },
      specialStructureOverflow: specialOverflow.map(chunk => ({
        id: chunk.id,
        type: chunk.chunkType,
        tokens: chunk.tokenCount,
        reason: chunk.overflowReason
      })),
      codeContamination: codeContamination.map(chunk => chunk.id),
      tablesMissingHeader: tablesMissingHeader.map(chunk => chunk.id),
      formulaAbnormalSplit: formulaSplit.map(chunk => chunk.id)
    },
    vectors: Object.assign({}, corpus.manifest.embedding.build, {
      coverage: corpus.chunks.length
        ? corpus.vectors.length / corpus.chunks.length
        : 1,
      model: corpus.manifest.embedding.model,
      dimensions: corpus.manifest.embedding.dimensions
    }),
    chunkIdChurn: {
      deployment: idDiff(deployedChunks, candidateChunks),
      reproducibleSourceBuild: idDiff(deployedChunks, source.chunks)
    },
    articleLists: {
      undeclaredProfile: source.diagnostics.postsWithoutDeclaredProfile,
      noUrl: source.diagnostics.postsWithoutUrl,
      unindexable: source.diagnostics.postsWithoutIndexableContent,
      unpublished: source.diagnostics.unpublishedPosts
    },
    findings: {
      criticalIntegrityErrors: empty.length +
        codeContamination.length +
        tablesMissingHeader.length,
      declaredFormulaSplitFindings: formulaSplit.length,
      sourceBuildMatchesDeployment: idDiff(deployedChunks, source.chunks)
        .chunkIdChurnRatio === 0
    }
  };
}

function onlineMetricsAudit() {
  const production = readJson(path.join(
    __dirname,
    'reports',
    'phase10-production.json'
  ));
  const embeddingBuildPath = path.join(
    REPOSITORY_ROOT,
    'data',
    'embedding-build-report.json'
  );
  const embeddingBuild = fs.existsSync(embeddingBuildPath)
    ? readJson(embeddingBuildPath)
    : null;
  return {
    event: 'ask.completed.v1',
    retrievalCandidates: [
      'retrieval.bm25Candidates',
      'retrieval.denseCandidates',
      'retrieval.rrfCandidates',
      'retrieval.rerankerCandidates',
      'retrieval.finalCandidates'
    ],
    latency: [
      'latencyMs.retrieval',
      'latencyMs.generation',
      'latencyMs.verification',
      'latencyMs.total'
    ],
    embedding: {
      fields: [
        'retrieval.embeddingRequests',
        'retrieval.embeddingFailures',
        'retrieval.embedding429',
        'retrieval.embedding5xx',
        'retrieval.embeddingEstimatedCostUsd'
      ],
      build: embeddingBuild && {
        status: embeddingBuild.status,
        requestsUsageTokens: embeddingBuild.usage,
        durationMs: embeddingBuild.durationMs,
        failures: embeddingBuild.failures.length,
        estimatedCostUsd: null,
        costReason: 'provider billing rate is not stored in source control'
      }
    },
    redis: [
      'memory.hit',
      'memory.updateConflict',
      'memory.ttlSecondsRemaining',
      'memory.idempotencyHit',
      'memory.degraded'
    ],
    answers: [
      'answer.published',
      'answer.refused',
      'answer.citations',
      'answer.unansweredSubquestions',
      'answer.verificationStatus',
      'answer.verificationReasons'
    ],
    productionBaseline: production.acceptance,
    policy: readJson(OPERATIONS_POLICY_PATH)
  };
}

function productionAuditEvidence() {
  const reportPath = path.join(__dirname, 'reports', 'phase11-production.json');
  if (!fs.existsSync(reportPath)) {
    return {
      available: false,
      passed: false,
      report: 'evals/reports/phase11-production.json'
    };
  }
  const report = readJson(reportPath);
  return {
    available: true,
    generatedAt: report.generatedAt,
    endpointHost: report.endpointHost,
    metrics: report.metrics,
    checks: report.acceptance && report.acceptance.checks,
    passed: Boolean(report.acceptance && report.acceptance.passed),
    report: 'evals/reports/phase11-production.json'
  };
}

function privacyAudit() {
  const askSource = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'blog-ai-api', 'api', 'ask.js'),
    'utf8'
  );
  const observabilitySource = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'blog-ai-api', 'lib', 'observability.js'),
    'utf8'
  );
  const feedbackSource = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'blog-ai-api', 'api', 'feedback.js'),
    'utf8'
  );
  const checks = {
    askUsesWhitelistMetricBuilder: askSource.includes('buildAskMetrics(payload'),
    rawExceptionMessageNotLogged: !askSource.includes('message: error &&') &&
      !feedbackSource.includes('message: error &&'),
    stackTraceNotLogged: !askSource.includes('stack: error &&'),
    metricBuilderDoesNotCopyQuestion: !observabilitySource.includes('source.question'),
    metricBuilderDoesNotCopyMemoryToken: !observabilitySource.includes('source.memoryToken'),
    metricBuilderDoesNotCopyAnswerText: !observabilitySource.includes('source.answer')
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    policy: readJson(OPERATIONS_POLICY_PATH).logPrivacy
  };
}

function fixtureChunks() {
  return [{
    id: 'chunk_phase11_rollback',
    contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    postId: 'rollback',
    postTitle: '双塔模型',
    postUrl: '/rollback/',
    tags: ['推荐系统'],
    categories: [],
    headingPath: ['结构'],
    sectionTitle: '结构',
    content: '双塔模型分别编码用户和物品，并计算向量相似度。'
  }];
}

function legacyArtifactAudit() {
  const names = [
    'posts.json',
    'chunks.json',
    'manifest.json',
    'vectors.json',
    'code-blocks.json',
    'learning-graph.json'
  ];
  const available = {};
  for (const name of names) {
    try {
      execFileSync('git', [
        'cat-file',
        '-e',
        `${LEGACY_REVISION}:data/${name}`
      ], { cwd: REPOSITORY_ROOT, stdio: 'ignore' });
      available[name] = true;
    } catch (error) {
      available[name] = false;
    }
  }
  const manifest = JSON.parse(execFileSync('git', [
    'show',
    `${LEGACY_REVISION}:data/manifest.json`
  ], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  }));
  return {
    revision: LEGACY_REVISION,
    command: 'RAG_CHUNK_V2_ENABLED=false npm run export:ai',
    available,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      corpusVersion: manifest.corpusVersion,
      chunks: manifest.files && manifest.files.chunks &&
        manifest.files.chunks.count
    },
    passed: Object.values(available).every(Boolean)
  };
}

async function rollbackAudit() {
  const chunks = fixtureChunks();
  const vectors = buildVectorIndex(chunks, []).vectors;
  const remoteOff = await hybridRankChunksAsync(
    chunks,
    vectors,
    '双塔模型',
    'site',
    null,
    { remoteEmbeddingEnabled: false }
  );
  const rerankerOff = hybridRankChunks(
    chunks,
    vectors,
    '双塔模型',
    'site',
    null,
    { semanticRerankerEnabled: false }
  );
  const now = 1787712000000;
  const store = new InMemoryMemoryStore({ now: () => now });
  const tokenSecret = 'phase11-token-secret-12345678901234567890';
  const keySecret = 'phase11-key-secret-098765432109876543210';
  const memory = createMemoryService({
    enabled: true,
    store,
    tokenSecret,
    keySecret,
    now: () => now
  });
  const session = await memory.createSession();
  const digest = verifyMemoryToken(session.memoryToken, {
    tokenSecret,
    keySecret
  }).tokenDigest;
  const beforeDisable = await store.get(digest, 2592000);
  createMemoryService({ enabled: false, store });
  const afterDisable = await store.get(digest, 2592000);
  const answerOff = phase10Features({
    NATURAL_ANSWER_V2_ENABLED: 'false',
    SEMANTIC_VERIFIER_ENABLED: 'false',
    GROUNDED_SYNTHESIS_ROLLOUT_PERCENT: '100'
  }, 'phase11-rollback');
  const fullEnvironment = {
    RAG_CHUNK_V2_ENABLED: 'false',
    REMOTE_EMBEDDING_ENABLED: 'false',
    SEMANTIC_RERANKER_ENABLED: 'false',
    MEMORY_V1_ENABLED: 'false',
    NATURAL_ANSWER_V2_ENABLED: 'false',
    SEMANTIC_VERIFIER_ENABLED: 'false'
  };
  const fullFlags = getReleaseFlags(fullEnvironment);
  const legacy = legacyArtifactAudit();
  const cases = {
    chunkV2ToLegacyArtifacts: legacy.passed,
    remoteEmbeddingToBm25: remoteOff.strategy === 'bm25' &&
      remoteOff.stats.fallback === 'remote_embedding_feature_flag',
    semanticRerankerToRrf: rerankerOff.strategy === 'hybrid_rrf',
    memoryV1DisabledWithoutDeletion: Boolean(beforeDisable && afterDisable),
    naturalAnswerToDeterministic: !answerOff.groundedSynthesisEnabled,
    semanticVerifierDisabled: !answerOff.semanticVerificationEnabled,
    fullRollbackAllFlagsOff: Object.values(fullFlags).every(value => !value)
  };
  return {
    single: cases,
    full: {
      flags: fullFlags,
      command: [
        'RAG_CHUNK_V2_ENABLED=false',
        'REMOTE_EMBEDDING_ENABLED=false',
        'SEMANTIC_RERANKER_ENABLED=false',
        'MEMORY_V1_ENABLED=false',
        'NATURAL_ANSWER_V2_ENABLED=false',
        'SEMANTIC_VERIFIER_ENABLED=false'
      ].join(' '),
      memoryRecordRetained: Boolean(afterDisable)
    },
    legacy,
    passed: Object.values(cases).every(Boolean)
  };
}

function regressionEvidence() {
  const phase7 = readJson(path.join(__dirname, 'reports', 'phase7.json'));
  const phase8 = readJson(path.join(__dirname, 'reports', 'phase8.json'));
  const phase9 = readJson(path.join(__dirname, 'reports', 'phase9.json'));
  const phase10 = readJson(path.join(__dirname, 'reports', 'phase10.json'));
  return {
    embeddingFailurePaths: Boolean(
      phase7.fallbackAudit && phase7.fallbackAudit.passed
    ),
    redisNormalConflictDegradationAndClear: Boolean(
      phase8.implementation && phase8.implementation.passed
    ),
    browserMemoryEndToEnd: Boolean(
      phase9.acceptance && phase9.acceptance.releaseReady
    ),
    groundedAnswerProduction: Boolean(
      phase10.production && phase10.production.passed
    )
  };
}

async function buildPhase11Report(corpus) {
  const activeCorpus = corpus || loadCorpus();
  const ingestion = ingestionAudit(activeCorpus);
  const onlineMetrics = onlineMetricsAudit();
  const privacy = privacyAudit();
  const rollback = await rollbackAudit();
  const regressions = regressionEvidence();
  const production = productionAuditEvidence();
  const featureFlags = getReleaseFlags({
    RAG_CHUNK_V2_ENABLED: 'true',
    REMOTE_EMBEDDING_ENABLED: 'true',
    SEMANTIC_RERANKER_ENABLED: 'true',
    MEMORY_V1_ENABLED: 'true',
    NATURAL_ANSWER_V2_ENABLED: 'true',
    SEMANTIC_VERIFIER_ENABLED: 'true'
  });
  const policy = onlineMetrics.policy;
  const checks = {
    ingestionReportComplete: Boolean(
      ingestion.tokenCount && ingestion.vectors && ingestion.chunkIdChurn &&
      ingestion.articleLists && ingestion.findings.sourceBuildMatchesDeployment
    ),
    criticalIngestionIntegrity: ingestion.findings.criticalIntegrityErrors === 0,
    vectorCoverage: ingestion.vectors.coverage === 1 &&
      ingestion.vectors.failed === 0,
    onlineMetricContractComplete: onlineMetrics.retrievalCandidates.length === 5 &&
      onlineMetrics.latency.length === 4 &&
      onlineMetrics.embedding.fields.length === 5 &&
      onlineMetrics.redis.length === 5 &&
      onlineMetrics.answers.length === 6,
    privacyLogging: privacy.passed,
    featureFlagsComplete: Object.values(featureFlags).every(Boolean),
    providerControlsDocumented: Boolean(
      policy.redisProviderAudit &&
      policy.redisProviderAudit.externalEvidenceOwner &&
      Object.keys(policy.alerts || {}).length >= 9
    ),
    secretRotationContract: Boolean(
      policy.secretRotation &&
      policy.secretRotation.previousCompatibilityWindow.length === 2
    ),
    rollbackRehearsal: rollback.passed,
    regressionEvidence: Object.values(regressions).every(Boolean),
    phase10ProductionBaseline: Boolean(
      onlineMetrics.productionBaseline &&
      onlineMetrics.productionBaseline.passed
    )
  };
  const implementationPassed = Object.values(checks).every(Boolean);
  const releaseReady = implementationPassed && production.passed;

  return {
    phase: 11,
    generatedAt: new Date().toISOString(),
    strategy: 'release-governance-observability-rollback-v1',
    corpusVersion: activeCorpus.manifest.corpusVersion,
    ingestion,
    onlineMetrics,
    privacy,
    featureFlags,
    rollback,
    regressions,
    production,
    knownFindings: ingestion.anomalies.formulaAbnormalSplit.length
      ? [{
        code: 'FORMULA_COMMENT_BOUNDARY',
        severity: 'low',
        chunkIds: ingestion.anomalies.formulaAbnormalSplit,
        action: 'declared in ingestion report; citations remain source-backed'
      }]
      : [],
    acceptance: {
      checks,
      implementationPassed,
      productionValidationRequired: !production.passed,
      releaseReady,
      status: releaseReady ? 'passed' : 'local_passed_production_pending',
      passed: implementationPassed
    }
  };
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
    ? path.resolve(process.argv[outputIndex + 1])
    : DEFAULT_OUTPUT_PATH;
  const report = await buildPhase11Report(loadCorpus());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 11: profiles=${Object.keys(report.ingestion.profiles).length} ` +
    `chunks=${report.ingestion.chunkIdChurn.deployment.candidate} ` +
    `churn=${report.ingestion.chunkIdChurn.deployment.chunkIdChurnRatio} ` +
    `rollback=${report.rollback.passed ? 'PASS' : 'FAIL'} ` +
    `acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`
  );
  console.log(`Report written to ${outputPath}`);
  if (!report.acceptance.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPhase11Report,
  formulaLooksSplit,
  idDiff,
  ingestionAudit,
  legacyArtifactAudit,
  onlineMetricsAudit,
  productionAuditEvidence,
  privacyAudit,
  rollbackAudit,
  tableHasHeader
};
