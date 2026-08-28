'use strict';

const {
  getQuestionTerms,
  normalizePostUrl,
  normalizeText
} = require('../../lib/retrieval-core');
const {
  estimateTokens,
  EVIDENCE_CALIBRATION
} = require('../config');
const {
  ROUTES
} = require('./route');

const DIRECTNESS_RULES = Object.freeze([
  {
    question: /缺点|局限|不足|问题|风险|代价|劣势/,
    evidence: /缺点|局限|不足|问题|风险|代价|劣势|瓶颈|无法|难以/
  },
  {
    question: /优点|优势|好处|价值/,
    evidence: /优点|优势|好处|价值|提升|降低|减少|更快|更准/
  },
  {
    question: /为什么|原因|为何/,
    evidence: /因为|由于|原因|导致|因此|所以|取决于/
  },
  {
    question: /如何|怎么|怎样|流程|步骤/,
    evidence: /通过|首先|然后|最后|先|再|步骤|流程|使用|计算|检索|构建/
  },
  {
    question: /用途|作用|解决什么|用来做什么|适用场景/,
    evidence: /用于|用来|作用|解决|适用|场景|召回|推荐|检索|预测/
  },
  {
    question: /是什么|定义|结构|组成|原理/,
    evidence: /是|指|定义|结构|组成|包含|由|根据|一种|原理/
  }
]);

function searchableCandidateText(candidate) {
  const chunk = candidate.chunk;
  return normalizeText([
    chunk.postTitle,
    chunk.sectionTitle,
    (chunk.tags || []).join(' '),
    (chunk.categories || []).join(' '),
    chunk.content
  ].join(' '));
}

function meaningfulTerms(query) {
  return getQuestionTerms(query)
    .filter(term => !/^(文章|相关|内容|博客|继续|展开)$/.test(term));
}

function topicAnchorQuery(query) {
  const normalized = normalizeText(query)
    .replace(/[《》：:，,。！？?!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const leadingDefinition = normalized.match(
    /^(?:什么是|何为|介绍一下|解释一下|请介绍|请解释)\s*(.+)$/
  );
  if (leadingDefinition && leadingDefinition[1]) {
    return leadingDefinition[1].replace(/^的|的$/g, '').trim();
  }

  const marker = normalized.match(
    /为什么|为何|如何|怎么|怎样|是什么|有何|有什么|有哪些|区别是什么|作用是什么/
  );
  if (marker && marker.index > 0) {
    return normalized.slice(0, marker.index).replace(/的$/g, '').trim();
  }

  return normalized;
}

function knownArticleTitles(state) {
  const references = []
    .concat(state.currentQuestionRefs || [])
    .concat(state.resolvedArticleRefs || [])
    .concat(state.history && state.history.pageRef || [])
    .concat(state.history && state.history.articleRefs || []);
  return [...new Set(references
    .map(reference => normalizeText(reference && reference.title))
    .filter(title => title.length >= 2))]
    .sort((left, right) => right.length - left.length);
}

function removeKnownArticleTitles(query, state) {
  let normalized = normalizeText(query);
  for (const title of knownArticleTitles(state || {})) {
    normalized = normalized.split(title).join(' ');
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

function isGenericArticleDetailQuery(query) {
  const normalized = normalizeText(query)
    .replace(/[《》：:，,。！？?!\s]/g, '');
  return /^(?:的)?(?:结构|原理|定义|实现|特点|内容|作用|性质)?(?:什么是|是什么|介绍一下|讲了什么|主要内容|核心观点|有什么特点|有何特点|有哪些特点|有哪些内容|有什么性质|有哪些性质|它有什么性质|如何工作)?$/.test(
    normalized
  );
}

function candidateCoverage(candidate, query, calibration, options) {
  const policy = Object.assign({}, EVIDENCE_CALIBRATION, calibration || {});
  const settings = Object.assign({ allowSemantic: true }, options || {});
  const terms = meaningfulTerms(query);
  if (!terms.length) return candidate ? 1 : 0;
  const text = searchableCandidateText(candidate);
  const covered = terms.filter(term => text.includes(normalizeText(term)));
  const lexical = covered.length / terms.length;
  const vectorScore = Number(
    candidate && candidate.ranking && candidate.ranking.vectorScore
  );
  // A vector result is only used as evidence when its semantic similarity is
  // well above the retrieval floor. This keeps no-answer behavior conservative.
  const semantic = settings.allowSemantic && Number.isFinite(vectorScore) &&
    vectorScore >= policy.vectorEvidenceFloor
    ? Math.min(1, vectorScore / 0.6)
    : 0;
  return Math.max(lexical, semantic);
}

function candidateDirectness(candidate, query) {
  if (!candidate || !candidate.chunk) return 0;
  const normalizedQuery = normalizeText(query);
  if (/什么是|何为|是什么|定义|结构|组成|原理/.test(normalizedQuery)) {
    const anchor = normalizeText(topicAnchorQuery(query));
    if (!anchor) return 0;
    const text = normalizeText([
      candidate.chunk.sectionTitle,
      candidate.chunk.content
    ].join(' '));
    const anchorIndex = text.indexOf(anchor);
    if (anchorIndex < 0) return 0;
    const definitionWindow = text.slice(
      anchorIndex,
      anchorIndex + anchor.length + 36
    );
    return /(?:是|指|由|包括|包含|组成|核心|本质|定义)/.test(
      definitionWindow.slice(anchor.length)
    ) ? 1 : 0;
  }
  const rules = DIRECTNESS_RULES.filter(rule => rule.question.test(normalizedQuery));
  if (!rules.length) return 1;
  const text = [
    candidate.chunk.sectionTitle,
    candidate.chunk.content
  ].join(' ');
  const matched = rules.filter(rule => rule.evidence.test(text)).length;
  return matched / rules.length;
}

function candidateTopicCoverage(candidate, query, calibration) {
  if (!candidate || !candidate.chunk) return 0;
  const anchor = topicAnchorQuery(query);
  if (!anchor) return 0;
  return candidateCoverage(candidate, anchor, calibration, {
    allowSemantic: false
  });
}

function groundedCandidate(candidates, query, calibration) {
  const policy = Object.assign({}, EVIDENCE_CALIBRATION, calibration || {});
  return matchingQueryCandidates(candidates, query)
    .filter(candidate => (
      candidateTopicCoverage(candidate, query, policy) >=
        policy.topicAnchorMinCoverage &&
      candidateDirectness(candidate, query) >= 0.5
    ))
    .slice()
    .sort((left, right) => (
      candidateTopicCoverage(right, query, policy) -
        candidateTopicCoverage(left, query, policy) ||
      candidateDirectness(right, query) - candidateDirectness(left, query) ||
      candidateCoverage(right, query, policy) -
        candidateCoverage(left, query, policy) ||
      (right.score || 0) - (left.score || 0)
    ))[0] || null;
}

function bestTopicCandidate(candidates, query, calibration) {
  return matchingQueryCandidates(candidates, query)
    .slice()
    .sort((left, right) => (
      candidateTopicCoverage(right, query, calibration) -
        candidateTopicCoverage(left, query, calibration) ||
      candidateCoverage(right, query, calibration) -
        candidateCoverage(left, query, calibration) ||
      (right.score || 0) - (left.score || 0)
    ))[0] || null;
}

function bestCoverage(candidates, query, calibration, options) {
  return candidates.reduce(
    (best, candidate) => Math.max(
      best,
      candidateCoverage(candidate, query, calibration, options)
    ),
    0
  );
}

function matchingQueryCandidates(candidates, query) {
  const normalizedQuery = normalizeText(query);
  return candidates.filter(candidate => candidate.matchedQueries.some(
    matchedQuery => (
      normalizeText(matchedQuery) === normalizedQuery ||
      normalizeText(matchedQuery).startsWith(`${normalizedQuery} `)
    )
  ));
}

function bestQueryCandidate(candidates, query, calibration) {
  return matchingQueryCandidates(candidates, query)
    .slice()
    .sort((left, right) => (
      candidateCoverage(right, query, calibration) -
        candidateCoverage(left, query, calibration) ||
      (right.score || 0) - (left.score || 0) ||
      (left.rank || Number.MAX_SAFE_INTEGER) -
        (right.rank || Number.MAX_SAFE_INTEGER)
    ))[0] || null;
}

function bestTargetCandidate(candidates, target, calibration) {
  const policy = Object.assign({}, EVIDENCE_CALIBRATION, calibration || {});
  const normalizedTarget = normalizeText(target);
  return candidates
    .filter(candidate => (
      candidateCoverage(candidate, target, policy) >=
        policy.compareTargetMinCoverage
    ))
    .sort((left, right) => {
      const leftTitle = normalizeText(left.chunk.postTitle);
      const rightTitle = normalizeText(right.chunk.postTitle);
      const leftExact = leftTitle === normalizedTarget ? 1 : 0;
      const rightExact = rightTitle === normalizedTarget ? 1 : 0;
      const leftContains = leftTitle.includes(normalizedTarget) ? 1 : 0;
      const rightContains = rightTitle.includes(normalizedTarget) ? 1 : 0;
      return rightExact - leftExact ||
        rightContains - leftContains ||
      candidateCoverage(right, target, policy) -
        candidateCoverage(left, target, policy) ||
        right.score - left.score ||
        left.rank - right.rank;
    })[0] || null;
}

function gradeResult(status, reason, score, threshold, features) {
  return {
    status,
    reason,
    score: Number.isFinite(score) ? score : 0,
    threshold: Number.isFinite(threshold) ? threshold : 0,
    features: Object.assign({}, features || {})
  };
}

function gradeEvidence(state) {
  const calibration = Object.assign(
    {},
    EVIDENCE_CALIBRATION,
    state.evidenceCalibration || {}
  );
  const candidates = state.retrievedChunks;
  const coverageQuery = removeKnownArticleTitles(
    state.standaloneQuery,
    state
  ) || state.standaloneQuery;
  const coverageUsesArticleAnchor = normalizeText(coverageQuery) !==
    normalizeText(state.standaloneQuery);
  const coverageOptions = {
    allowSemantic: !coverageUsesArticleAnchor ||
      isGenericArticleDetailQuery(coverageQuery)
  };
  const primaryReference = state.resolvedArticleRefs[0] ||
    state.history.pageRef ||
    state.history.articleRefs[0] ||
    null;
  const primaryUrl = normalizePostUrl(primaryReference && primaryReference.url);
  const specialist = state.specialistResults || {};

  if (state.route === ROUTES.LEARNING_PATH) {
    const result = specialist.learningPath;
    const terminal = result && result.status === 'terminal';
    const found = result && result.status === 'found' &&
      Array.isArray(result.items) && result.items.length > 0;
    return gradeResult(
      found || terminal ? 'sufficient' : 'insufficient',
      found
        ? 'learning_path_found'
        : terminal
          ? 'learning_path_terminal'
          : result && result.status === 'not_configured'
            ? 'learning_path_not_configured'
            : result && result.status || 'learning_path_missing',
      found || terminal ? 1 : 0,
      1,
      {
        graphVersion: result && result.graphVersion || '',
        learningStatus: result && result.status || 'missing',
        calibrationVersion: calibration.version
      }
    );
  }

  if (state.route === ROUTES.CODE_EXPLANATION) {
    const result = specialist.codeExplanation;
    const found = result && result.status === 'found' &&
      result.codeExplanation && candidates.length > 0;
    return gradeResult(
      found ? 'sufficient' : 'insufficient',
      found ? 'code_block_found' : result && result.status || 'code_block_missing',
      found ? 1 : 0,
      1,
      {
        codeStatus: result && result.status || 'missing',
        calibrationVersion: calibration.version
      }
    );
  }

  if (state.route === ROUTES.ARTICLE_COMPARE && specialist.comparison) {
    const result = specialist.comparison;
    const complete = ['complete', 'partial'].includes(result.status) &&
      Array.isArray(result.articles) && result.articles.length >= 2 &&
      Array.isArray(result.comparison && result.comparison.rows) &&
      result.comparison.rows.length > 0;
    return gradeResult(
      complete ? 'sufficient' : 'insufficient',
      complete ? 'comparison_dimensions_covered' : result.status || 'comparison_target_missing',
      complete ? 1 : 0,
      1,
      {
        articles: Array.isArray(result.articles) ? result.articles.length : 0,
        dimensions: Array.isArray(result.comparison && result.comparison.rows)
          ? result.comparison.rows.length
          : 0,
        comparisonStatus: result.status || 'missing',
        calibrationVersion: calibration.version
      }
    );
  }

  if (!candidates.length) {
    return gradeResult(
      'insufficient',
      'no_candidates',
      0,
      calibration.siteQaMinCoverage,
      {
        candidates: 0,
        coverageQuery,
        semanticAllowed: coverageOptions.allowSemantic,
        calibrationVersion: calibration.version
      }
    );
  }

  if (state.route === ROUTES.PAGE_SUMMARY) {
    const hasPage = candidates.some(candidate => (
      normalizePostUrl(candidate.chunk.postUrl) === primaryUrl
    ));
    return gradeResult(
      hasPage ? 'sufficient' : 'insufficient',
      hasPage ? 'current_article_loaded' : 'current_article_missing',
      hasPage ? 1 : 0,
      1,
      { hasPage, candidates: candidates.length, calibrationVersion: calibration.version }
    );
  }

  if (state.route === ROUTES.PAGE_QA) {
    const pageCandidates = candidates.filter(candidate => (
      normalizePostUrl(candidate.chunk.postUrl) === primaryUrl
    ));
    const coverage = bestCoverage(
      pageCandidates,
      coverageQuery,
      calibration,
      coverageOptions
    );
    const genericArticleQuestion = (
      primaryReference &&
      normalizeText(state.standaloneQuery).includes(
        normalizeText(primaryReference.title)
      ) &&
      /有什么特点|有何特点|有哪些(?:特点|内容|性质)|主要(?:内容|特点)|讲了?什么|介绍一下|核心观点|适合(?:谁|什么)|做什么/.test(
        state.standaloneQuery
      )
    );
    const coverageEnough = pageCandidates.length && (
      coverage >= calibration.pageQaMinCoverage ||
      genericArticleQuestion
    );
    const directnessQuery = state.subqueries[0] || state.standaloneQuery;
    const directness = pageCandidates.reduce((best, candidate) => Math.max(
      best,
      candidateDirectness(candidate, directnessQuery)
    ), 0);
    const sufficient = coverageEnough && (
      !state.phase10.groundedSynthesisEnabled || directness >= 0.5
    );
    return gradeResult(
      sufficient ? 'sufficient' : 'insufficient',
      sufficient
        ? 'current_page_terms_covered'
        : coverageEnough
          ? 'current_page_direct_answer_missing'
          : 'current_page_terms_not_covered',
      genericArticleQuestion ? 1 : coverage,
      calibration.pageQaMinCoverage,
      {
        coverage,
        directness,
        coverageQuery,
        semanticAllowed: coverageOptions.allowSemantic,
        genericArticleQuestion,
        pageCandidates: pageCandidates.length,
        calibrationVersion: calibration.version
      }
    );
  }

  if (state.route === ROUTES.RELATED_ARTICLES) {
    const urls = new Set(
      candidates
        .map(candidate => normalizePostUrl(candidate.chunk.postUrl))
        .filter(url => url && url !== primaryUrl)
    );
    return gradeResult(
      urls.size ? 'sufficient' : 'insufficient',
      urls.size ? 'related_articles_found' : 'related_articles_missing',
      urls.size ? 1 : 0,
      1,
      {
        relatedUrls: urls.size,
        calibrationVersion: calibration.version
      }
    );
  }

  if (state.route === ROUTES.ARTICLE_COMPARE) {
    const targets = state.targetQueries.length
      ? state.targetQueries.slice(0, 2)
      : state.subqueries.slice(0, 2);
    const targetCandidates = targets.map(target => bestTargetCandidate(
      candidates.filter(candidate => candidate.matchedQueries.some(query => (
        normalizeText(query) === normalizeText(target) ||
        normalizeText(query).startsWith(`${normalizeText(target)} `)
      ))),
      target,
      calibration
    ));
    const distinctUrls = new Set(
      targetCandidates
        .filter(Boolean)
        .map(candidate => normalizePostUrl(candidate.chunk.postUrl))
    );
    const allTargetsCovered = targets.length >= 2 &&
      targetCandidates.every(Boolean);

    const sufficient = distinctUrls.size >= 2 && allTargetsCovered;
    return gradeResult(
      sufficient ? 'sufficient' : 'insufficient',
      sufficient ? 'comparison_targets_covered' : 'comparison_target_missing',
      targets.length ? distinctUrls.size / targets.length : 0,
      1,
      {
        targets: targets.length,
        coveredTargets: targetCandidates.filter(Boolean).length,
        distinctUrls: distinctUrls.size,
        targetMinCoverage: calibration.compareTargetMinCoverage,
        calibrationVersion: calibration.version
      }
    );
  }

  if (state.subqueries.length > 1) {
    const coverageBySubquery = state.subqueries.map(query => {
      const subqueryCoverageQuery = removeKnownArticleTitles(query, state) || query;
      const matchingCandidates = matchingQueryCandidates(candidates, query);
      const genericArticleQuestion = isGenericArticleDetailQuery(
        subqueryCoverageQuery
      );
      const coverage = bestCoverage(
        matchingCandidates,
        subqueryCoverageQuery,
        calibration,
        {
          allowSemantic: normalizeText(subqueryCoverageQuery) ===
            normalizeText(query) || genericArticleQuestion
        }
      );
      return genericArticleQuestion && matchingCandidates.length
        ? 1
        : coverage;
    });
    const allSubqueriesCovered = coverageBySubquery.every(coverage => (
      coverage >= calibration.compoundMinCoverage
    ));
    const directnessBySubquery = state.subqueries.map(query => {
      const candidate = state.phase10.groundedSynthesisEnabled
        ? groundedCandidate(candidates, query, calibration)
        : bestQueryCandidate(candidates, query, calibration);
      return candidateDirectness(candidate, query);
    });
    const topicCoverageBySubquery = state.subqueries.map(query => (
      candidateTopicCoverage(
        groundedCandidate(candidates, query, calibration),
        query,
        calibration
      )
    ));
    const directEnough = directnessBySubquery.every(score => score >= 0.5);
    const topicEnough = topicCoverageBySubquery.every(score => (
      score >= calibration.topicAnchorMinCoverage
    ));
    const sufficient = allSubqueriesCovered && (
      !state.phase10.groundedSynthesisEnabled || directEnough && topicEnough
    );
    return gradeResult(
      sufficient ? 'sufficient' : 'insufficient',
      sufficient
        ? 'all_subqueries_covered'
        : allSubqueriesCovered
          ? 'subquery_direct_answer_missing'
          : 'subquery_evidence_missing',
      coverageBySubquery.length ? Math.min(...coverageBySubquery) : 0,
      calibration.compoundMinCoverage,
      {
        coverageBySubquery,
        directnessBySubquery,
        topicCoverageBySubquery,
        topicAnchorMinCoverage: calibration.topicAnchorMinCoverage,
        coverageQuery,
        semanticAllowed: coverageOptions.allowSemantic,
        calibrationVersion: calibration.version
      }
    );
  }

  const coverage = bestCoverage(
    candidates.slice(0, 5),
    coverageQuery,
    calibration,
    coverageOptions
  );
  const directnessCandidate = bestQueryCandidate(
    candidates,
    state.subqueries[0] || coverageQuery,
    calibration
  ) || candidates[0];
  const directness = candidateDirectness(
    directnessCandidate,
    state.subqueries[0] || coverageQuery
  );
  const topicCoverage = candidateTopicCoverage(
    bestTopicCandidate(
      candidates,
      state.subqueries[0] || coverageQuery,
      calibration
    ),
    state.subqueries[0] || coverageQuery,
    calibration
  );
  const coverageEnough = coverage >= calibration.siteQaMinCoverage;
  const directEnough = directness >= 0.5;
  const topicThreshold = state.phase10.groundedSynthesisEnabled
    ? calibration.topicAnchorMinCoverage
    : Math.max(
      calibration.siteQaMinCoverage,
      calibration.topicAnchorMinCoverage - 0.1
    );
  const topicEnough = topicCoverage >= topicThreshold;
  const namedArticleDefinition = Boolean(
    state.currentQuestionRefs &&
    state.currentQuestionRefs.length === 1 &&
    isGenericArticleDetailQuery(coverageQuery)
  );
  const sufficient = (coverageEnough || namedArticleDefinition) &&
    topicEnough && (
    !state.phase10.groundedSynthesisEnabled || directEnough
  );
  return gradeResult(
    sufficient ? 'sufficient' : 'insufficient',
    sufficient
      ? 'query_terms_covered'
      : coverageEnough
        ? !topicEnough
          ? 'topic_anchor_not_covered'
          : 'direct_answer_terms_not_covered'
        : 'query_terms_not_covered',
    namedArticleDefinition ? 1 : coverage,
    calibration.siteQaMinCoverage,
    {
      coverage,
      directness,
      topicCoverage,
      topicAnchor: topicAnchorQuery(state.subqueries[0] || coverageQuery),
      topicAnchorMinCoverage: topicThreshold,
      coverageQuery,
      semanticAllowed: coverageOptions.allowSemantic,
      namedArticleDefinition,
      candidates: candidates.length,
      calibrationVersion: calibration.version
    }
  );
}

function selectContext(state) {
  const selected = [];
  const seen = new Set();
  const seenContent = new Set();
  const perPost = new Map();
  let characters = 0;
  const limits = state.budget.limits;

  function add(candidate) {
    if (!candidate || seen.has(candidate.chunk.id)) return false;
    const contentKey = normalizeText(candidate.chunk.content);
    const postUrl = normalizePostUrl(candidate.chunk.postUrl);
    const postCount = perPost.get(postUrl) || 0;
    if (seenContent.has(contentKey) || postCount >= 3) return false;
    const chunkCharacters = String(candidate.chunk.content || '').length;
    const nextCharacters = characters + chunkCharacters;
    const nextTokens = estimateTokens(nextCharacters);
    if (
      selected.length >= limits.maxContextChunks ||
      nextCharacters > limits.maxContextChars ||
      nextTokens > limits.maxContextTokens
    ) {
      return false;
    }
    seen.add(candidate.chunk.id);
    seenContent.add(contentKey);
    perPost.set(postUrl, postCount + 1);
    selected.push(candidate);
    characters = nextCharacters;
    return true;
  }

  if (state.route === ROUTES.ARTICLE_COMPARE) {
    for (const target of state.targetQueries.slice(0, 2)) {
      add(bestTargetCandidate(
        state.retrievedChunks.filter(candidate => (
          candidate.matchedQueries.some(query => (
            normalizeText(query) === normalizeText(target) ||
            normalizeText(query).startsWith(`${normalizeText(target)} `)
          ))
        )),
        target,
        state.evidenceCalibration
      ));
    }
  } else if (state.phase10.groundedSynthesisEnabled) {
    const assignedChunks = new Set();
    state.evidenceAssignments = [];
    for (const subquestion of state.subquestionPlan) {
      const eligible = matchingQueryCandidates(
        state.retrievedChunks,
        subquestion.question
      ).filter(candidate => (
        candidateTopicCoverage(
          candidate,
          subquestion.question,
          state.evidenceCalibration
        ) >= state.evidenceCalibration.topicAnchorMinCoverage &&
        candidateDirectness(candidate, subquestion.question) >= 0.5
      )).slice().sort((left, right) => (
        candidateTopicCoverage(
          right,
          subquestion.question,
          state.evidenceCalibration
        ) - candidateTopicCoverage(
          left,
          subquestion.question,
          state.evidenceCalibration
        ) ||
        candidateDirectness(right, subquestion.question) -
          candidateDirectness(left, subquestion.question) ||
        (right.score || 0) - (left.score || 0)
      ));
      const listQuestion = /哪些|列举|包括|算法|步骤|优点|缺点|特点|区别/.test(
        subquestion.question
      );
      const assignmentLimit = listQuestion ? 3 : 1;
      const candidates = [];
      const assignedPosts = new Set();
      for (const candidate of eligible) {
        const postUrl = normalizePostUrl(candidate.chunk.postUrl);
        if (
          assignedChunks.has(candidate.chunk.id) ||
          assignedPosts.has(postUrl)
        ) continue;
        candidates.push(candidate);
        assignedPosts.add(postUrl);
        if (candidates.length >= assignmentLimit) break;
      }
      if (!candidates.length && eligible[0]) candidates.push(eligible[0]);
      for (const candidate of candidates) {
        assignedChunks.add(candidate.chunk.id);
        const added = add(candidate);
        if (added || seen.has(candidate.chunk.id)) {
          state.evidenceAssignments.push({
            subquestionId: subquestion.id,
            chunkId: candidate.chunk.id,
            topicalScore: candidateCoverage(
              candidate,
              subquestion.question,
              state.evidenceCalibration
            ),
            directnessScore: candidateDirectness(candidate, subquestion.question)
          });
        }
      }
    }
  } else if (state.subqueries.length > 1) {
    for (const query of state.subqueries) {
      add(bestQueryCandidate(
        state.retrievedChunks,
        query,
        state.evidenceCalibration
      ));
    }
  }

  for (const candidate of state.retrievedChunks) add(candidate);

  state.budget.used.contextChunks = selected.length;
  state.budget.used.contextChars = characters;
  state.budget.used.estimatedContextTokens = estimateTokens(characters);
  return selected;
}

module.exports = {
  bestCoverage,
  bestQueryCandidate,
  bestTargetCandidate,
  candidateCoverage,
  candidateDirectness,
  candidateTopicCoverage,
  gradeResult,
  gradeEvidence,
  isGenericArticleDetailQuery,
  knownArticleTitles,
  meaningfulTerms,
  matchingQueryCandidates,
  removeKnownArticleTitles,
  selectContext,
  topicAnchorQuery
};
