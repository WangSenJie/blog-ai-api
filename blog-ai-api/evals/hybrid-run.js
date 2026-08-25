'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const { loadCorpus } = require('../lib/corpus');
const { hybridRankChunks } = require('../lib/hybrid-retrieve');
const {
  buildReport,
  parseArgs
} = require('./run');
const {
  createOfflineEvaluationCorpus
} = require('./offline-corpus');

const DEFAULT_DATASET_PATH = path.join(__dirname, 'hybrid-dataset.json');
const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'hybrid-phase2.json');
const DEFAULT_CORPUS_PATH = path.join(__dirname, '..', 'data', 'chunks.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function categoryMetrics(report, category) {
  return Object.assign({
    recallAt5: 0,
    recallAt20: 0,
    hitRateAt5: 0,
    mrrAt20: 0,
    ndcgAt20: 0
  }, report.byCategory[category] || {});
}

function atLeast(left, right, key) {
  return Number(left[key] || 0) + 1e-9 >= Number(right[key] || 0);
}

function buildPhase2Report(dataset, corpus, metadata) {
  const settings = metadata || {};
  const evaluationCorpus = createOfflineEvaluationCorpus(corpus);
  const baseMetadata = {
    datasetPath: settings.datasetPath,
    corpusHash: settings.corpusHash
  };
  const baseline = buildReport(dataset, evaluationCorpus, Object.assign({}, baseMetadata, {
    retriever: {
      name: 'bm25-custom',
      strategy: 'bm25'
    }
  }));
  const hybrid = buildReport(dataset, evaluationCorpus, Object.assign({}, baseMetadata, {
    ranker(question, mode, page) {
      return hybridRankChunks(
        evaluationCorpus.chunks,
        evaluationCorpus.vectors,
        question,
        mode,
        page
      ).ranked;
    },
    retriever: {
      name: 'hybrid-local-semantic-hash',
      strategy: 'bm25_vector_rrf_reranker',
      fusion: 'reciprocal-rank-fusion',
      reranker: 'local-semantic-and-lexical-reranker'
    }
  }));
  const baselineSemantic = categoryMetrics(baseline, 'semantic');
  const hybridSemantic = categoryMetrics(hybrid, 'semantic');
  const baselineExact = categoryMetrics(baseline, 'exact');
  const hybridExact = categoryMetrics(hybrid, 'exact');
  const semanticImproved = hybridSemantic.recallAt5 > baselineSemantic.recallAt5 ||
    hybridSemantic.mrrAt20 > baselineSemantic.mrrAt20;
  const exactNoRegression = atLeast(hybridExact, baselineExact, 'recallAt5') &&
    atLeast(hybridExact, baselineExact, 'mrrAt20');

  return {
    phase: 2,
    generatedAt: new Date().toISOString(),
    strategy: 'bm25_vector_rrf_reranker',
    acceptance: {
      semanticImproved,
      exactNoRegression,
      passed: semanticImproved && exactNoRegression
    },
    comparison: {
      semantic: { baseline: baselineSemantic, hybrid: hybridSemantic },
      exact: { baseline: baselineExact, hybrid: hybridExact }
    },
    baseline,
    hybrid
  };
}

function printReport(report) {
  const semantic = report.comparison.semantic;
  const exact = report.comparison.exact;
  console.log(
    `Hybrid phase 2: semantic Recall@5 ${semantic.baseline.recallAt5} -> ` +
    `${semantic.hybrid.recallAt5}, MRR@20 ${semantic.baseline.mrrAt20} -> ` +
    `${semantic.hybrid.mrrAt20}`
  );
  console.log(
    `Exact: Recall@5 ${exact.baseline.recallAt5} -> ${exact.hybrid.recallAt5}, ` +
    `MRR@20 ${exact.baseline.mrrAt20} -> ${exact.hybrid.mrrAt20}`
  );
  console.log(`Acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`);
}

function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node evals/hybrid-run.js [--dataset path] [--output path]');
    return;
  }
  if (!argv.includes('--dataset')) options.datasetPath = DEFAULT_DATASET_PATH;
  if (!argv.includes('--output')) options.outputPath = DEFAULT_OUTPUT_PATH;

  const report = buildPhase2Report(readJson(options.datasetPath), loadCorpus(), {
    datasetPath: options.datasetPath,
    corpusHash: hashFile(DEFAULT_CORPUS_PATH)
  });
  printReport(report);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Report written to ${options.outputPath}`);
  if (!report.acceptance.passed) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPhase2Report,
  categoryMetrics
};
