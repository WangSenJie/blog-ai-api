'use strict';

const {
  isIndexableChunk,
  normalizePostUrl,
  normalizeText,
  snippet,
  tokenize
} = require('../../lib/retrieval-core');

const MAX_CLAIMS = 6;
const MAX_CLAIM_CHARS = 600;
const MAX_QUOTE_CHARS = 360;
const MIN_QUOTE_CHARS = 6;

const CLAIM_NOISE_TERMS = new Set([
  '站内', '文章', '内容', '这里', '这个', '这个博', '博客',
  '可以', '继续', '根据', '如下', '结论', '引用', '资料',
  '显示', '说明', '相关', '阅读', '推荐', '一个', '一些'
]);
const NEGATION_PATTERN = /(?:不是|没有|没(?:有|能|法)?|无|非|未|不能|不会|无法|禁止|避免|拒绝|\bnot\b|\bno\b|\bnever\b|\bwithout\b)/i;
const VERIFIER_REASON_CODES = new Set([
  'supported',
  'quote_mismatch',
  'not_entailed',
  'does_not_answer_question',
  'scope_expansion',
  'negation_mismatch',
  'duplicate',
  'unknown_subquestion'
]);

function compactText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? '' : text;
}

function quoteComparable(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function meaningfulTerms(value) {
  return [...new Set(tokenize(value))].filter(term => (
    term.length >= 2 && !CLAIM_NOISE_TERMS.has(term)
  ));
}

function claimQuoteCoverage(claimText, quote) {
  const terms = meaningfulTerms(claimText);
  if (!terms.length) {
    return normalizeText(claimText) === normalizeText(quote) ? 1 : 0;
  }
  const normalizedQuote = normalizeText(quote);
  const covered = terms.filter(term => normalizedQuote.includes(term));
  return covered.length / terms.length;
}

function hasNegation(value) {
  return NEGATION_PATTERN.test(String(value || ''));
}

function numericTerms(value) {
  return String(value || '').match(/\d+(?:\.\d+)?%?/g) || [];
}

function isDeterministicSource(source) {
  return String(source || '').startsWith('deterministic');
}

// A word-overlap score cannot prove entailment: changing "两部分" to
// "三部分" still has very high lexical overlap. Published factual claims are
// therefore extractive. Deterministic responses may add only a title that the
// server obtained from the cited chunk; model responses must be the quote
// itself. This is deliberately conservative and makes every rendered claim
// directly auditable without pretending to run an NLI model.
function isExtractiveClaim(claim, candidate, source) {
  const text = quoteComparable(claim && claim.text);
  const quote = quoteComparable(claim && claim.quote);
  if (!text || !quote) return false;
  if (text === quote) return true;

  if (!isDeterministicSource(source)) return false;
  const title = quoteComparable(candidate && candidate.chunk && candidate.chunk.postTitle);
  return Boolean(title) && text === `《${title}》：${quote}`;
}

function sourceCandidates(selectedChunks) {
  const byId = new Map();

  for (const candidate of selectedChunks || []) {
    const chunk = candidate && candidate.chunk;
    if (!isIndexableChunk(chunk) || byId.has(chunk.id)) continue;
    byId.set(chunk.id, candidate);
  }

  return byId;
}

function citationFromCandidate(candidate, quote) {
  const chunk = candidate && candidate.chunk;
  if (!isIndexableChunk(chunk)) return null;

  return {
    chunkId: chunk.id,
    title: chunk.postTitle,
    url: normalizePostUrl(chunk.postUrl),
    section: chunk.sectionTitle || '',
    snippet: snippet(quote || chunk.content, 160)
  };
}

function claimShape(rawClaim, index) {
  if (!rawClaim || typeof rawClaim !== 'object' || Array.isArray(rawClaim)) {
    return { valid: false, reason: 'invalid_claim_shape' };
  }

  const text = compactText(rawClaim.text, MAX_CLAIM_CHARS);
  const quote = compactText(rawClaim.quote, MAX_QUOTE_CHARS);
  const citationIds = Array.isArray(rawClaim.citationIds)
    ? [...new Set(rawClaim.citationIds.map(id => String(id || '').trim()))]
      .filter(Boolean)
    : [];

  if (!text) return { valid: false, reason: 'invalid_claim_text' };
  if (quote.length < MIN_QUOTE_CHARS) {
    return { valid: false, reason: 'invalid_evidence_quote' };
  }
  if (citationIds.length !== 1) {
    return { valid: false, reason: 'claim_requires_one_citation' };
  }

  return {
    valid: true,
    claim: {
      id: `claim_${index + 1}`,
      text,
      quote,
      citationIds
    }
  };
}

function validateClaim(rawClaim, index, candidatesById, options) {
  const settings = Object.assign({
    source: 'deterministic'
  }, options || {});
  const shaped = claimShape(rawClaim, index);
  if (!shaped.valid) return shaped;

  const claim = shaped.claim;
  const candidate = candidatesById.get(claim.citationIds[0]);
  if (!candidate) {
    return { valid: false, reason: 'unknown_or_unselected_citation' };
  }

  const normalizedQuote = quoteComparable(claim.quote);
  const normalizedContent = quoteComparable(candidate.chunk.content);
  if (!normalizedContent.includes(normalizedQuote)) {
    return { valid: false, reason: 'quote_not_in_cited_chunk' };
  }

  const coverage = claimQuoteCoverage(claim.text, claim.quote);
  if (!isExtractiveClaim(claim, candidate, settings.source)) {
    return {
      valid: false,
      reason: hasNegation(claim.text) !== hasNegation(claim.quote)
        ? 'negation_mismatch'
        : 'claim_must_be_extractive',
      coverage
    };
  }

  return {
    valid: true,
    claim,
    candidate,
    coverage
  };
}

function verificationSummary(status, values) {
  return Object.assign({
    status,
    totalClaims: 0,
    supportedClaims: 0,
    rejectedClaims: 0,
    citationCompleteness: 0,
    citationSupport: 0,
    unsupportedClaimRate: 0,
    reasons: []
  }, values || {});
}

function notRequiredVerification(reason) {
  return verificationSummary('not_required', {
    citationCompleteness: 1,
    citationSupport: 1,
    reason: reason || 'no_factual_claims'
  });
}

function formatAnswer(claims, citationNumbers) {
  return claims.map(claim => {
    const number = citationNumbers.get(claim.citationIds[0]);
    return `- ${claim.text} [${number}]`;
  }).join('\n');
}

function groundedClaimShape(rawClaim, index) {
  if (!rawClaim || typeof rawClaim !== 'object' || Array.isArray(rawClaim)) {
    return { valid: false, reason: 'invalid_claim_shape' };
  }
  const sourceId = compactText(rawClaim.id, 64);
  const subquestionId = compactText(rawClaim.subquestionId, 64);
  const text = compactText(rawClaim.text, MAX_CLAIM_CHARS);
  const quote = compactText(rawClaim.quote, MAX_QUOTE_CHARS);
  const citationIds = Array.isArray(rawClaim.citationIds)
    ? [...new Set(rawClaim.citationIds.map(id => String(id || '').trim()))]
      .filter(Boolean)
    : [];
  if (!sourceId || !/^[A-Za-z0-9_-]+$/.test(sourceId)) {
    return { valid: false, reason: 'invalid_claim_id' };
  }
  if (!subquestionId) return { valid: false, reason: 'unknown_subquestion' };
  if (!text) return { valid: false, reason: 'invalid_claim_text' };
  if (quote.length < MIN_QUOTE_CHARS) {
    return { valid: false, reason: 'invalid_evidence_quote' };
  }
  if (citationIds.length !== 1) {
    return { valid: false, reason: 'claim_requires_one_citation' };
  }
  return {
    valid: true,
    claim: {
      id: `claim_${index + 1}`,
      sourceId,
      subquestionId,
      text,
      quote,
      citationIds
    }
  };
}

function formatGroundedAnswer(claims, subquestions, citationNumbers) {
  const claimsBySubquestion = new Map();
  for (const claim of claims) {
    if (!claimsBySubquestion.has(claim.subquestionId)) {
      claimsBySubquestion.set(claim.subquestionId, []);
    }
    claimsBySubquestion.get(claim.subquestionId).push(claim);
  }
  const sentence = claim => (
    `${claim.text} [${citationNumbers.get(claim.citationIds[0])}]`
  );
  if (subquestions.length <= 1) {
    const values = claimsBySubquestion.get(subquestions[0] && subquestions[0].id) || [];
    if (!values.length) {
      return '站内资料暂时不能直接回答这个问题。你可以补充文章标题或更具体的关键词。';
    }
    const question = String(subquestions[0] && subquestions[0].question || '');
    const listAnswer = values.length > 1 && /哪些|列举|包括|算法|步骤|优点|缺点|特点|区别/.test(question);
    return listAnswer
      ? values.map(claim => `- ${sentence(claim)}`).join('\n')
      : values.map(sentence).join(' ');
  }
  return subquestions.map(subquestion => {
    const values = claimsBySubquestion.get(subquestion.id) || [];
    return values.length
      ? `关于“${subquestion.question}”：${values.map(sentence).join(' ')}`
      : `关于“${subquestion.question}”：站内资料暂时没有可直接支持的答案。`;
  }).join('\n');
}

function verifyGroundedV2Response(
  rawResponse,
  semanticVerification,
  selectedChunks,
  subquestions,
  evidenceAssignments
) {
  const rawClaims = rawResponse && rawResponse.claims;
  const plan = Array.isArray(subquestions) ? subquestions : [];
  if (!Array.isArray(rawClaims) || rawClaims.length > MAX_CLAIMS || !plan.length) {
    const reason = !Array.isArray(rawClaims)
      ? 'missing_claims'
      : rawClaims.length > MAX_CLAIMS
        ? 'too_many_claims'
        : 'missing_subquestions';
    return {
      valid: false,
      reason,
      verification: verificationSummary('rejected', {
        totalClaims: Array.isArray(rawClaims) ? rawClaims.length : 0,
        rejectedClaims: Array.isArray(rawClaims) ? rawClaims.length : 0,
        reasons: [reason],
        source: 'semantic_verifier_v2'
      })
    };
  }

  const questionIds = new Set(plan.map(item => item.id));
  const assignmentList = Array.isArray(evidenceAssignments)
    ? evidenceAssignments
    : null;
  const assignedCitations = new Map();
  for (const assignment of assignmentList || []) {
    const subquestionId = String(assignment && assignment.subquestionId || '').trim();
    const chunkId = String(assignment && assignment.chunkId || '').trim();
    if (!subquestionId || !chunkId) continue;
    if (!assignedCitations.has(subquestionId)) {
      assignedCitations.set(subquestionId, new Set());
    }
    assignedCitations.get(subquestionId).add(chunkId);
  }
  const candidatesById = sourceCandidates(selectedChunks);
  const verdicts = new Map((semanticVerification.claims || []).map(item => [
    String(item && item.id || '').trim(),
    item
  ]));
  const subquestionVerdicts = new Map((semanticVerification.subquestions || []).map(item => [
    String(item && item.id || '').trim(),
    item
  ]));
  const seenText = new Set();
  const seenQuotes = new Set();
  const seenSourceIds = new Set();
  const accepted = [];
  const rejectedReasons = [];

  rawClaims.forEach((rawClaim, index) => {
    const shaped = groundedClaimShape(rawClaim, index);
    if (!shaped.valid) {
      rejectedReasons.push(shaped.reason);
      return;
    }
    const claim = shaped.claim;
    if (seenSourceIds.has(claim.sourceId)) {
      rejectedReasons.push('duplicate');
      return;
    }
    seenSourceIds.add(claim.sourceId);
    if (!questionIds.has(claim.subquestionId)) {
      rejectedReasons.push('unknown_subquestion');
      return;
    }
    const candidate = candidatesById.get(claim.citationIds[0]);
    if (!candidate) {
      rejectedReasons.push('unknown_or_unselected_citation');
      return;
    }
    if (
      assignmentList &&
      !assignedCitations.get(claim.subquestionId)?.has(claim.citationIds[0])
    ) {
      rejectedReasons.push('citation_not_assigned');
      return;
    }
    const normalizedQuote = quoteComparable(claim.quote);
    const normalizedContent = quoteComparable(candidate.chunk.content);
    if (!normalizedContent.includes(normalizedQuote)) {
      rejectedReasons.push('quote_not_in_cited_chunk');
      return;
    }
    if (hasNegation(claim.text) !== hasNegation(claim.quote)) {
      rejectedReasons.push('negation_mismatch');
      return;
    }
    const quoteNumbers = new Set(numericTerms(claim.quote));
    if (numericTerms(claim.text).some(value => !quoteNumbers.has(value))) {
      rejectedReasons.push('scope_expansion');
      return;
    }
    const normalizedText = normalizeText(claim.text);
    const quoteKey = normalizeText(claim.quote);
    if (seenText.has(normalizedText) || seenQuotes.has(quoteKey)) {
      rejectedReasons.push('duplicate');
      return;
    }
    const verdict = verdicts.get(claim.sourceId);
    const subquestionVerdict = subquestionVerdicts.get(claim.subquestionId);
    const reasonCode = String(verdict && verdict.reasonCode || 'not_entailed');
    if (
      !verdict ||
      verdict.supported !== true ||
      verdict.directlyAnswers !== true ||
      reasonCode !== 'supported' ||
      !VERIFIER_REASON_CODES.has(reasonCode) ||
      !subquestionVerdict ||
      subquestionVerdict.covered !== true
    ) {
      rejectedReasons.push(
        VERIFIER_REASON_CODES.has(reasonCode) ? reasonCode : 'not_entailed'
      );
      return;
    }
    seenText.add(normalizedText);
    seenQuotes.add(quoteKey);
    accepted.push({ claim, candidate });
  });

  const citationNumbers = new Map();
  const citations = [];
  const claims = accepted.map((item, index) => {
    const citationId = item.claim.citationIds[0];
    if (!citationNumbers.has(citationId)) {
      citationNumbers.set(citationId, citationNumbers.size + 1);
      citations.push(citationFromCandidate(item.candidate, item.claim.quote));
    }
    return {
      id: `claim_${index + 1}`,
      subquestionId: item.claim.subquestionId,
      text: item.claim.text,
      quote: item.claim.quote,
      citationIds: item.claim.citationIds,
      citationIndexes: [citationNumbers.get(citationId)]
    };
  });
  const covered = new Set(claims.map(claim => claim.subquestionId));
  const unansweredSubquestions = plan
    .filter(item => item.required !== false && !covered.has(item.id))
    .map(item => ({
      id: item.id,
      question: item.question,
      reason: 'no_verified_direct_claim'
    }));
  const totalClaims = rawClaims.length;
  const rejectedClaims = totalClaims - claims.length;

  return {
    valid: true,
    answer: formatGroundedAnswer(claims, plan, citationNumbers),
    claims,
    citations,
    unansweredSubquestions,
    verification: verificationSummary('verified', {
      totalClaims,
      supportedClaims: claims.length,
      rejectedClaims,
      citationCompleteness: claims.length ? 1 : 0,
      citationSupport: claims.length ? 1 : 0,
      unsupportedClaimRate: 0,
      rejectedClaimRate: totalClaims ? rejectedClaims / totalClaims : 0,
      subquestionCoverage: plan.length
        ? (plan.length - unansweredSubquestions.length) / plan.length
        : 0,
      reasons: [...new Set(rejectedReasons)],
      source: 'semantic_verifier_v2'
    })
  };
}

function verifyStructuredResponse(rawClaims, selectedChunks, options) {
  const settings = Object.assign({ source: 'deterministic' }, options);
  if (!Array.isArray(rawClaims) || !rawClaims.length) {
    return {
      valid: false,
      reason: 'missing_claims',
      verification: verificationSummary('rejected', {
        rejectedClaims: Array.isArray(rawClaims) ? rawClaims.length : 0,
        reasons: ['missing_claims'],
        source: settings.source
      })
    };
  }
  if (rawClaims.length > MAX_CLAIMS) {
    return {
      valid: false,
      reason: 'too_many_claims',
      verification: verificationSummary('rejected', {
        totalClaims: rawClaims.length,
        rejectedClaims: rawClaims.length,
        reasons: ['too_many_claims'],
        source: settings.source
      })
    };
  }

  const candidatesById = sourceCandidates(selectedChunks);
  const validated = rawClaims.map((claim, index) => (
    validateClaim(claim, index, candidatesById, {
      source: settings.source
    })
  ));
  const rejected = validated.filter(result => !result.valid);
  const supported = validated.filter(result => result.valid);
  const totalClaims = rawClaims.length;
  const rejectionReasons = [...new Set(rejected.map(result => result.reason))];

  if (rejected.length) {
    return {
      valid: false,
      reason: rejectionReasons[0] || 'unsupported_claim',
      verification: verificationSummary('rejected', {
        totalClaims,
        supportedClaims: supported.length,
        rejectedClaims: rejected.length,
        citationCompleteness: totalClaims
          ? supported.length / totalClaims
          : 0,
        citationSupport: totalClaims ? supported.length / totalClaims : 0,
        unsupportedClaimRate: totalClaims
          ? rejected.length / totalClaims
          : 0,
        reasons: rejectionReasons,
        source: settings.source
      })
    };
  }

  const citationNumbers = new Map();
  const citations = [];
  const claims = supported.map(result => {
    const citationId = result.claim.citationIds[0];
    if (!citationNumbers.has(citationId)) {
      citationNumbers.set(citationId, citationNumbers.size + 1);
      citations.push(citationFromCandidate(result.candidate, result.claim.quote));
    }
    return Object.assign({}, result.claim, {
      citationIndexes: [citationNumbers.get(citationId)]
    });
  });

  return {
    valid: true,
    answer: formatAnswer(claims, citationNumbers),
    claims,
    citations,
    verification: verificationSummary('verified', {
      totalClaims,
      supportedClaims: totalClaims,
      citationCompleteness: 1,
      citationSupport: 1,
      source: settings.source
    })
  };
}

module.exports = {
  MAX_CLAIMS,
  MAX_CLAIM_CHARS,
  MAX_QUOTE_CHARS,
  citationFromCandidate,
  claimQuoteCoverage,
  hasNegation,
  isExtractiveClaim,
  isDeterministicSource,
  meaningfulTerms,
  numericTerms,
  notRequiredVerification,
  quoteComparable,
  sourceCandidates,
  validateClaim,
  verifyGroundedV2Response,
  verifyStructuredResponse
};
