'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { AGENT_LIMITS } = require('../agent/config');
const {
  verifyGroundedV2Response
} = require('../agent/nodes/verify-citations');
const {
  extractGroundedV2Answer,
  extractVerification
} = require('../lib/generate');
const {
  sanitizeMemoryDelta
} = require('../memory/trusted-update');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase10.json');
const DEFAULT_PRODUCTION_REPORT_PATH = path.join(
  __dirname,
  'reports',
  'phase10-production.json'
);
const ROOT = path.resolve(__dirname, '..');
const BLOG_ROOT = path.resolve(ROOT, '..');
const TARGETS = Object.freeze({
  unsupportedClaimPublishedRate: 0,
  citationSourceValidity: 1,
  duplicateClaimRate: 0,
  requiredSubquestionCoverage: 0.9,
  generationSchemaSuccessRate: 0.99,
  verificationSchemaSuccessRate: 0.99,
  modelStageBudgetMs: 12000
});

const EVIDENCE = Object.freeze({
  id: 'tower#0',
  postTitle: '双塔模型',
  postUrl: 'https://wangsenjie.github.io/double-tower/',
  sectionTitle: '模型结构',
  content: '双塔模型由用户塔和物品塔组成，分别编码用户与物品，最后计算两个向量的相似度。'
});

function candidate() {
  return {
    chunk: Object.assign({}, EVIDENCE),
    rank: 1,
    score: 10,
    matchedQueries: ['双塔模型的结构是什么'],
    ranking: { vectorScore: 0 }
  };
}

function verdict(values) {
  return Object.assign({
    claims: [{
      id: 'draft_claim_1',
      supported: true,
      directlyAnswers: true,
      reasonCode: 'supported'
    }],
    subquestions: [{ id: 'sq_1', covered: true }],
    memoryDelta: {
      activeTopic: '双塔模型',
      explicitLearningProgress: [],
      responsePreferences: [],
      summaryUpdate: ''
    }
  }, values || {});
}

function response(values) {
  return Object.assign({
    draftAnswer: '未验证草稿',
    claims: [{
      id: 'draft_claim_1',
      subquestionId: 'sq_1',
      text: '双塔模型分别编码用户和物品，再比较两侧向量。',
      citationIds: ['tower#0'],
      quote: EVIDENCE.content
    }]
  }, values || {});
}

function implementationAudit() {
  const sources = {
    run: fs.readFileSync(path.join(ROOT, 'agent', 'run.js'), 'utf8'),
    generate: fs.readFileSync(path.join(ROOT, 'lib', 'generate.js'), 'utf8'),
    verify: fs.readFileSync(
      path.join(ROOT, 'agent', 'nodes', 'verify-citations.js'),
      'utf8'
    ),
    memory: fs.readFileSync(path.join(ROOT, 'memory', 'trusted-update.js'), 'utf8'),
    browser: fs.readFileSync(
      path.join(BLOG_ROOT, 'source', 'js', 'blog-ai-agent.js'),
      'utf8'
    )
  };
  const checks = {
    separateGenerationAndVerification: sources.run.includes('generateV2') &&
      sources.run.includes('dependencies.verify') &&
      sources.run.includes('semanticVerificationMs'),
    stableSubquestionContract: sources.run.includes('buildSubquestionPlan') &&
      sources.generate.includes('subquestionId'),
    naturalClaimProtocol: sources.generate.includes('text 可以自然改写') &&
      sources.verify.includes('verifyGroundedV2Response'),
    serverFinalRebuild: sources.verify.includes('formatGroundedAnswer') &&
      !sources.verify.includes('draftAnswer:'),
    duplicateAndQuoteGuards: sources.verify.includes('seenText') &&
      sources.verify.includes('quote_not_in_cited_chunk'),
    explicitMemoryOnly: sources.memory.includes('explicit_user_statement') &&
      sources.memory.includes('PERSISTENT_PREFERENCE_PATTERN'),
    browserRendersAnswer: sources.browser.includes("const answer = String(result.answer || '').trim()") &&
      !sources.browser.slice(
        sources.browser.indexOf('function renderAnswerBody(result)'),
        sources.browser.indexOf('function safeCodeAnchor')
      ).includes('result.claims')
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

function qualityEvaluation() {
  const subquestions = [{
    id: 'sq_1',
    question: '双塔模型的结构是什么？',
    required: true
  }];
  const accepted = verifyGroundedV2Response(
    response(),
    verdict(),
    [candidate()],
    subquestions
  );
  const unsupported = verifyGroundedV2Response(
    response({
      claims: [Object.assign({}, response().claims[0], {
        text: '双塔模型能解决所有推荐问题。'
      })]
    }),
    verdict({
      claims: [{
        id: 'draft_claim_1',
        supported: false,
        directlyAnswers: false,
        reasonCode: 'scope_expansion'
      }],
      subquestions: [{ id: 'sq_1', covered: false }]
    }),
    [candidate()],
    subquestions
  );
  const duplicate = verifyGroundedV2Response(
    response({ claims: response().claims.concat([
      Object.assign({}, response().claims[0], { id: 'draft_claim_2' })
    ]) }),
    verdict({
      claims: ['draft_claim_1', 'draft_claim_2'].map(id => ({
        id,
        supported: true,
        directlyAnswers: true,
        reasonCode: 'supported'
      }))
    }),
    [candidate()],
    subquestions
  );
  const publishedClaims = accepted.claims
    .concat(unsupported.claims)
    .concat(duplicate.claims);
  const duplicatePublished = [accepted, unsupported, duplicate]
    .reduce((total, result) => (
      total + result.claims.length - new Set(
        result.claims.map(claim => claim.text)
      ).size
    ), 0);
  const citationIds = new Set([EVIDENCE.id]);
  const validCitations = publishedClaims.filter(claim => (
    claim.citationIds.length === 1 && citationIds.has(claim.citationIds[0])
  )).length;
  const answerableRequired = 1;
  const coveredRequired = accepted.unansweredSubquestions.length ? 0 : 1;

  const generationFixtures = [
    JSON.stringify(response()),
    JSON.stringify({ claims: [], unansweredSubquestions: ['sq_1'] })
  ];
  const verificationFixtures = [
    JSON.stringify(verdict()),
    JSON.stringify(verdict({ claims: [], subquestions: [{ id: 'sq_1', covered: false }] }))
  ];
  const generationSchemaSuccessRate = generationFixtures.filter(value => (
    extractGroundedV2Answer(value)
  )).length / generationFixtures.length;
  const verificationSchemaSuccessRate = verificationFixtures.filter(value => (
    extractVerification(value)
  )).length / verificationFixtures.length;
  const unsupportedClaimPublishedRate = unsupported.claims.length;
  const citationSourceValidity = publishedClaims.length
    ? validCitations / publishedClaims.length
    : 1;
  const duplicateClaimRate = publishedClaims.length
    ? duplicatePublished / publishedClaims.length
    : 0;
  const requiredSubquestionCoverage = coveredRequired / answerableRequired;
  const modelStageBudgetMs = AGENT_LIMITS.generationTimeoutMs +
    AGENT_LIMITS.verificationTimeoutMs;
  const metrics = {
    unsupportedClaimPublishedRate,
    citationSourceValidity,
    duplicateClaimRate,
    requiredSubquestionCoverage,
    generationSchemaSuccessRate,
    verificationSchemaSuccessRate,
    modelStageBudgetMs
  };
  const passed = unsupportedClaimPublishedRate === TARGETS.unsupportedClaimPublishedRate &&
    citationSourceValidity === TARGETS.citationSourceValidity &&
    duplicateClaimRate === TARGETS.duplicateClaimRate &&
    requiredSubquestionCoverage >= TARGETS.requiredSubquestionCoverage &&
    generationSchemaSuccessRate >= TARGETS.generationSchemaSuccessRate &&
    verificationSchemaSuccessRate >= TARGETS.verificationSchemaSuccessRate &&
    modelStageBudgetMs <= TARGETS.modelStageBudgetMs &&
    !unsupported.answer.includes('解决所有推荐问题') &&
    duplicate.claims.length === 1;
  return {
    metrics,
    targets: TARGETS,
    cases: {
      naturalParaphrasePublished: accepted.claims.length === 1 &&
        accepted.answer.includes('分别编码用户和物品'),
      unsupportedClaimFiltered: unsupported.claims.length === 0,
      requiredGapReported: unsupported.unansweredSubquestions.length === 1,
      duplicateFiltered: duplicate.claims.length === 1,
      draftAnswerIgnored: !accepted.answer.includes('未验证草稿')
    },
    passed
  };
}

function memoryEvaluation() {
  const citations = [{
    chunkId: EVIDENCE.id,
    title: EVIDENCE.postTitle,
    url: EVIDENCE.postUrl,
    section: EVIDENCE.sectionTitle
  }];
  const explicit = sanitizeMemoryDelta({
    activeTopic: '双塔模型',
    summaryUpdate: '模型自由摘要',
    explicitLearningProgress: [{
      articleUrl: EVIDENCE.postUrl,
      status: 'completed'
    }],
    responsePreferences: [{ kind: 'example_language', value: 'python' }]
  }, {
    question: '我已经看完双塔模型，以后优先用 Python 示例。',
    citations
  });
  const inferred = sanitizeMemoryDelta({
    explicitLearningProgress: [{
      articleUrl: EVIDENCE.postUrl,
      status: 'completed'
    }],
    responsePreferences: [{ kind: 'example_language', value: 'python' }]
  }, {
    question: '双塔模型是什么？',
    citations
  });
  const checks = {
    explicitProgressAccepted: explicit.explicitLearningProgress.length === 1,
    explicitPreferenceAccepted: explicit.responsePreferences.length === 1,
    serverOwnedSummary: explicit.summaryUpdate === '用户正在了解双塔模型。',
    inferredProgressRejected: inferred === null ||
      inferred.explicitLearningProgress.length === 0,
    inferredPreferenceRejected: inferred === null ||
      inferred.responsePreferences.length === 0
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

function productionEvaluation(reportPath) {
  const resolvedPath = reportPath || DEFAULT_PRODUCTION_REPORT_PATH;
  if (!fs.existsSync(resolvedPath)) {
    return {
      available: false,
      formalSampleReady: false,
      passed: false
    };
  }
  const report = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (
    report.phase !== 10 ||
    report.kind !== 'production-gray-evaluation' ||
    !report.dataset ||
    !report.acceptance
  ) {
    throw new Error('Invalid Phase 10 production report');
  }
  return {
    available: true,
    generatedAt: report.generatedAt,
    endpointHost: report.endpointHost,
    dataset: Object.assign({}, report.dataset),
    metrics: Object.assign({}, report.acceptance.metrics),
    targets: Object.assign({}, report.acceptance.targets),
    checks: Object.assign({}, report.acceptance.checks),
    formalSampleReady: report.acceptance.formalSampleReady === true,
    passed: report.acceptance.passed === true
  };
}

function buildPhase10Report(options) {
  const settings = options || {};
  const implementation = implementationAudit();
  const quality = qualityEvaluation();
  const memory = memoryEvaluation();
  const production = productionEvaluation(settings.productionReportPath);
  const localReleaseReady = implementation.passed && quality.passed && memory.passed;
  const releaseReady = localReleaseReady && production.passed;
  return {
    phase: 10,
    generatedAt: new Date().toISOString(),
    strategy: 'grounded-answer-v2-with-trusted-memory-update',
    implementation,
    quality,
    memory,
    production,
    acceptance: {
      localReleaseReady,
      productionValidationRequired: !production.passed,
      releaseReady,
      status: releaseReady
        ? 'passed'
        : localReleaseReady
          ? 'local_passed'
          : 'failed'
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
  const report = buildPhase10Report();
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 10: implementation=${report.implementation.passed ? 'PASS' : 'FAIL'} ` +
    `quality=${report.quality.passed ? 'PASS' : 'FAIL'} ` +
    `memory=${report.memory.passed ? 'PASS' : 'FAIL'} ` +
    `status=${report.acceptance.status}`
  );
  console.log(`Report written to ${options.outputPath}`);
  if (
    !report.acceptance.localReleaseReady ||
    report.production.available && !report.production.passed
  ) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildPhase10Report,
  implementationAudit,
  memoryEvaluation,
  productionEvaluation,
  qualityEvaluation
};
