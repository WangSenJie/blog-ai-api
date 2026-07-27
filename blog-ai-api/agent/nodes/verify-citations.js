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
  notRequiredVerification,
  quoteComparable,
  sourceCandidates,
  validateClaim,
  verifyStructuredResponse
};
