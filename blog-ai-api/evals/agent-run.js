'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  AGENT_LIMITS
} = require('../agent/config');
const {
  runAgent
} = require('../agent/run');
const {
  loadCorpus
} = require('../lib/corpus');
const {
  normalizePostUrl,
  normalizeText,
  rankChunks
} = require('../lib/retrieval-core');
const {
  normalizeAskRequest
} = require('../memory/session');

const DEFAULT_DATASET_PATH = path.join(__dirname, 'agent-dataset.json');
const STRATEGY = 'bm25_agent_workflow';
const ACCEPTANCE_TARGETS = Object.freeze({
  routeAccuracy: 0.9,
  rewriteAccuracy: 0.9,
  toolSelectionAccuracy: 0.9,
  articleCoverage: 0.9,
  referenceResolutionAccuracy: 0.9,
  comparisonCoverage: 0.9,
  safeStopAccuracy: 1,
  limitCompliance: 1,
  legacyCompatibility: 1
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round(value, digits) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits === undefined ? 4 : digits));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index];
}

function parseArgs(argv) {
  const options = {
    datasetPath: DEFAULT_DATASET_PATH,
    outputPath: ''
  };

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

function buildCorpusIndexes(corpus) {
  const postsByTitle = new Map();
  const chunksByTitle = new Map();

  for (const post of corpus.posts) {
    postsByTitle.set(post.title, post);
  }
  for (const chunk of corpus.chunks) {
    if (!chunksByTitle.has(chunk.postTitle)) {
      chunksByTitle.set(chunk.postTitle, []);
    }
    chunksByTitle.get(chunk.postTitle).push(chunk);
  }

  return {
    postsByTitle,
    chunksByTitle
  };
}

function validateDataset(dataset, corpus) {
  if (!dataset || dataset.strategy !== STRATEGY) {
    throw new Error(`Agent dataset strategy must be ${STRATEGY}`);
  }
  if (dataset.stage2Implemented !== false) {
    throw new Error('Phase 3 dataset must explicitly record stage2Implemented=false');
  }
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Agent dataset must contain cases');
  }

  const { postsByTitle, chunksByTitle } = buildCorpusIndexes(corpus);
  const ids = new Set();

  for (const testCase of dataset.cases) {
    if (!testCase.id || ids.has(testCase.id)) {
      throw new Error(`Missing or duplicate Agent case id: ${testCase.id || '<empty>'}`);
    }
    ids.add(testCase.id);
    if (!testCase.category || !testCase.expected || !testCase.expected.route) {
      throw new Error(`Agent case ${testCase.id} is missing category or expected route`);
    }
    if (!testCase.question && !Array.isArray(testCase.messages)) {
      throw new Error(`Agent case ${testCase.id} needs question or messages`);
    }
    if (testCase.pageTitle && !postsByTitle.has(testCase.pageTitle)) {
      throw new Error(`Unknown pageTitle in ${testCase.id}: ${testCase.pageTitle}`);
    }

    const labelledTitles = []
      .concat(testCase.expected.relevantPostTitles || [])
      .concat(
        (testCase.messages || []).flatMap(message => (
          message.citationTitles || []
        ))
      );
    for (const title of labelledTitles) {
      if (!postsByTitle.has(title)) {
        throw new Error(`Unknown article title in ${testCase.id}: ${title}`);
      }
      if (!chunksByTitle.has(title)) {
        throw new Error(`Article has no indexable chunks in ${testCase.id}: ${title}`);
      }
    }
  }

  return true;
}

function materializeMessage(message, indexes, indexVersion) {
  const normalized = {
    role: message.role,
    content: message.content
  };

  if (message.role !== 'assistant') return normalized;
  if (message.standaloneQuery) {
    normalized.standaloneQuery = message.standaloneQuery;
  }
  normalized.indexVersion = indexVersion;
  normalized.citations = (message.citationTitles || []).map(title => {
    const chunk = indexes.chunksByTitle.get(title)[0];
    return {
      chunkId: chunk.id,
      title: chunk.postTitle,
      url: normalizePostUrl(chunk.postUrl),
      section: chunk.sectionTitle || ''
    };
  });
  return normalized;
}

function materializeRequest(testCase, corpus) {
  const indexes = buildCorpusIndexes(corpus);
  const indexVersion = corpus.manifest && corpus.manifest.corpusVersion || '';
  const body = {
    sessionId: `eval_${testCase.id.replace(/[^A-Za-z0-9_-]/g, '_')}`
  };

  if (testCase.question) body.question = testCase.question;
  if (Array.isArray(testCase.messages)) {
    body.messages = testCase.messages.map(message => (
      materializeMessage(message, indexes, indexVersion)
    ));
  }
  if (testCase.pageTitle) {
    const post = indexes.postsByTitle.get(testCase.pageTitle);
    body.page = {
      title: post.title,
      url: post.url,
      description: post.description || ''
    };
  }

  return normalizeAskRequest(body);
}

function sameStringSet(actual, expected) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function includesRequiredTerms(value, terms) {
  const normalizedValue = normalizeText(value);
  return (terms || []).every(term => (
    normalizedValue.includes(normalizeText(term))
  ));
}

function evaluateLimits(meta) {
  const budget = meta.budget;
  return (
    meta.retrievalAttempts <= AGENT_LIMITS.maxRetrievalAttempts &&
    meta.subqueries.length <= AGENT_LIMITS.maxSubqueries &&
    meta.toolCalls.length <= AGENT_LIMITS.maxToolCalls &&
    meta.retrieval.selectedChunks <= AGENT_LIMITS.maxContextChunks &&
    budget.used.retrievalAttempts <= budget.limits.maxRetrievalAttempts &&
    budget.used.toolCalls <= budget.limits.maxToolCalls &&
    budget.used.contextChunks <= budget.limits.maxContextChunks &&
    budget.used.contextChars <= budget.limits.maxContextChars &&
    budget.used.estimatedContextTokens <= budget.limits.maxContextTokens &&
    budget.used.modelCalls <= budget.limits.maxModelCalls
  );
}

async function evaluateCase(testCase, corpus) {
  const input = materializeRequest(testCase, corpus);
  const startedAt = process.hrtime.bigint();
  const payload = await runAgent(input, {
    corpus,
    indexVersion: corpus.manifest && corpus.manifest.corpusVersion,
    canUseModel: () => false
  });
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const expected = testCase.expected;
  const actualToolNames = [...new Set(
    payload.meta.toolCalls.map(call => call.name)
  )];
  const actualArticleTitles = [...new Set(
    payload.citations
      .map(citation => citation.title)
      .concat(payload.related.map(item => item.title))
  )];
  const relevantTitles = expected.relevantPostTitles || [];
  const coveredTitles = relevantTitles.filter(title => (
    actualArticleTitles.includes(title)
  ));
  const rejected = payload.meta.evidenceStatus === 'insufficient' &&
    payload.citations.length === 0;
  const checks = {
    route: payload.meta.route === expected.route,
    rewrite: includesRequiredTerms(
      payload.meta.standaloneQuery,
      expected.requiredQueryTerms
    ),
    tools: sameStringSet(actualToolNames, expected.toolNames || []),
    retrievalAttempts: payload.meta.retrievalAttempts ===
      expected.retrievalAttempts,
    rejection: expected.shouldReject ? rejected : !rejected,
    stopReason: !expected.stopReason ||
      payload.meta.stopReason === expected.stopReason,
    limits: evaluateLimits(payload.meta)
  };
  const articleCoverage = relevantTitles.length
    ? coveredTitles.length / relevantTitles.length
    : null;

  return {
    id: testCase.id,
    category: testCase.category,
    question: input.question,
    expectedRoute: expected.route,
    route: payload.meta.route,
    standaloneQuery: payload.meta.standaloneQuery,
    subqueries: payload.meta.subqueries,
    expectedTools: expected.toolNames || [],
    toolNames: actualToolNames,
    retrievalAttempts: payload.meta.retrievalAttempts,
    evidenceStatus: payload.meta.evidenceStatus,
    evidenceReason: payload.meta.evidenceReason,
    stopReason: payload.meta.stopReason,
    relevantPostTitles: relevantTitles,
    coveredPostTitles: coveredTitles,
    articleCoverage: articleCoverage === null
      ? null
      : round(articleCoverage),
    rejected,
    durationMs: round(durationMs, 3),
    checks,
    passed: Object.values(checks).every(Boolean) &&
      (articleCoverage === null || articleCoverage === 1)
  };
}

function metric(results, selector) {
  const selected = results.filter(selector.filter || (() => true));
  return selected.length
    ? round(mean(selected.map(selector.value)))
    : 0;
}

function buildAcceptance(summary) {
  const result = {};
  let passed = true;

  for (const [name, target] of Object.entries(ACCEPTANCE_TARGETS)) {
    const actual = summary[name];
    const metricPassed = actual >= target;
    result[name] = { target, actual, passed: metricPassed };
    if (!metricPassed) passed = false;
  }

  return { passed, metrics: result };
}

async function buildAgentReport(dataset, corpus) {
  validateDataset(dataset, corpus);

  // Warm the cached BM25 index before measuring orchestration latency.
  rankChunks(corpus.chunks, '__agent_eval_warmup__', 'site', null);
  const results = [];
  for (const testCase of dataset.cases) {
    results.push(await evaluateCase(testCase, corpus));
  }

  const positiveCoverage = results.filter(result => (
    result.articleCoverage !== null
  ));
  const multiTurn = results.filter(result => result.category === 'multi_turn');
  const comparisons = results.filter(result => result.category === 'comparison');
  const safeStops = results.filter(result => (
    ['insufficient', 'clarification'].includes(result.category)
  ));
  const legacy = results.filter(result => result.category === 'legacy');
  const latencies = results.map(result => result.durationMs);
  const summary = {
    cases: results.length,
    passedCases: results.filter(result => result.passed).length,
    routeAccuracy: metric(results, {
      value: result => result.checks.route ? 1 : 0
    }),
    rewriteAccuracy: metric(results, {
      value: result => result.checks.rewrite ? 1 : 0
    }),
    toolSelectionAccuracy: metric(results, {
      value: result => result.checks.tools ? 1 : 0
    }),
    articleCoverage: positiveCoverage.length
      ? round(mean(positiveCoverage.map(result => result.articleCoverage)))
      : 0,
    referenceResolutionAccuracy: multiTurn.length
      ? round(mean(multiTurn.map(result => (
        result.checks.rewrite &&
        result.articleCoverage === 1
          ? 1
          : 0
      ))))
      : 0,
    comparisonCoverage: comparisons.length
      ? round(mean(comparisons.map(result => result.articleCoverage || 0)))
      : 0,
    safeStopAccuracy: safeStops.length
      ? round(mean(safeStops.map(result => (
        result.rejected &&
        result.checks.retrievalAttempts &&
        result.checks.stopReason
          ? 1
          : 0
      ))))
      : 0,
    limitCompliance: metric(results, {
      value: result => result.checks.limits ? 1 : 0
    }),
    legacyCompatibility: legacy.length
      ? round(mean(legacy.map(result => result.passed ? 1 : 0)))
      : 0,
    averageRetrievalAttempts: round(mean(
      results.map(result => result.retrievalAttempts)
    )),
    maxRetrievalAttempts: Math.max(
      ...results.map(result => result.retrievalAttempts)
    ),
    warmLatencyMs: {
      p50: round(percentile(latencies, 0.5), 3),
      p95: round(percentile(latencies, 0.95), 3),
      max: round(Math.max(...latencies), 3)
    }
  };
  const failedCases = results
    .filter(result => !result.passed)
    .map(result => ({
      id: result.id,
      checks: result.checks,
      route: result.route,
      standaloneQuery: result.standaloneQuery,
      relevantPostTitles: result.relevantPostTitles,
      coveredPostTitles: result.coveredPostTitles
    }));

  return {
    generatedAt: new Date().toISOString(),
    phase: 3,
    strategy: STRATEGY,
    stage2Implemented: false,
    notes: [
      'Phase 2 hybrid retrieval is not implemented; all Agent tools use the verified BM25 corpus.',
      'The evaluation is fully offline and disables external model generation.',
      'Latency is reported for warm local orchestration and is not a production network benchmark.'
    ],
    dataset: {
      version: dataset.version,
      cases: dataset.cases.length,
      path: path.relative(
        path.join(__dirname, '..'),
        DEFAULT_DATASET_PATH
      )
    },
    corpus: {
      posts: corpus.posts.length,
      chunks: corpus.chunks.length,
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion || null
    },
    limits: Object.assign({}, AGENT_LIMITS),
    summary,
    acceptance: buildAcceptance(summary),
    failedCases,
    cases: results
  };
}

function printReport(report) {
  const summary = report.summary;
  console.log(
    `Agent phase 3 (${report.strategy}): ` +
    `${summary.passedCases}/${summary.cases} cases passed`
  );
  console.log(
    `route=${summary.routeAccuracy} rewrite=${summary.rewriteAccuracy} ` +
    `tools=${summary.toolSelectionAccuracy} coverage=${summary.articleCoverage}`
  );
  console.log(
    `references=${summary.referenceResolutionAccuracy} ` +
    `comparison=${summary.comparisonCoverage} safeStop=${summary.safeStopAccuracy} ` +
    `limits=${summary.limitCompliance}`
  );
  console.log(
    `attempts(avg/max)=${summary.averageRetrievalAttempts}/` +
    `${summary.maxRetrievalAttempts} warmP95=${summary.warmLatencyMs.p95}ms`
  );
  console.log(`acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`);

  for (const failure of report.failedCases) {
    console.log(`- ${failure.id}: ${JSON.stringify(failure.checks)}`);
  }
}

function printHelp() {
  console.log(
    'Usage: node evals/agent-run.js ' +
    '[--dataset evals/agent-dataset.json] [--output path]'
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dataset = readJson(options.datasetPath);
  const report = await buildAgentReport(dataset, loadCorpus());
  printReport(report);

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(
      options.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    );
    console.log(`Report written to ${options.outputPath}`);
  }
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
  buildAgentReport,
  evaluateCase,
  materializeRequest,
  parseArgs,
  validateDataset
};
