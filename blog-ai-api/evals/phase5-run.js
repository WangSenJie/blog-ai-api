'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const {
  AGENT_LIMITS
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

const DEFAULT_DATASET_PATH = path.join(__dirname, 'phase5-dataset.json');
const STRATEGY = 'structured_agentic_rag_phase5';
const ACCEPTANCE_TARGETS = Object.freeze({
  casePassRate: 1,
  specialistRouting: 1,
  strictCitationSupport: 1,
  comparisonAlignment: 1,
  authorGraphConformance: 1,
  codeArtifactExactness: 1,
  safeRefusalRate: 1,
  noModelCalls: 1,
  limitCompliance: 1
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

function sameStringSet(actual, expected) {
  const left = [...new Set(actual || [])].sort();
  const right = [...new Set(expected || [])].sort();
  return left.length === right.length && left.every((value, index) => (
    value === right[index]
  ));
}

function sameStringArray(actual, expected) {
  const left = actual || [];
  const right = expected || [];
  return left.length === right.length && left.every((value, index) => (
    value === right[index]
  ));
}

function postsByTitle(corpus) {
  return new Map((corpus.posts || []).map(post => [post.title, post]));
}

function graphTrack(corpus, trackId) {
  return (corpus.learningGraph && corpus.learningGraph.tracks || [])
    .find(track => track && track.id === trackId) || null;
}

function expectedCodeBlock(testCase, corpus) {
  const code = testCase && testCase.expected && testCase.expected.code;
  if (!code) return null;
  const post = postsByTitle(corpus).get(testCase.pageTitle);
  if (!post) return null;
  const articleBlocks = (corpus.codeBlocks || []).filter(block => (
    normalizePostUrl(block && block.postUrl) === normalizePostUrl(post.url)
  ));
  if (code.selector === 'ordinal') {
    return articleBlocks.find(block => Number(block.ordinal) === Number(code.ordinal)) || null;
  }
  if (code.selector === 'block_id') {
    return articleBlocks.find(block => Number(block.ordinal) === Number(code.ordinal)) || null;
  }
  return null;
}

function validateDataset(dataset, corpus) {
  if (!dataset || dataset.strategy !== STRATEGY) {
    throw new Error(`Phase 5 dataset strategy must be ${STRATEGY}`);
  }
  if (!corpus || !corpus.manifest || corpus.manifest.schemaVersion < 3 ||
    !Array.isArray(corpus.codeBlocks) || !corpus.learningGraph) {
    throw new Error('Phase 5 evaluation requires a verified v3 corpus with code blocks and a learning graph');
  }
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Phase 5 dataset needs cases');
  }

  const knownPosts = postsByTitle(corpus);
  const ids = new Set();
  for (const testCase of dataset.cases) {
    if (!testCase || !testCase.id || ids.has(testCase.id)) {
      throw new Error(`Missing or duplicate Phase 5 case id: ${testCase && testCase.id || '<empty>'}`);
    }
    ids.add(testCase.id);
    if (!testCase.question || !testCase.category || !testCase.expected) {
      throw new Error(`Phase 5 case ${testCase.id} is missing question, category, or expected`);
    }
    const expected = testCase.expected;
    if (!['factual', 'navigation', 'reject'].includes(expected.answerability)) {
      throw new Error(`Invalid answerability in ${testCase.id}`);
    }
    if (!expected.route || !Array.isArray(expected.toolNames)) {
      throw new Error(`Phase 5 case ${testCase.id} needs route and toolNames`);
    }
    if (testCase.pageTitle && !knownPosts.has(testCase.pageTitle)) {
      throw new Error(`Unknown pageTitle in ${testCase.id}: ${testCase.pageTitle}`);
    }
    for (const title of expected.citationTitles || []) {
      if (!knownPosts.has(title)) {
        throw new Error(`Unknown citation title in ${testCase.id}: ${title}`);
      }
    }

    if (expected.answerability === 'factual' && !expected.citationTitles?.length) {
      throw new Error(`Factual Phase 5 case ${testCase.id} needs citationTitles`);
    }
    if (expected.comparison) {
      for (const title of expected.comparison.articleTitles || []) {
        if (!knownPosts.has(title)) {
          throw new Error(`Unknown comparison article in ${testCase.id}: ${title}`);
        }
      }
      if (!Array.isArray(expected.comparison.rowIds) || !expected.comparison.rowIds.length) {
        throw new Error(`Comparison case ${testCase.id} needs expected row IDs`);
      }
    }
    if (expected.learning) {
      const track = graphTrack(corpus, expected.learning.trackId);
      if (!track) {
        throw new Error(`Unknown learning track in ${testCase.id}: ${expected.learning.trackId}`);
      }
      const nodeIds = new Set((track.nodes || []).map(node => node.id));
      for (const nodeId of expected.learning.stepIds || []) {
        if (!nodeIds.has(nodeId)) {
          throw new Error(`Unknown learning node in ${testCase.id}: ${nodeId}`);
        }
      }
      if (!Array.isArray(expected.learning.relations) ||
        expected.learning.relations.length !== expected.learning.stepIds.length) {
        throw new Error(`Learning case ${testCase.id} needs one relation per expected step`);
      }
    }
    if (expected.code) {
      if (!testCase.pageTitle || !['ordinal', 'block_id'].includes(expected.code.selector)) {
        throw new Error(`Code case ${testCase.id} has an invalid selector`);
      }
      const block = expectedCodeBlock(testCase, corpus);
      if (!block) {
        throw new Error(`Code selector does not resolve in ${testCase.id}`);
      }
      if (expected.code.selector === 'block_id' && !testCase.question.includes('{{codeBlockId}}')) {
        throw new Error(`Block ID case ${testCase.id} must interpolate the current code block ID`);
      }
    }
  }
  return true;
}

function materializeRequest(testCase, corpus) {
  const posts = postsByTitle(corpus);
  const block = expectedCodeBlock(testCase, corpus);
  const question = String(testCase.question).replace(
    '{{codeBlockId}}',
    block ? block.id : ''
  );
  const body = {
    sessionId: `phase5_${testCase.id.replace(/[^A-Za-z0-9_-]/g, '_')}`,
    question
  };
  if (testCase.pageTitle) {
    const post = posts.get(testCase.pageTitle);
    body.page = {
      title: post.title,
      url: post.url,
      description: post.description || ''
    };
  }
  return {
    input: normalizeAskRequest(body),
    question,
    expectedBlock: block
  };
}

function factualCitationChecks(payload, corpus) {
  const chunksById = new Map((corpus.chunks || []).map(chunk => [chunk.id, chunk]));
  const citationsById = new Map((payload.citations || []).map(citation => [
    citation.chunkId,
    citation
  ]));
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  const verification = payload.meta && payload.meta.citationVerification || {};
  const source = verification.source || 'deterministic';
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
    const citation = citationsById.get(claim.citationIds[0]);
    const chunk = chunksById.get(claim.citationIds[0]);
    return citation && chunk &&
      citation.title === chunk.postTitle &&
      citation.url === normalizePostUrl(chunk.postUrl);
  });
  const extractive = complete && claims.every(claim => {
    const chunk = chunksById.get(claim.citationIds[0]);
    return chunk && isExtractiveClaim(claim, { chunk }, source);
  });
  return {
    complete,
    supported,
    provenance,
    extractive,
    verified: verification.status === 'verified',
    citationTitles: [...new Set((payload.citations || []).map(item => item.title))]
  };
}

function comparisonChecks(payload, expected, corpus) {
  const comparison = payload.comparison;
  if (!comparison || !Array.isArray(comparison.articles) || !Array.isArray(comparison.rows)) {
    return { structure: false, cellsCitable: false };
  }
  const articleTitles = comparison.articles.map(article => article.title);
  const rowIds = comparison.rows.map(row => row.id);
  const chunksById = new Map((corpus.chunks || []).map(chunk => [chunk.id, chunk]));
  const citationsById = new Map((payload.citations || []).map(citation => [
    citation.chunkId,
    citation
  ]));
  const structure = sameStringArray(articleTitles, expected.articleTitles) &&
    sameStringArray(rowIds, expected.rowIds) &&
    payload.meta && payload.meta.phase5 && payload.meta.phase5.comparison === true;
  const cellsCitable = structure && comparison.rows.every(row => (
    expected.articleTitles.every(title => {
      const cell = (row.cells || []).find(item => item.articleTitle === title);
      const chunk = cell && chunksById.get(cell.citationId);
      const citation = cell && citationsById.get(cell.citationId);
      return Boolean(
        cell && cell.available === true && cell.quote && cell.text &&
        chunk && citation && citation.title === title &&
        quoteComparable(chunk.content).includes(quoteComparable(cell.quote))
      );
    })
  ));
  return { structure, cellsCitable };
}

function navigationContract(payload) {
  const verification = payload.meta && payload.meta.citationVerification || {};
  return payload.citations.length === 0 &&
    payload.claims.length === 0 &&
    verification.status === 'not_required' &&
    verification.reason === 'learning_navigation_metadata';
}

function learningChecks(payload, expected, testCase, corpus) {
  const path = payload.learningPath;
  const track = graphTrack(corpus, expected.trackId);
  if (!path || !track || !Array.isArray(path.steps)) {
    return { structure: false, authorCurated: false, navigationOnly: false };
  }
  const steps = path.steps;
  const actualIds = steps.map(step => step.id);
  const actualRelations = steps.map(step => step.relation);
  const nodesById = new Map((track.nodes || []).map(node => [node.id, node]));
  const expectedReason = `作者维护的「${track.title}」阅读顺序`;
  const structure = path.trackId === expected.trackId &&
    path.trackTitle === track.title &&
    path.kind === expected.kind &&
    sameStringArray(actualIds, expected.stepIds) &&
    sameStringArray(actualRelations, expected.relations) &&
    payload.meta && payload.meta.phase5 && payload.meta.phase5.learningPath === true;
  const nodesMatch = structure && steps.every(step => {
    const node = nodesById.get(step.id);
    return node &&
      step.title === node.title &&
      step.url === normalizePostUrl(node.url) &&
      step.order === node.order &&
      step.level === node.level &&
      step.trackId === track.id &&
      step.trackTitle === track.title &&
      step.reason === expectedReason;
  });
  const graphEdges = corpus.learningGraph && corpus.learningGraph.edges || [];
  const consecutiveEdges = steps.slice(1).every((step, index) => (
    graphEdges.some(edge => (
      edge.trackId === track.id && edge.relation === 'next' &&
      edge.from === steps[index].id && edge.to === step.id
    ))
  ));
  const currentPost = testCase.pageTitle && postsByTitle(corpus).get(testCase.pageTitle);
  const currentNode = currentPost && (track.nodes || []).find(node => (
    normalizePostUrl(node.url) === normalizePostUrl(currentPost.url)
  ));
  const directNextEdge = path.kind !== 'next' || (
    currentNode && steps.length === 1 && graphEdges.some(edge => (
      edge.trackId === track.id && edge.relation === 'next' &&
      edge.from === currentNode.id && edge.to === steps[0].id
    ))
  );
  return {
    structure,
    authorCurated: Boolean(nodesMatch && consecutiveEdges && directNextEdge),
    navigationOnly: navigationContract(payload)
  };
}

function publicCodeBlock(block) {
  return {
    id: block.id,
    anchor: block.anchor,
    postTitle: block.postTitle,
    postUrl: normalizePostUrl(block.postUrl),
    sectionTitle: block.sectionTitle || '',
    headingPath: Array.isArray(block.headingPath) ? block.headingPath.slice() : [],
    ordinal: block.ordinal,
    language: block.language,
    code: block.code,
    sourceLineStart: block.sourceLineStart,
    sourceLineEnd: block.sourceLineEnd,
    contentHash: block.contentHash
  };
}

function codeChecks(payload, expectedBlock) {
  const explanation = payload.codeExplanation;
  const actualBlock = explanation && explanation.block;
  const expectedPublicBlock = expectedBlock && publicCodeBlock(expectedBlock);
  const contextIsLinked = Boolean(
    expectedBlock && explanation &&
    (expectedBlock.contextChunkIds || []).includes(explanation.contextChunkId)
  );
  const citedContext = Boolean(
    explanation && (payload.citations || []).some(citation => (
      citation.chunkId === explanation.contextChunkId
    ))
  );
  return {
    exact: Boolean(
      expectedPublicBlock && actualBlock &&
      isDeepStrictEqual(actualBlock, expectedPublicBlock) &&
      payload.meta && payload.meta.phase5 &&
      payload.meta.phase5.codeExplanation === true
    ),
    contextIsLinked,
    citedContext
  };
}

function safeRefusalChecks(payload, expected) {
  const verification = payload.meta && payload.meta.citationVerification || {};
  const phase5 = payload.meta && payload.meta.phase5 || {};
  const attempts = Number(payload.meta && payload.meta.retrievalAttempts) || 0;
  const noFacts = payload.citations.length === 0 && payload.claims.length === 0;
  const noArtifacts = !payload.comparison && !payload.learningPath && !payload.codeExplanation &&
    !phase5.comparison && !phase5.learningPath && !phase5.codeExplanation;
  return {
    refused: payload.meta && payload.meta.evidenceStatus === 'insufficient' &&
      noFacts && noArtifacts && verification.status === 'not_required' &&
      verification.reason === 'evidence_insufficient',
    expectedReason: !expected.evidenceReason || (
      payload.meta && payload.meta.evidenceReason === expected.evidenceReason
    ),
    specialistBounded: !expected.maxRetrievalAttempts || attempts <= expected.maxRetrievalAttempts
  };
}

function limitsComply(meta) {
  const budget = meta && meta.budget;
  if (!meta || !budget || !budget.used || !budget.limits || !meta.retrieval) return false;
  return meta.retrievalAttempts <= AGENT_LIMITS.maxRetrievalAttempts &&
    meta.subqueries.length <= AGENT_LIMITS.maxSubqueries &&
    meta.toolCalls.length <= AGENT_LIMITS.maxToolCalls &&
    meta.retrieval.selectedChunks <= AGENT_LIMITS.maxContextChunks &&
    budget.used.retrievalAttempts <= budget.limits.maxRetrievalAttempts &&
    budget.used.toolCalls <= budget.limits.maxToolCalls &&
    budget.used.contextChunks <= budget.limits.maxContextChunks &&
    budget.used.contextChars <= budget.limits.maxContextChars &&
    budget.used.estimatedContextTokens <= budget.limits.maxContextTokens &&
    budget.used.modelCalls <= budget.limits.maxModelCalls;
}

async function evaluateCase(testCase, corpus) {
  const materialized = materializeRequest(testCase, corpus);
  const payload = await runAgent(materialized.input, {
    corpus,
    indexVersion: corpus.manifest && corpus.manifest.corpusVersion,
    canUseModel: () => false
  });
  const expected = testCase.expected;
  const toolNames = [...new Set((payload.meta.toolCalls || []).map(call => call.name))];
  const citations = factualCitationChecks(payload, corpus);
  const comparison = expected.comparison
    ? comparisonChecks(payload, expected.comparison, corpus)
    : null;
  const learning = expected.learning
    ? learningChecks(payload, expected.learning, testCase, corpus)
    : null;
  const code = expected.code
    ? codeChecks(payload, materialized.expectedBlock)
    : null;
  const refusal = expected.answerability === 'reject'
    ? safeRefusalChecks(payload, expected)
    : null;
  const factual = expected.answerability === 'factual';
  const navigation = expected.answerability === 'navigation';
  const reject = expected.answerability === 'reject';
  const citationTitleCoverage = !factual || (expected.citationTitles || []).every(title => (
    citations.citationTitles.includes(title)
  ));
  const modelNotUsed = payload.meta && payload.meta.budget &&
    payload.meta.budget.used.modelCalls === 0 &&
    !(payload.meta.model && payload.meta.model.answered);
  const checks = {
    route: payload.meta.route === expected.route,
    tools: sameStringSet(toolNames, expected.toolNames),
    modelNotUsed,
    limits: limitsComply(payload.meta),
    factualCitations: !factual || (
      citations.verified && citations.complete && citations.supported &&
      citations.provenance && citations.extractive
    ),
    citationTitles: citationTitleCoverage,
    comparisonAlignment: !expected.comparison || (
      comparison.structure && comparison.cellsCitable
    ),
    authorGraph: !expected.learning || (
      learning.structure && learning.authorCurated && learning.navigationOnly
    ),
    codeArtifact: !expected.code || (
      code.exact && code.contextIsLinked && code.citedContext
    ),
    safeRefusal: !reject || (
      refusal.refused && refusal.expectedReason && refusal.specialistBounded
    ),
    navigationNoFacts: !navigation || navigationContract(payload)
  };

  return {
    id: testCase.id,
    category: testCase.category,
    question: materialized.question,
    expected: testCase.expected,
    route: payload.meta.route,
    toolNames,
    retrievalAttempts: payload.meta.retrievalAttempts,
    evidenceStatus: payload.meta.evidenceStatus,
    evidenceReason: payload.meta.evidenceReason,
    stopReason: payload.meta.stopReason,
    modelCalls: payload.meta.budget.used.modelCalls,
    citationVerification: payload.meta.citationVerification,
    citationTitles: citations.citationTitles,
    comparison: comparison && {
      structure: comparison.structure,
      cellsCitable: comparison.cellsCitable
    },
    learning: learning && {
      structure: learning.structure,
      authorCurated: learning.authorCurated,
      navigationOnly: learning.navigationOnly
    },
    code: code && {
      expectedBlockId: materialized.expectedBlock && materialized.expectedBlock.id,
      actualBlockId: payload.codeExplanation && payload.codeExplanation.block &&
        payload.codeExplanation.block.id,
      exact: code.exact,
      contextIsLinked: code.contextIsLinked,
      citedContext: code.citedContext
    },
    refusal,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

function metric(results, filter, getter) {
  const selected = results.filter(filter);
  return round(ratio(
    selected.filter(getter).length,
    selected.length
  ));
}

function summarize(results) {
  const factual = result => result.expected.answerability === 'factual';
  const navigation = result => result.expected.answerability === 'navigation';
  const code = result => result.expected.code;
  const refusal = result => result.expected.answerability === 'reject';
  const comparison = result => result.expected.comparison;
  return {
    cases: results.length,
    passedCases: results.filter(result => result.passed).length,
    casePassRate: round(ratio(
      results.filter(result => result.passed).length,
      results.length
    )),
    specialistRouting: metric(results, () => true, result => (
      result.checks.route && result.checks.tools
    )),
    strictCitationSupport: metric(results, factual, result => (
      result.checks.factualCitations && result.checks.citationTitles
    )),
    comparisonAlignment: metric(results, comparison, result => (
      result.checks.comparisonAlignment
    )),
    authorGraphConformance: metric(results, navigation, result => (
      result.checks.authorGraph && result.checks.navigationNoFacts
    )),
    codeArtifactExactness: metric(results, code, result => (
      result.checks.codeArtifact && result.checks.factualCitations
    )),
    safeRefusalRate: metric(results, refusal, result => result.checks.safeRefusal),
    noModelCalls: metric(results, () => true, result => result.checks.modelNotUsed),
    limitCompliance: metric(results, () => true, result => result.checks.limits)
  };
}

function buildAcceptance(summary) {
  const metrics = {};
  let passed = true;
  for (const [name, target] of Object.entries(ACCEPTANCE_TARGETS)) {
    const actual = summary[name];
    const metricPassed = actual >= target;
    metrics[name] = { target, actual, passed: metricPassed };
    if (!metricPassed) passed = false;
  }
  return { passed, metrics };
}

async function buildPhase5Report(dataset, corpus) {
  validateDataset(dataset, corpus);
  const evaluationCorpus = createOfflineEvaluationCorpus(corpus);
  const results = [];
  for (const testCase of dataset.cases) {
    results.push(await evaluateCase(testCase, evaluationCorpus));
  }
  const summary = summarize(results);
  return {
    generatedAt: new Date().toISOString(),
    phase: 5,
    strategy: STRATEGY,
    notes: [
      'The evaluation uses the exact v3 serving corpus, including code-block and author-curated learning-graph artifacts.',
      'Retrieval uses a deterministic local proxy index so CI never calls the managed embedding API.',
      'All external-model generation is disabled. Factual comparison and code outputs must pass extractive citation, provenance, and source-support checks.',
      'Learning paths are checked against explicit graph nodes and next edges; they intentionally carry no factual citations.',
      'Negative cases must return no claims, citations, or structured artifacts and must stop within one specialist retrieval attempt.'
    ],
    dataset: {
      version: dataset.version,
      hash: datasetHash(dataset),
      cases: dataset.cases.length,
      path: path.relative(path.join(__dirname, '..'), DEFAULT_DATASET_PATH)
    },
    corpus: {
      schemaVersion: corpus.manifest && corpus.manifest.schemaVersion || null,
      posts: corpus.posts.length,
      chunks: corpus.chunks.length,
      codeBlocks: corpus.codeBlocks.length,
      learningTracks: corpus.learningGraph.tracks.length,
      indexVersion: corpus.manifest && corpus.manifest.corpusVersion || null
    },
    summary,
    acceptance: buildAcceptance(summary),
    cases: results,
    failedCases: results.filter(result => !result.passed).map(result => ({
      id: result.id,
      route: result.route,
      toolNames: result.toolNames,
      evidenceStatus: result.evidenceStatus,
      evidenceReason: result.evidenceReason,
      checks: result.checks
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
  const summary = report.summary;
  console.log(
    `Agent phase 5 (${report.strategy}): ` +
    `${summary.passedCases}/${summary.cases} cases passed`
  );
  console.log(
    `routing=${summary.specialistRouting} citations=${summary.strictCitationSupport} ` +
    `comparison=${summary.comparisonAlignment} graph=${summary.authorGraphConformance}`
  );
  console.log(
    `code=${summary.codeArtifactExactness} refusals=${summary.safeRefusalRate} ` +
    `modelFree=${summary.noModelCalls} limits=${summary.limitCompliance}`
  );
  console.log(`acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`);
  for (const failure of report.failedCases) {
    console.log(`- ${failure.id}: ${JSON.stringify(failure.checks)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node evals/phase5-run.js [--dataset path] [--output path]');
    return;
  }
  const report = await buildPhase5Report(
    readJson(options.datasetPath),
    loadCorpus()
  );
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
  buildPhase5Report,
  evaluateCase,
  materializeRequest,
  parseArgs,
  summarize,
  validateDataset
};
