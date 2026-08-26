'use strict';

const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATASET_PATH = path.join(
  __dirname,
  'phase10-production-dataset.json'
);
const DEFAULT_OUTPUT_PATH = path.join(
  __dirname,
  'reports',
  'phase10-production.json'
);
const DEFAULT_ENDPOINT = 'https://blog-ai-api.vercel.app/api/ask';
const DEFAULT_SESSION_ID = 'phase10_gray_10';
const ALLOWED_CATEGORIES = new Set(['answerable', 'refusal', 'near_match']);
const ALLOWED_EXPECTATIONS = new Set(['answer', 'refuse']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function datasetHash(dataset) {
  return createHash('sha256')
    .update(JSON.stringify(dataset), 'utf8')
    .digest('hex');
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function validateDataset(dataset) {
  if (!dataset || dataset.strategy !== 'grounded-answer-v2-production-gray') {
    throw new Error('Invalid Phase 10 production dataset strategy');
  }
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Phase 10 production dataset requires cases');
  }
  if (!dataset.targets || typeof dataset.targets !== 'object') {
    throw new Error('Phase 10 production dataset requires targets');
  }
  const ids = new Set();
  const categories = new Set();
  for (const testCase of dataset.cases) {
    const id = String(testCase && testCase.id || '').trim();
    const question = String(testCase && testCase.question || '').trim();
    if (!id || ids.has(id)) throw new Error(`Invalid or duplicate case id: ${id}`);
    if (!question || question.length > 500) {
      throw new Error(`Invalid question for case: ${id}`);
    }
    if (!ALLOWED_CATEGORIES.has(testCase.category)) {
      throw new Error(`Invalid category for case: ${id}`);
    }
    if (!ALLOWED_EXPECTATIONS.has(testCase.expected)) {
      throw new Error(`Invalid expectation for case: ${id}`);
    }
    if (testCase.category === 'answerable' && testCase.expected !== 'answer') {
      throw new Error(`Answerable case must expect answer: ${id}`);
    }
    if (testCase.category !== 'answerable' && testCase.expected !== 'refuse') {
      throw new Error(`Safety case must expect refusal: ${id}`);
    }
    if (testCase.expected === 'answer' && (
      !Array.isArray(testCase.expectedTitles) || !testCase.expectedTitles.length
    )) {
      throw new Error(`Answer case requires expectedTitles: ${id}`);
    }
    ids.add(id);
    categories.add(testCase.category);
  }
  for (const category of ALLOWED_CATEGORIES) {
    if (!categories.has(category)) {
      throw new Error(`Dataset is missing category: ${category}`);
    }
  }
  return dataset;
}

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
  return {
    execute: flags.has('--execute'),
    help: flags.has('--help'),
    datasetPath: path.resolve(values.get('--dataset') || DEFAULT_DATASET_PATH),
    outputPath: path.resolve(values.get('--output') || DEFAULT_OUTPUT_PATH),
    endpoint: values.get('--endpoint') || DEFAULT_ENDPOINT,
    proxy: values.get('--proxy') || '',
    resumePath: values.get('--resume')
      ? path.resolve(values.get('--resume'))
      : '',
    sessionId: values.get('--session-id') || DEFAULT_SESSION_ID,
    repetitions: boundedInteger(
      values.get('--repetitions'),
      1,
      1,
      20,
      'repetitions'
    ),
    maxRequests: boundedInteger(
      values.get('--max-requests'),
      1000,
      1,
      1000,
      'maxRequests'
    ),
    timeoutMs: boundedInteger(
      values.get('--timeout-ms'),
      35000,
      1000,
      60000,
      'timeoutMs'
    ),
    transportRetries: boundedInteger(
      values.get('--transport-retries'),
      2,
      0,
      3,
      'transportRetries'
    )
  };
}

function validateRuntimeOptions(options) {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== 'https:') {
    throw new Error('Production endpoint must use HTTPS');
  }
  if (options.proxy) {
    const proxy = new URL(options.proxy);
    if (!['http:', 'https:'].includes(proxy.protocol)) {
      throw new Error('Proxy must use HTTP or HTTPS');
    }
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.sessionId)) {
    throw new Error('sessionId must be a bounded safe identifier');
  }
}

async function postWithCurl(endpoint, payload, options) {
  const marker = '__PHASE10_HTTP_STATUS__:';
  const args = [
    '--silent',
    '--show-error',
    '--connect-timeout',
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
    '--max-time',
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
    '--request',
    'POST',
    endpoint,
    '--header',
    'Content-Type: application/json',
    '--data-binary',
    JSON.stringify(payload),
    '--write-out',
    `\n${marker}%{http_code}`
  ];
  if (options.proxy) args.unshift('--proxy', options.proxy);
  const { stdout } = await execFileAsync('curl', args, {
    timeout: options.timeoutMs + 5000,
    maxBuffer: 2 * 1024 * 1024
  });
  const markerIndex = stdout.lastIndexOf(`\n${marker}`);
  if (markerIndex < 0) throw new Error('curl response is missing HTTP status');
  const bodyText = stdout.slice(0, markerIndex);
  const status = Number(stdout.slice(markerIndex + marker.length + 1));
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    throw new Error('Production response is not valid JSON');
  }
  return { status, body };
}

async function postWithFetch(endpoint, payload, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(endpoint, payload, options) {
  return options.proxy
    ? postWithCurl(endpoint, payload, options)
    : postWithFetch(endpoint, payload, options);
}

function safeRate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function percentile(values, ratio) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits || 4)) : null;
}

function responseRecord(testCase, iteration, response, elapsedMs) {
  const body = response && response.body && typeof response.body === 'object'
    ? response.body
    : {};
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const model = meta.model && typeof meta.model === 'object' ? meta.model : {};
  const phase10 = meta.phase10 && typeof meta.phase10 === 'object'
    ? meta.phase10
    : {};
  const verification = meta.citationVerification &&
    typeof meta.citationVerification === 'object'
    ? meta.citationVerification
    : {};
  const timings = meta.timings && typeof meta.timings === 'object'
    ? meta.timings
    : {};
  const claims = Array.isArray(body.claims) ? body.claims : [];
  const citations = Array.isArray(body.citations) ? body.citations : [];
  const citationTitles = [...new Set(citations
    .map(item => String(item && item.title || '').trim())
    .filter(Boolean))];
  const accepted = model.accepted === true;
  const published = accepted && claims.length > 0 && citations.length > 0;
  const expectedTitles = new Set(testCase.expectedTitles || []);
  const titleValid = testCase.expected === 'answer'
    ? citationTitles.length > 0 && citationTitles.every(title => expectedTitles.has(title))
    : citationTitles.length === 0;
  const passed = testCase.expected === 'answer'
    ? published && titleValid
    : !accepted && claims.length === 0 && citations.length === 0;

  return {
    id: testCase.id,
    category: testCase.category,
    expected: testCase.expected,
    iteration,
    status: Number(response && response.status || 0),
    selected: phase10.rolloutSelected === true,
    evidenceStatus: String(meta.evidenceStatus || ''),
    generationAttempted: model.generationAttempted === true,
    generationSchemaValid: model.generationSchemaValid === true,
    verificationAttempted: model.verificationAttempted === true,
    verificationSchemaValid: model.verificationSchemaValid === true,
    accepted,
    rejectionReason: String(model.rejectionReason || ''),
    verificationSource: String(verification.source || ''),
    claims: claims.length,
    citations: citations.length,
    citationTitles,
    titleValid,
    passed,
    serverTotalMs: Number.isFinite(Number(timings.totalMs))
      ? Number(timings.totalMs)
      : null,
    clientElapsedMs: round(elapsedMs, 3),
    traceId: String(meta.traceId || '')
  };
}

function errorRecord(testCase, iteration, error, elapsedMs) {
  return {
    id: testCase.id,
    category: testCase.category,
    expected: testCase.expected,
    iteration,
    status: 0,
    selected: false,
    evidenceStatus: '',
    generationAttempted: false,
    generationSchemaValid: false,
    verificationAttempted: false,
    verificationSchemaValid: false,
    accepted: false,
    rejectionReason: '',
    verificationSource: '',
    claims: 0,
    citations: 0,
    citationTitles: [],
    titleValid: false,
    passed: false,
    serverTotalMs: null,
    clientElapsedMs: round(elapsedMs, 3),
    traceId: '',
    errorCode: String(error && error.code || error && error.name || 'request_failed')
  };
}

function summarize(dataset, results) {
  const httpSuccess = results.filter(item => item.status >= 200 && item.status < 300);
  const selected = results.filter(item => item.selected);
  const generation = results.filter(item => item.generationAttempted);
  const verification = results.filter(item => item.verificationAttempted);
  const dualModel = results.filter(item => (
    item.generationAttempted && item.verificationAttempted
  ));
  const answerable = results.filter(item => item.expected === 'answer');
  const safety = results.filter(item => item.expected === 'refuse');
  const unsafe = safety.filter(item => (
    item.accepted || item.claims > 0 || item.citations > 0
  ));
  const acceptedWithoutCitation = results.filter(item => (
    item.accepted && (item.claims === 0 || item.citations === 0)
  ));
  const answerablePublished = answerable.filter(item => item.passed);
  const categorySummary = {};
  for (const category of ALLOWED_CATEGORIES) {
    const rows = results.filter(item => item.category === category);
    categorySummary[category] = {
      requests: rows.length,
      passed: rows.filter(item => item.passed).length,
      passRate: round(safeRate(rows.filter(item => item.passed).length, rows.length))
    };
  }
  const metrics = {
    requests: results.length,
    httpSuccessRate: round(safeRate(httpSuccess.length, results.length)),
    rolloutSelectionRate: round(safeRate(selected.length, results.length)),
    generationAttempts: generation.length,
    generationSchemaSuccessRate: round(safeRate(
      generation.filter(item => item.generationSchemaValid).length,
      generation.length
    )),
    verificationAttempts: verification.length,
    verificationSchemaSuccessRate: round(safeRate(
      verification.filter(item => item.verificationSchemaValid).length,
      verification.length
    )),
    unsafeAnswers: unsafe.length,
    unsafeAnswerRate: round(safeRate(unsafe.length, safety.length)),
    acceptedWithoutCitation: acceptedWithoutCitation.length,
    acceptedWithoutCitationRate: round(safeRate(
      acceptedWithoutCitation.length,
      results.length
    )),
    answerablePublished: answerablePublished.length,
    answerableCoverage: round(safeRate(
      answerablePublished.length,
      answerable.length
    )),
    serverLatencyMs: {
      p50: round(percentile(results.map(item => item.serverTotalMs), 0.5), 3),
      p95: round(percentile(results.map(item => item.serverTotalMs), 0.95), 3)
    },
    dualModelLatencyMs: {
      requests: dualModel.length,
      p50: round(percentile(dualModel.map(item => item.serverTotalMs), 0.5), 3),
      p95: round(percentile(dualModel.map(item => item.serverTotalMs), 0.95), 3)
    },
    categories: categorySummary
  };
  const targets = dataset.targets;
  const checks = {
    httpSuccessRate: metrics.httpSuccessRate >= targets.httpSuccessRate,
    rolloutSelectionRate: metrics.rolloutSelectionRate >= targets.rolloutSelectionRate,
    generationSchemaSuccessRate: metrics.generationSchemaSuccessRate !== null &&
      metrics.generationSchemaSuccessRate >= targets.generationSchemaSuccessRate,
    verificationSchemaSuccessRate: metrics.verificationSchemaSuccessRate !== null &&
      metrics.verificationSchemaSuccessRate >= targets.verificationSchemaSuccessRate,
    unsafeAnswerRate: metrics.unsafeAnswerRate <= targets.unsafeAnswerRate,
    acceptedWithoutCitationRate: metrics.acceptedWithoutCitationRate <=
      targets.acceptedWithoutCitationRate,
    answerableCoverage: metrics.answerableCoverage >= targets.answerableCoverage,
    dualModelP95Ms: metrics.dualModelLatencyMs.p95 !== null &&
      metrics.dualModelLatencyMs.p95 <= targets.dualModelP95Ms
  };
  const uniqueCases = new Set(results.map(item => item.id)).size;
  const formalSampleReady = results.length >= Number(dataset.formalSampleMin) &&
    uniqueCases === dataset.cases.length;
  return {
    metrics,
    targets,
    checks,
    formalSampleReady,
    passed: formalSampleReady && Object.values(checks).every(Boolean)
  };
}

function executionPlan(dataset, options) {
  const queue = [];
  for (let iteration = 1; iteration <= options.repetitions; iteration += 1) {
    for (const testCase of dataset.cases) {
      if (queue.length >= options.maxRequests) return queue;
      queue.push({ testCase, iteration });
    }
  }
  return queue;
}

function resultKey(value) {
  return `${String(value && value.id || '')}::${Number(value && value.iteration || 0)}`;
}

function resumableExecution(dataset, options, previousReport) {
  const fullQueue = executionPlan(dataset, options);
  if (!previousReport) return { fullQueue, queue: fullQueue, retained: [] };
  if (
    !previousReport.dataset ||
    previousReport.dataset.hash !== datasetHash(dataset) ||
    Number(previousReport.dataset.repetitions) !== options.repetitions ||
    !Array.isArray(previousReport.results)
  ) {
    throw new Error('Resume report does not match the dataset or repetitions');
  }
  const plannedKeys = new Set(fullQueue.map(item => resultKey({
    id: item.testCase.id,
    iteration: item.iteration
  })));
  const previousByKey = new Map();
  for (const result of previousReport.results) {
    const key = resultKey(result);
    if (!plannedKeys.has(key) || previousByKey.has(key)) {
      throw new Error('Resume report contains unknown or duplicate results');
    }
    previousByKey.set(key, result);
  }
  const queue = fullQueue.filter(item => {
    const previous = previousByKey.get(resultKey({
      id: item.testCase.id,
      iteration: item.iteration
    }));
    return !previous || Number(previous.status) === 0;
  });
  const retained = [...previousByKey.values()].filter(result => (
    Number(result.status) !== 0
  ));
  return { fullQueue, queue, retained };
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function runProductionEvaluation(
  dataset,
  options,
  transport,
  previousReport
) {
  const execution = resumableExecution(dataset, options, previousReport);
  const { fullQueue, queue } = execution;
  const request = transport || postJson;
  const results = execution.retained.slice();
  for (const [index, item] of queue.entries()) {
    const startedAt = Date.now();
    let record;
    let response;
    let requestError;
    let transportAttempts = 0;
    while (transportAttempts <= options.transportRetries) {
      transportAttempts += 1;
      try {
        response = await request(options.endpoint, {
          question: item.testCase.question,
          sessionId: options.sessionId
        }, options);
        requestError = null;
        break;
      } catch (error) {
        requestError = error;
        if (transportAttempts > options.transportRetries) break;
        await wait(250 * transportAttempts);
      }
    }
    if (response) {
      record = responseRecord(
        item.testCase,
        item.iteration,
        response,
        Date.now() - startedAt
      );
    } else {
      record = errorRecord(
        item.testCase,
        item.iteration,
        requestError,
        Date.now() - startedAt
      );
    }
    record.transportAttempts = transportAttempts;
    results.push(record);
    console.log(
      `[${index + 1}/${queue.length}] ${record.id} ` +
      `status=${record.status} accepted=${record.accepted} ` +
      `citations=${record.citations} passed=${record.passed} ` +
      `serverMs=${record.serverTotalMs === null ? '-' : record.serverTotalMs}`
    );
  }
  const order = new Map(fullQueue.map((item, index) => [resultKey({
    id: item.testCase.id,
    iteration: item.iteration
  }), index]));
  results.sort((left, right) => (
    order.get(resultKey(left)) - order.get(resultKey(right))
  ));
  const acceptance = summarize(dataset, results);
  acceptance.metrics.transportRetriedRequests = results.filter(item => (
    Number(item.transportAttempts || 1) > 1
  )).length;
  return {
    phase: 10,
    kind: 'production-gray-evaluation',
    generatedAt: new Date().toISOString(),
    endpointHost: new URL(options.endpoint).host,
    dataset: {
      version: dataset.version,
      hash: datasetHash(dataset),
      cases: dataset.cases.length,
      repetitions: options.repetitions,
      executedRequests: results.length
    },
    acceptance,
    results
  };
}

function printUsage() {
  console.log(
    'Usage: node evals/phase10-production-run.js [--execute] ' +
    '[--repetitions 5] [--max-requests 100] [--proxy http://127.0.0.1:7890] ' +
    '[--transport-retries 2] [--resume report.json] ' +
    '[--endpoint https://.../api/ask] [--output path]'
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  validateRuntimeOptions(options);
  const dataset = validateDataset(readJson(options.datasetPath));
  const previousReport = options.resumePath ? readJson(options.resumePath) : null;
  const queue = resumableExecution(dataset, options, previousReport).queue;
  if (!options.execute) {
    console.log(
      `Phase 10 production evaluation preview: ${dataset.cases.length} cases, ` +
      `${options.repetitions} repetitions, ${queue.length} planned requests` +
      `${previousReport ? ' after resume' : ''}.`
    );
    console.log('Add --execute to send real production requests.');
    return;
  }
  const report = await runProductionEvaluation(
    dataset,
    options,
    null,
    previousReport
  );
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(
    options.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  console.log(
    `Phase 10 production: formalReady=${report.acceptance.formalSampleReady} ` +
    `passed=${report.acceptance.passed} ` +
    `dualModelP95=${report.acceptance.metrics.dualModelLatencyMs.p95}ms`
  );
  console.log(`Report written to ${options.outputPath}`);
  if (report.acceptance.formalSampleReady && !report.acceptance.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  datasetHash,
  executionPlan,
  parseArgs,
  percentile,
  responseRecord,
  resumableExecution,
  runProductionEvaluation,
  summarize,
  validateDataset,
  validateRuntimeOptions
};
