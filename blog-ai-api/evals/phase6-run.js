'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { loadCorpus } = require('../lib/corpus');
const {
  buildCorpus,
  extractCodeBlocks
} = require('../../scripts/build-ai-corpus');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase6-ingestion.json');
const LEGACY_BASELINE = Object.freeze({
  gitRevision: '7e6d67bd9653bd2fb48f161e0c438f56215b83de',
  manifest: {
    schemaVersion: 3,
    corpusVersion: '3f287d5997e3977eb94c32e326691d9ac4863114166eb3d134a2b17700393f5f',
    postsSha256: 'b5a2a7ac8593e8b7230ad5cbd1e1fe7b18054da00e83fdb2bcbf01c13948dcdb',
    chunksSha256: '119cc5664a0f46a7854f6f6156e9709e5487870b8ecb87d65e943ee7b5021d20',
    vectorsSha256: 'a80628c380c611a2da4030ac6129314c5a19731ec69ad7f021db907339352e20',
    posts: 71,
    chunks: 964,
    vectors: 964,
    codeBlocks: 395
  },
  evaluations: {
    hybridPhase2Sha256: '9f7e7e6adb0485a95374c3245d891d686c321e6d6892f4d7fbc550f2bd8f5feb',
    agentPhase3Sha256: '90cf43ad5a072b6b69672d6960e36d51f54c682476e60fff01c3dd0b871a80ec',
    hitRateAt5: 0.95,
    recallAt5: 0.95,
    mrrAt20: 0.7958,
    safeStopAccuracy: 1,
    referenceResolutionAccuracy: 1,
    warmLatencyP95Ms: 170.924
  },
  buildDurationMs: 400
});

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readReport(filename) {
  const filePath = path.join(__dirname, 'reports', filename);
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
    : null;
}

function sourceBuildAudit(corpus) {
  const postsDirectory = path.join(REPOSITORY_ROOT, 'source', '_posts');
  const startedAt = performance.now();
  const rebuilt = buildCorpus(postsDirectory);
  const codeBlocks = extractCodeBlocks(rebuilt.posts, rebuilt.chunks);
  const buildDurationMs = Number((performance.now() - startedAt).toFixed(3));
  const rebuiltById = new Map(rebuilt.chunks.map(chunk => [chunk.id, chunk]));
  let matchingChunks = 0;
  let validSourceLocations = 0;

  for (const chunk of corpus.chunks) {
    const sourceChunk = rebuiltById.get(chunk.id);
    if (sourceChunk && [
      'contentHash', 'content', 'retrievalText', 'sourcePath', 'profile',
      'profileSource', 'parentId', 'childOrdinal', 'chunkType', 'tokenCount',
      'tokenizerVersion', 'overflowReason', 'sectionAnchor', 'sourceLines',
      'blockTypes'
    ].every(field => sameJson(chunk[field], sourceChunk[field]))) {
      matchingChunks += 1;
    }
    if (chunk.metadataOnly === true) {
      if (chunk.sourceLines === null) validSourceLocations += 1;
      continue;
    }
    const sourcePath = path.resolve(REPOSITORY_ROOT, String(chunk.sourcePath || ''));
    const insideRepository = sourcePath.startsWith(`${REPOSITORY_ROOT}${path.sep}`);
    if (!insideRepository || !fs.existsSync(sourcePath) || !chunk.sourceLines) continue;
    const lineCount = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').split('\n').length;
    if (
      chunk.sourceLines.start >= 1 &&
      chunk.sourceLines.end >= chunk.sourceLines.start &&
      chunk.sourceLines.end <= lineCount
    ) {
      validSourceLocations += 1;
    }
  }

  return {
    buildDurationMs,
    rebuiltPosts: rebuilt.posts.length,
    rebuiltChunks: rebuilt.chunks.length,
    rebuiltCodeBlocks: codeBlocks.length,
    matchingChunks,
    sourceRebuildMatchRate: corpus.chunks.length
      ? matchingChunks / corpus.chunks.length
      : 1,
    validSourceLocations,
    sourceLocationCoverage: corpus.chunks.length
      ? validSourceLocations / corpus.chunks.length
      : 1
  };
}

function buildPhase6Report(corpus) {
  const activeCorpus = corpus || loadCorpus();
  const ingestion = activeCorpus.manifest && activeCorpus.manifest.ingestion;
  if (!ingestion) throw new Error('Phase 6 evaluation requires structured ingestion metadata');
  const audit = sourceBuildAudit(activeCorpus);
  const chunkCount = activeCorpus.chunks.length;
  const codeChunks = activeCorpus.chunks.filter(chunk => (
    Array.isArray(chunk.blockTypes) && chunk.blockTypes.includes('code')
  ));
  const codeBoundaryPreserved = codeChunks.length >= activeCorpus.codeBlocks.length &&
    codeChunks.every(chunk => chunk.chunkType === 'code') &&
    activeCorpus.chunks.every(chunk => (
      chunk.chunkType === 'code' ||
      !Array.isArray(chunk.blockTypes) ||
      !chunk.blockTypes.includes('code')
    ));
  const retrievalCoverage = chunkCount
    ? ingestion.stats.chunksWithRetrievalText / chunkCount
    : 1;
  const traceCoverage = chunkCount
    ? (ingestion.stats.sourceLocatedChunks + ingestion.stats.metadataOnlyChunks) / chunkCount
    : 1;
  const linkResolution = ingestion.stats.internalLinkEdges
    ? ingestion.stats.resolvedInternalLinkEdges / ingestion.stats.internalLinkEdges
    : 1;
  const hybridReport = readReport('hybrid-phase2.json');
  const agentReport = readReport('agent-phase6.json');
  const phase4Report = readReport('phase4-after-phase6.json');
  const phase5Report = readReport('phase5-after-phase6.json');
  const currentVersion = activeCorpus.manifest.corpusVersion;
  const hybridCurrent = hybridReport && hybridReport.hybrid &&
    hybridReport.hybrid.corpus.sha256 === activeCorpus.manifest.files.chunks.sha256;
  const agentCurrent = agentReport && agentReport.corpus &&
    agentReport.corpus.indexVersion === currentVersion;
  const phase4Current = phase4Report && phase4Report.corpus &&
    phase4Report.corpus.indexVersion === currentVersion;
  const phase5Current = phase5Report && phase5Report.corpus &&
    phase5Report.corpus.indexVersion === currentVersion;
  const evaluations = {
    hybrid: hybridCurrent ? hybridReport.hybrid.summary : null,
    agent: agentCurrent ? agentReport.summary : null,
    phase4Passed: Boolean(phase4Current && phase4Report.acceptance.passed),
    phase5Passed: Boolean(phase5Current && phase5Report.acceptance.passed)
  };
  const checks = {
    allPublishedPostsParsed: activeCorpus.posts.length === LEGACY_BASELINE.manifest.posts,
    retrievalCoverage: retrievalCoverage === 1,
    traceCoverage: traceCoverage === 1,
    sourceRebuildMatch: audit.sourceRebuildMatchRate === 1,
    sourceLocationsValid: audit.sourceLocationCoverage === 1,
    codeBoundaryPreserved: codeBoundaryPreserved &&
      ingestion.stats.blockTypeCounts.code === activeCorpus.codeBlocks.length &&
      audit.rebuiltCodeBlocks === activeCorpus.codeBlocks.length,
    profileRegistry: ingestion.profileRegistry.version === 1,
    internalLinksResolved: linkResolution === 1,
    rollbackContract: ingestion.chunkSchema.rollbackMode === 'legacy-v3' &&
      ingestion.chunkSchema.switch === 'RAG_CHUNK_SCHEMA',
    hybridQualityGate: Boolean(
      evaluations.hybrid &&
      hybridReport.acceptance && hybridReport.acceptance.semanticImproved &&
      hybridReport.acceptance.exactNoRegression &&
      evaluations.hybrid.recallAt5 >= 0.9 &&
      evaluations.hybrid.mrrAt20 >= LEGACY_BASELINE.evaluations.mrrAt20
    ),
    agentRegression: Boolean(
      evaluations.agent && agentReport.acceptance.passed &&
      evaluations.agent.safeStopAccuracy === 1 &&
      evaluations.agent.referenceResolutionAccuracy === 1
    ),
    groundedAndSpecialistRegression: evaluations.phase4Passed && evaluations.phase5Passed
  };

  return {
    phase: 6,
    generatedAt: new Date().toISOString(),
    strategy: 'structured-markdown-ingestion-v1',
    baseline: LEGACY_BASELINE,
    current: {
      corpusVersion: activeCorpus.manifest.corpusVersion,
      manifestSchemaVersion: activeCorpus.manifest.schemaVersion,
      posts: activeCorpus.posts.length,
      chunks: chunkCount,
      vectors: activeCorpus.vectors.length,
      codeBlocks: activeCorpus.codeBlocks.length,
      structuredBlocks: ingestion.stats.structuredBlocks,
      blockTypeCounts: ingestion.stats.blockTypeCounts,
      profileCounts: ingestion.stats.profileCounts,
      profileSourceCounts: ingestion.stats.profileSourceCounts,
      retrievalCoverage,
      traceCoverage,
      linkResolution,
      contentLength: ingestion.stats.contentLength,
      warnings: ingestion.warnings,
      evaluations,
      sourceBuildAudit: audit
    },
    rollback: {
      command: 'RAG_CHUNK_SCHEMA=legacy-v3 npm run export:ai',
      revision: ingestion.chunkSchema.rollbackRevision,
      scope: 'restores posts, chunks, vectors, code blocks, learning graph and browser retrieval artifacts'
    },
    acceptance: {
      checks,
      passed: Object.values(checks).every(Boolean)
    }
  };
}

function main() {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
    ? path.resolve(process.argv[outputIndex + 1])
    : DEFAULT_OUTPUT_PATH;
  const report = buildPhase6Report(loadCorpus());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 6 ingestion: posts=${report.current.posts} chunks=${report.current.chunks} ` +
    `sourceMatch=${report.current.sourceBuildAudit.sourceRebuildMatchRate} ` +
    `acceptance=${report.acceptance.passed ? 'PASS' : 'FAIL'}`
  );
  console.log(`Report written to ${outputPath}`);
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
  LEGACY_BASELINE,
  buildPhase6Report,
  sourceBuildAudit
};
