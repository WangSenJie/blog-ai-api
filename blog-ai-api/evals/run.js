'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const { loadCorpus } = require('../lib/corpus');
const { detectMode, rankChunks } = require('../lib/retrieve');
const {
  ndcgAtK,
  recallAtK,
  reciprocalRankAtK,
  round,
  summarizeNegativeCases,
  summarizePositiveCases
} = require('./metrics');

const DEFAULT_DATASET_PATH = path.join(__dirname, 'dataset.json');
const DEFAULT_CORPUS_PATH = path.join(__dirname, '..', 'data', 'chunks.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalizePostUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    url.hash = '';
    const pathname = url.pathname === '/'
      ? '/'
      : `${url.pathname.replace(/\/+$/, '')}/`;
    return `${url.protocol}//${url.host.toLowerCase()}${pathname}${url.search}`;
  } catch (error) {
    return raw === '/' ? '/' : `${raw.replace(/\/+$/, '')}/`;
  }
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

function uniqueRankedPosts(ranked) {
  const seen = new Set();
  const posts = [];

  for (const item of ranked) {
    const title = String(item.chunk.postTitle || '').trim();
    const url = normalizePostUrl(item.chunk.postUrl);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    posts.push({
      title,
      url,
      score: round(item.score, 3)
    });
  }

  return posts;
}

function resolvePage(testCase, postsByTitle) {
  if (!testCase.pageTitle) return null;
  const post = postsByTitle.get(testCase.pageTitle);
  if (!post) {
    throw new Error(`Unknown pageTitle in ${testCase.id}: ${testCase.pageTitle}`);
  }

  return {
    title: post.title,
    url: post.url,
    description: ''
  };
}

function validateDataset(dataset, postsByTitle) {
  if (!dataset || !Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('Dataset must contain a non-empty cases array');
  }

  const ids = new Set();
  for (const testCase of dataset.cases) {
    if (!testCase.id || ids.has(testCase.id)) {
      throw new Error(`Dataset contains a missing or duplicate id: ${testCase.id || '<empty>'}`);
    }
    ids.add(testCase.id);

    if (!testCase.question || !testCase.category) {
      throw new Error(`Case ${testCase.id} is missing question or category`);
    }

    const relevantTitles = testCase.relevantPostTitles || [];
    if (testCase.shouldReject === true && relevantTitles.length) {
      throw new Error(`Case ${testCase.id} cannot be both positive and shouldReject`);
    }
    if (testCase.shouldReject !== true && !relevantTitles.length) {
      throw new Error(`Positive case ${testCase.id} needs relevantPostTitles`);
    }

    for (const title of relevantTitles) {
      if (!postsByTitle.has(title)) {
        throw new Error(`Unknown relevant title in ${testCase.id}: ${title}`);
      }
      if (!normalizePostUrl(postsByTitle.get(title).url)) {
        throw new Error(`Relevant title has no published URL in ${testCase.id}: ${title}`);
      }
    }
    resolvePage(testCase, postsByTitle);
  }
}

function evaluateCase(testCase, chunks, postsByTitle) {
  const page = resolvePage(testCase, postsByTitle);
  const mode = testCase.mode || detectMode(testCase.question);
  const startedAt = process.hrtime.bigint();
  const ranked = rankChunks(chunks, testCase.question, mode, page);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const rankedPosts = uniqueRankedPosts(ranked);
  const topResults = rankedPosts.slice(0, 5);

  if (testCase.shouldReject === true) {
    return {
      id: testCase.id,
      category: testCase.category,
      question: testCase.question,
      shouldReject: true,
      rejected: ranked.length === 0,
      candidateChunks: ranked.length,
      durationMs: round(durationMs, 3),
      topResults
    };
  }

  const relevantTitles = testCase.relevantPostTitles;
  const relevantUrls = relevantTitles.map(title => (
    normalizePostUrl(postsByTitle.get(title).url)
  ));
  const relevantRanks = relevantUrls
    .map(url => rankedPosts.findIndex(post => post.url === url) + 1)
    .filter(rank => rank > 0);
  const relevantCount = relevantTitles.length;

  return {
    id: testCase.id,
    category: testCase.category,
    question: testCase.question,
    pageTitle: testCase.pageTitle || null,
    relevantPostTitles: relevantTitles,
    relevantRanks,
    candidateChunks: ranked.length,
    durationMs: round(durationMs, 3),
    metrics: {
      recallAt5: round(recallAtK(relevantRanks, relevantCount, 5)),
      recallAt20: round(recallAtK(relevantRanks, relevantCount, 20)),
      hitAt5: relevantRanks.some(rank => rank <= 5) ? 1 : 0,
      reciprocalRankAt20: round(reciprocalRankAtK(relevantRanks, 20)),
      ndcgAt20: round(ndcgAtK(relevantRanks, relevantCount, 20))
    },
    topResults
  };
}

function buildReport(dataset, corpus, metadata) {
  const reportMetadata = metadata || {};
  const postsByTitle = new Map(corpus.posts.map(post => [post.title, post]));
  const indexedPublishedPostUrls = new Set(
    corpus.chunks
      .map(chunk => normalizePostUrl(chunk.postUrl))
      .filter(Boolean)
  );
  validateDataset(dataset, postsByTitle);

  // Warm the cached BM25 index before recording per-case latency.
  rankChunks(corpus.chunks, '__warmup__', 'site', null);

  const results = dataset.cases.map(testCase => (
    evaluateCase(testCase, corpus.chunks, postsByTitle)
  ));
  const positiveResults = results.filter(result => !result.shouldReject);
  const negativeResults = results.filter(result => result.shouldReject);
  const categories = [...new Set(results.map(result => result.category))];
  const byCategory = {};

  for (const category of categories) {
    const categoryResults = results.filter(result => result.category === category);
    byCategory[category] = categoryResults.every(result => result.shouldReject)
      ? summarizeNegativeCases(categoryResults)
      : summarizePositiveCases(categoryResults);
  }

  const failedCases = results
    .filter(result => result.shouldReject ? !result.rejected : !result.metrics.hitAt5)
    .map(result => ({
      id: result.id,
      category: result.category,
      question: result.question,
      expected: result.shouldReject ? 'no results' : result.relevantPostTitles,
      topResults: result.topResults
    }));

  const averageLatencyMs = results.length
    ? results.reduce((total, result) => total + result.durationMs, 0) / results.length
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    dataset: {
      version: dataset.version,
      cases: results.length,
      path: path.relative(
        path.join(__dirname, '..'),
        reportMetadata.datasetPath || DEFAULT_DATASET_PATH
      )
    },
    corpus: {
      posts: corpus.posts.length,
      postsWithUrl: corpus.posts.filter(post => normalizePostUrl(post.url)).length,
      indexedPublishedPosts: indexedPublishedPostUrls.size,
      chunks: corpus.chunks.length,
      publishedChunks: corpus.chunks.filter(chunk => normalizePostUrl(chunk.postUrl)).length,
      chunksWithoutUrl: corpus.chunks.filter(chunk => !normalizePostUrl(chunk.postUrl)).length,
      sha256: reportMetadata.corpusHash || null
    },
    retriever: {
      name: 'bm25-custom',
      evaluationUnit: 'unique normalized published post URL',
      tokenization: 'latin tokens + Chinese bigrams',
      k1: 1.2,
      b: 0.75
    },
    summary: Object.assign({}, summarizePositiveCases(positiveResults), {
      noAnswerCases: negativeResults.length,
      noAnswerAccuracy: summarizeNegativeCases(negativeResults).rejectionAccuracy,
      averageWarmRetrievalMs: round(averageLatencyMs, 3),
      failedCases: failedCases.length
    }),
    byCategory,
    failedCases,
    cases: results
  };
}

function printReport(report) {
  const summary = report.summary;
  console.log(`BM25 baseline: ${report.dataset.cases} cases, ${report.corpus.indexedPublishedPosts} indexed posts, ${report.corpus.publishedChunks} published chunks`);
  console.log(`Recall@5=${summary.recallAt5} Recall@20=${summary.recallAt20} HitRate@5=${summary.hitRateAt5}`);
  console.log(`MRR@20=${summary.mrrAt20} nDCG@20=${summary.ndcgAt20} NoAnswerAccuracy=${summary.noAnswerAccuracy}`);
  console.log(`Average warm retrieval=${summary.averageWarmRetrievalMs}ms FailedCases=${summary.failedCases}`);

  for (const [category, metrics] of Object.entries(report.byCategory)) {
    if (Object.prototype.hasOwnProperty.call(metrics, 'rejectionAccuracy')) {
      console.log(`${category}: cases=${metrics.cases} rejectionAccuracy=${metrics.rejectionAccuracy}`);
    } else {
      console.log(`${category}: cases=${metrics.cases} recall@5=${metrics.recallAt5} mrr@20=${metrics.mrrAt20}`);
    }
  }

  if (report.failedCases.length) {
    console.log('Failed cases:');
    for (const failure of report.failedCases) {
      const top = failure.topResults.map(result => result.title).join(', ') || '<none>';
      console.log(`- ${failure.id}: expected=${JSON.stringify(failure.expected)} top=${top}`);
    }
  }
}

function printHelp() {
  console.log('Usage: node evals/run.js [--dataset path] [--output path]');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dataset = readJson(options.datasetPath);
  const report = buildReport(dataset, loadCorpus(), {
    datasetPath: options.datasetPath,
    corpusHash: hashFile(DEFAULT_CORPUS_PATH)
  });
  printReport(report);

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Report written to ${options.outputPath}`);
  }
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
  buildReport,
  evaluateCase,
  normalizePostUrl,
  parseArgs,
  uniqueRankedPosts,
  validateDataset
};
