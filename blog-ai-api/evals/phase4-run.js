'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  EVIDENCE_CALIBRATION
} = require('../agent/config');
const {
  runAgent
} = require('../agent/run');
const {
  isExtractiveClaim,
  quoteComparable
} = require('../agent/nodes/verify-citations');
const {
  loadCorpus
} = require('../lib/corpus');
const {
  normalizePostUrl
} = require('../lib/retrieval-core');
const {
  normalizeAskRequest
} = require('../memory/session');
const {
  createOfflineEvaluationCorpus
} = require('./offline-corpus');

const DEFAULT_DATASET_PATH = path.join(__dirname, 'phase4-dataset.json');
const STRATEGY = 'grounded_agent_quality_phase4';
const ACCEPTANCE_TARGETS = Object.freeze({
  citationCompleteness: 1,
  citationSupport: 1,
  citationProvenance: 1,
  extractiveClaims: 1,
  unsupportedClaimRate: 0,
  rejectionRecall: 1,
  rejectionPrecision: 1,
  answerAcceptance: 1,
  routeAccuracy: 1
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round(value, digits) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits === undefined ? 4 : digits));
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 1;
}

function datasetHash(dataset) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(dataset), 'utf8')
    .digest('hex');
}

function postIndexes(corpus) {
  return new Map((corpus.posts || []).map(post => [post.title, post]));
}

function validateDataset(dataset, corpus) {
  if (!dataset || dataset.strategy !== STRATEGY) {
    throw new Error(`Phase 4 dataset strategy must be ${STRATEGY}`);
  }
  if (!Array.isArray(dataset.thresholdGrid) || !dataset.thresholdGrid.length) {
    throw new Error('Phase 4 dataset needs a thresholdGrid');
  }
  const thresholds = dataset.thresholdGrid.map(Number);
  if (thresholds.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('Phase 4 thresholdGrid values must be in [0, 1]');
  }
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Phase 4 dataset needs cases');
  }

  const titles = postIndexes(corpus);
  const ids = new Set();
  const splits = new Set();
  for (const testCase of dataset.cases) {
    if (!testCase.id || ids.has(testCase.id)) {
      throw new Error(`Missing or duplicate Phase 4 case id: ${testCase.id || '<empty>'}`);
    }
    ids.add(testCase.id);
    if (!['calibration', 'holdout'].includes(testCase.split)) {
      throw new Error(`Invalid split in ${testCase.id}`);
    }
    splits.add(testCase.split);
    if (!testCase.question || !testCase.expected) {
      throw new Error(`Phase 4 case ${testCase.id} is missing question or expected`);
    }
    if (!['answer', 'reject'].includes(testCase.expected.answerability)) {
      throw new Error(`Invalid answerability in ${testCase.id}`);
    }
    if (testCase.pageTitle && !titles.has(testCase.pageTitle)) {
      throw new Error(`Unknown pageTitle in ${testCase.id}: ${testCase.pageTitle}`);
    }
    for (const title of testCase.expected.citationTitles || []) {
      if (!titles.has(title)) {
        throw new Error(`Unknown citation title in ${testCase.id}: ${title}`);
      }
    }
  }
  if (!splits.has('calibration') || !splits.has('holdout')) {
    throw new Error('Phase 4 dataset needs both calibration and holdout cases');
  }
  return true;
}

function materializeRequest(testCase, corpus) {
  const posts = postIndexes(corpus);
  const body = {
    sessionId: `phase4_${testCase.id.replace(/[^A-Za-z0-9_-]/g, '_')}`,
    question: testCase.question
  };
  if (testCase.pageTitle) {
    const post = posts.get(testCase.pageTitle);
    body.page = {
      title: post.title,
      url: post.url,
      description: post.description || ''
    };
  }
  return normalizeAskRequest(body);
}

function claimChecks(payload, corpus) {
  const chunksById = new Map((corpus.chunks || []).map(chunk => [chunk.id, chunk]));
  const citationsById = new Map((payload.citations || []).map(citation => [
    citation.chunkId,
    citation
  ]));
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  const complete = claims.length > 0 && claims.every(claim => (
    Array.isArray(claim.citationIds) &&
    claim.citationIds.length === 1 &&
    citationsById.has(claim.citationIds[0])
  ));
  const supported = complete && claims.every(claim => {
    const chunk = chunksById.get(claim.citationIds[0]);
    return chunk && quoteComparable(chunk.content).includes(
      quoteComparable(claim.quote)
    );
  });
  const provenance = complete && claims.every(claim => {
    const chunk = chunksById.get(claim.citationIds[0]);
    const citation = citationsById.get(claim.citationIds[0]);
    return chunk && citation &&
      citation.title === chunk.postTitle &&
      citation.url === normalizePostUrl(chunk.postUrl);
  });
  const source = payload.meta && payload.meta.citationVerification &&
    payload.meta.citationVerification.source || 'deterministic';
  const extractive = complete && claims.every(claim => {
    const chunk = chunksById.get(claim.citationIds[0]);
    return chunk && isExtractiveClaim(claim, { chunk }, source);
  });

  return {
    claims,
    complete,
    supported,
    provenance,
    extractive,
    unsupportedClaims: claims.filter(claim => {
      const chunk = chunksById.get(claim.citationIds && claim.citationIds[0]);
      return !chunk || !quoteComparable(chunk.content).includes(
        quoteComparable(claim.quote)
      );
    }).length
  };
}

async function evaluateCase(testCase, corpus, calibration) {
  const input = materializeRequest(testCase, corpus);
  const payload = await runAgent(input, {
    corpus,
    indexVersion: corpus.manifest && corpus.manifest.corpusVersion,
    evidenceCalibration: calibration,
    canUseModel: () => false
  });
  const claims = claimChecks(payload, corpus);
  const verification = payload.meta.citationVerification || {};
  const rejected = payload.citations.length === 0 &&
    payload.claims.length === 0 &&
    verification.status !== 'verified';
  const accepted = !rejected &&
    verification.status === 'verified' &&
    claims.complete &&
    claims.supported &&
    claims.provenance &&
    claims.extractive;
  const expectedTitles = testCase.expected.citationTitles || [];
  const citedTitles = [...new Set((payload.citations || []).map(citation => citation.title))];
  const titleCoverage = expectedTitles.every(title => citedTitles.includes(title));
  const expectedAnswer = testCase.expected.answerability === 'answer';
  const checks = {
    route: !testCase.expected.route || payload.meta.route === testCase.expected.route,
    outcome: expectedAnswer ? accepted : rejected,
    citationCompleteness: expectedAnswer ? claims.complete : true,
    citationSupport: expectedAnswer ? claims.supported : true,
    citationProvenance: expectedAnswer ? claims.provenance : true,
    extractiveClaims: expectedAnswer ? claims.extractive : true,
    titleCoverage: expectedAnswer ? titleCoverage : true,
    verification: expectedAnswer
      ? verification.status === 'verified'
      : verification.status !== 'verified'
  };

  return {
    id: testCase.id,
    split: testCase.split,
    category: testCase.category,
    question: testCase.question,
    expected: testCase.expected,
    route: payload.meta.route,
    evidenceStatus: payload.meta.evidenceStatus,
    evidenceReason: payload.meta.evidenceReason,
    evidenceScore: payload.meta.evidenceCalibration.score,
    evidenceThreshold: payload.meta.evidenceCalibration.threshold,
    rejected,
    accepted,
    citedTitles,
    claims: claims.claims.length,
    unsupportedClaims: claims.unsupportedClaims,
    verification,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

function summarize(results) {
  const answerCases = results.filter(result => (
    result.expected.answerability === 'answer'
  ));
  const rejectCases = results.filter(result => (
    result.expected.answerability === 'reject'
  ));
  const actualRejected = results.filter(result => result.rejected);
  const allClaims = results.reduce((total, result) => total + result.claims, 0);
  const unsupportedClaims = results.reduce(
    (total, result) => total + result.unsupportedClaims,
    0
  );

  return {
    cases: results.length,
    passedCases: results.filter(result => result.passed).length,
    routeAccuracy: round(ratio(
      results.filter(result => result.checks.route).length,
      results.length
    )),
    citationCompleteness: round(ratio(
      answerCases.filter(result => result.checks.citationCompleteness).length,
      answerCases.length
    )),
    citationSupport: round(ratio(
      answerCases.filter(result => result.checks.citationSupport).length,
      answerCases.length
    )),
    citationProvenance: round(ratio(
      answerCases.filter(result => result.checks.citationProvenance).length,
      answerCases.length
    )),
    extractiveClaims: round(ratio(
      answerCases.filter(result => result.checks.extractiveClaims).length,
      answerCases.length
    )),
    unsupportedClaimRate: round(ratio(unsupportedClaims, allClaims)),
    rejectionRecall: round(ratio(
      rejectCases.filter(result => result.rejected).length,
      rejectCases.length
    )),
    rejectionPrecision: round(ratio(
      actualRejected.filter(result => (
        result.expected.answerability === 'reject'
      )).length,
      actualRejected.length
    )),
    answerAcceptance: round(ratio(
      answerCases.filter(result => result.accepted).length,
      answerCases.length
    ))
  };
}

function meetsTargets(summary) {
  return Object.entries(ACCEPTANCE_TARGETS).every(([name, target]) => (
    target === 0 ? summary[name] <= target : summary[name] >= target
  ));
}

async function calibrate(dataset, corpus) {
  const cases = dataset.cases.filter(testCase => (
    testCase.split === 'calibration'
  ));
  const candidates = [];

  for (const threshold of dataset.thresholdGrid.map(Number).sort((a, b) => a - b)) {
    const calibration = Object.assign({}, EVIDENCE_CALIBRATION, {
      version: `phase4-grid-${threshold}`,
      siteQaMinCoverage: threshold,
      compoundMinCoverage: threshold
    });
    const results = [];
    for (const testCase of cases) {
      results.push(await evaluateCase(testCase, corpus, calibration));
    }
    const summary = summarize(results);
    candidates.push({
      threshold,
      summary,
      eligible: summary.rejectionRecall === 1 &&
        summary.rejectionPrecision >= 0.95 &&
        summary.answerAcceptance === 1 &&
        summary.citationCompleteness === 1 &&
        summary.citationSupport === 1 &&
        summary.extractiveClaims === 1
    });
  }

  const selected = candidates.filter(candidate => candidate.eligible)
    .sort((left, right) => right.threshold - left.threshold)[0] || null;
  return { candidates, selected };
}

async function buildPhase4Report(dataset, corpus) {
  validateDataset(dataset, corpus);
  const evaluationCorpus = createOfflineEvaluationCorpus(corpus);
  const calibration = await calibrate(dataset, evaluationCorpus);
  const allResults = [];
  for (const testCase of dataset.cases) {
    allResults.push(await evaluateCase(
      testCase,
      evaluationCorpus,
      EVIDENCE_CALIBRATION
    ));
  }
  const calibrationResults = allResults.filter(result => result.split === 'calibration');
  const holdoutResults = allResults.filter(result => result.split === 'holdout');
  const configMatchesSelection = Boolean(calibration.selected) &&
    calibration.selected.threshold === EVIDENCE_CALIBRATION.siteQaMinCoverage &&
    calibration.selected.threshold === EVIDENCE_CALIBRATION.compoundMinCoverage;
  const acceptance = {
    targets: ACCEPTANCE_TARGETS,
    calibrationSelected: calibration.selected
      ? calibration.selected.threshold
      : null,
    configMatchesSelection,
    calibration: summarize(calibrationResults),
    holdout: summarize(holdoutResults),
    passed: configMatchesSelection && meetsTargets(summarize(holdoutResults))
  };

  return {
    generatedAt: new Date().toISOString(),
    phase: 4,
    strategy: STRATEGY,
    notes: [
      'The calibration grid is evaluated only on the calibration split; holdout is not used to select thresholds.',
      'Coverage thresholds are evidence gates, not probabilistic confidence scores.',
      'Retrieval uses a deterministic local proxy index so CI never calls the managed embedding API.',
      'External model generation is disabled. Claims are checked against the exact serving corpus and extractive claim contract before metrics are computed.'
    ],
    dataset: {
      version: dataset.version,
      hash: datasetHash(dataset),
      cases: dataset.cases.length,
      calibrationCases: calibrationResults.length,
      holdoutCases: holdoutResults.length
    },
    corpus: {
      posts: corpus.posts.length,
      chunks: corpus.chunks.length,
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion || null
    },
    calibration: {
      configured: EVIDENCE_CALIBRATION,
      candidates: calibration.candidates,
      selected: calibration.selected && calibration.selected.threshold || null
    },
    acceptance,
    cases: allResults,
    failedCases: allResults.filter(result => !result.passed).map(result => ({
      id: result.id,
      checks: result.checks,
      route: result.route,
      evidenceStatus: result.evidenceStatus,
      evidenceReason: result.evidenceReason,
      citedTitles: result.citedTitles
    }))
  };
}

function parseArgs(argv) {
  const options = { datasetPath: DEFAULT_DATASET_PATH, outputPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dataset' && argv[index + 1]) {
      options.datasetPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--output' && argv[index + 1]) {
      options.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function printReport(report) {
  const summary = report.acceptance.holdout;
  console.log(
    `Agent phase 4 (${report.strategy}): ` +
    `${summary.passedCases}/${summary.cases} holdout cases passed`
  );
  console.log(
    `citations=${summary.citationCompleteness}/${summary.citationSupport}/` +
    `${summary.citationProvenance}/extractive=${summary.extractiveClaims} ` +
    `unsupported=${summary.unsupportedClaimRate}`
  );
  console.log(
    `reject(recall/precision)=${summary.rejectionRecall}/` +
    `${summary.rejectionPrecision} answers=${summary.answerAcceptance} ` +
    `selected=${report.calibration.selected}`
  );
  console.log(`acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`);
  for (const failure of report.failedCases) {
    console.log(`- ${failure.id}: ${JSON.stringify(failure.checks)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node evals/phase4-run.js [--dataset path] [--output path]');
    return;
  }
  const report = await buildPhase4Report(readJson(options.datasetPath), loadCorpus());
  printReport(report);
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Report written to ${options.outputPath}`);
  }
  if (!report.acceptance.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  ACCEPTANCE_TARGETS,
  STRATEGY,
  buildPhase4Report,
  calibrate,
  evaluateCase,
  materializeRequest,
  parseArgs,
  summarize,
  validateDataset
};
