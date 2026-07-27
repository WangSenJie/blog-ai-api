'use strict';

const {
  normalizePostUrl,
  normalizeText
} = require('../lib/retrieval-core');
const {
  TOOL_SCHEMAS,
  validateRecommendLearningPathArgs
} = require('./schemas');

const LEVEL_RANK = Object.freeze({
  beginner: 0,
  intermediate: 1,
  advanced: 2
});

function normalizedContains(haystack, needle) {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  return normalizedNeedle.length >= 2 && (
    normalizedHaystack.includes(normalizedNeedle) ||
    normalizedNeedle.includes(normalizedHaystack)
  );
}

function trackMatchScore(track, args) {
  const query = [args.topic, args.goal].filter(Boolean).join(' ');
  const aliases = []
    .concat(track.title || [])
    .concat(track.aliases || [])
    .concat((track.nodes || []).flatMap(node => [
      node.title,
      ...(node.aliases || [])
    ]));
  let score = 0;
  for (const alias of aliases) {
    if (normalizedContains(query, alias)) {
      score = Math.max(score, normalizeText(alias).length + 10);
    }
  }
  if ((track.nodes || []).some(node => (
    normalizePostUrl(node.url) === args.currentPostUrl
  ))) {
    score += 1000;
  }
  return score;
}

function targetNodeIndex(track, args) {
  const query = [args.topic, args.goal].filter(Boolean).join(' ');
  let best = { index: -1, score: 0 };
  for (const [index, node] of (track.nodes || []).entries()) {
    const aliases = [node.title].concat(node.aliases || []);
    for (const alias of aliases) {
      if (!normalizedContains(query, alias)) continue;
      const score = normalizeText(alias).length;
      if (score > best.score) best = { index, score };
    }
  }
  return best.index;
}

function relationForStep(index, startIndex, currentIndex, targetIndex) {
  if (currentIndex >= 0 && index === currentIndex + 1) return 'next';
  if (targetIndex >= 0 && index < targetIndex) return 'prerequisite';
  if (index === startIndex) return 'start';
  return 'next';
}

function cloneStep(track, node, relation) {
  return {
    id: node.id,
    title: node.title,
    url: normalizePostUrl(node.url),
    order: node.order,
    level: node.level,
    relation,
    trackId: track.id,
    trackTitle: track.title,
    reason: `作者维护的「${track.title}」阅读顺序`
  };
}

function chooseStartIndex(track, args, completed) {
  const currentIndex = (track.nodes || []).findIndex(node => (
    normalizePostUrl(node.url) === args.currentPostUrl
  ));
  if (currentIndex >= 0) return Math.min(currentIndex + 1, track.nodes.length);

  const configuredLevel = LEVEL_RANK[args.level] || 0;
  const levelIndex = (track.nodes || []).findIndex(node => (
    (LEVEL_RANK[node.level] || 0) >= configuredLevel
  ));
  const incompleteIndex = (track.nodes || []).findIndex(node => (
    !completed.has(normalizePostUrl(node.url))
  ));
  if (incompleteIndex < 0) return track.nodes.length;
  if (args.level === 'beginner') return incompleteIndex;
  return Math.max(incompleteIndex, levelIndex >= 0 ? levelIndex : 0);
}

function createRecommendLearningPathTool(options) {
  const posts = options && options.posts;
  const learningGraph = options && options.learningGraph;
  if (!Array.isArray(posts)) {
    throw new TypeError('createRecommendLearningPathTool requires a posts array');
  }

  return Object.freeze({
    name: 'recommend_learning_path',
    schema: TOOL_SCHEMAS.recommend_learning_path,

    execute(rawArgs) {
      const args = validateRecommendLearningPathArgs(rawArgs, normalizePostUrl);
      const knownUrls = new Set(posts.map(post => normalizePostUrl(post && post.url)));
      if (args.completedUrls.some(url => !knownUrls.has(url))) {
        return {
          strategy: 'author_curated_learning_graph',
          status: 'invalid_completed_article',
          total: 0,
          items: [],
          learningPath: null
        };
      }
      if (args.currentPostUrl && !knownUrls.has(args.currentPostUrl)) {
        return {
          strategy: 'author_curated_learning_graph',
          status: 'current_article_not_found',
          total: 0,
          items: [],
          learningPath: null
        };
      }
      if (!learningGraph || !Array.isArray(learningGraph.tracks)) {
        return {
          strategy: 'author_curated_learning_graph',
          status: 'graph_unavailable',
          total: 0,
          items: [],
          learningPath: null
        };
      }

      const track = learningGraph.tracks
        .map(item => ({ item, score: trackMatchScore(item, args) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || (
          String(left.item.id).localeCompare(String(right.item.id))
        ))[0];
      if (!track) {
        return {
          strategy: 'author_curated_learning_graph',
          graphVersion: learningGraph.version,
          status: 'not_configured',
          total: 0,
          items: [],
          learningPath: null
        };
      }

      const selectedTrack = track.item;
      const completed = new Set(args.completedUrls);
      const currentIndex = selectedTrack.nodes.findIndex(node => (
        normalizePostUrl(node.url) === args.currentPostUrl
      ));
      const targetIndex = targetNodeIndex(selectedTrack, args);
      let startIndex = chooseStartIndex(selectedTrack, args, completed);
      if (targetIndex >= 0 && currentIndex < 0 && targetIndex >= startIndex) {
        startIndex = Math.min(startIndex, targetIndex);
        if (args.level === 'beginner') startIndex = 0;
      }
      if (startIndex >= selectedTrack.nodes.length) {
        return {
          strategy: 'author_curated_learning_graph',
          graphVersion: learningGraph.version,
          status: 'terminal',
          total: 0,
          items: [],
          learningPath: {
            trackId: selectedTrack.id,
            trackTitle: selectedTrack.title,
            description: selectedTrack.description,
            kind: currentIndex >= 0 ? 'next' : 'path',
            steps: []
          }
        };
      }

      const candidateNodes = selectedTrack.nodes
        .slice(startIndex)
        .map((node, offset) => ({
          node,
          index: startIndex + offset
        }));
      const filteredNodes = candidateNodes.filter(item => (
        !completed.has(normalizePostUrl(item.node.url))
      ));
      const maxSteps = currentIndex >= 0 ? 1 : args.topK;
      const steps = filteredNodes.slice(0, maxSteps).map(item => (
        cloneStep(
          selectedTrack,
          item.node,
          relationForStep(
            item.index,
            startIndex,
            currentIndex,
            targetIndex
          )
        )
      ));
      return {
        strategy: 'author_curated_learning_graph',
        graphVersion: learningGraph.version,
        status: steps.length ? 'found' : 'terminal',
        total: steps.length,
        items: steps,
        learningPath: {
          trackId: selectedTrack.id,
          trackTitle: selectedTrack.title,
          description: selectedTrack.description,
          kind: currentIndex >= 0 ? 'next' : 'path',
          level: args.level,
          steps
        }
      };
    }
  });
}

module.exports = {
  LEVEL_RANK,
  chooseStartIndex,
  createRecommendLearningPathTool,
  targetNodeIndex,
  trackMatchScore
};
