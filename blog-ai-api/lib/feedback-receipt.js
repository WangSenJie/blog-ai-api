'use strict';

const crypto = require('crypto');

const RECEIPT_PREFIX = 'f1';
const REVIEW_CONTEXT_PREFIX = 'c1';
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_REVIEW_QUESTION_CHARS = 320;

class FeedbackReceiptError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'FeedbackReceiptError';
    this.statusCode = statusCode || 400;
  }
}

function getReceiptSecret(environment) {
  return String((environment || process.env).FEEDBACK_RECEIPT_SECRET || '');
}

function getReviewContextSecret(environment) {
  return String((environment || process.env).FEEDBACK_REVIEW_CONTEXT_SECRET || '');
}

function canSignFeedbackReceipt(environment) {
  return getReceiptSecret(environment).length >= MIN_SECRET_LENGTH;
}

function enabled(value) {
  return /^(?:1|true|yes)$/i.test(String(value || '').trim());
}

function reviewContextConfiguration(options) {
  const settings = options || {};
  const environment = settings.environment || process.env;
  const include = Object.prototype.hasOwnProperty.call(
    settings,
    'includeReviewContext'
  )
    ? settings.includeReviewContext === true
    : enabled(environment.FEEDBACK_INCLUDE_REVIEW_CONTEXT);
  const secret = String(settings.contextSecret || getReviewContextSecret(environment));
  return include && secret.length >= MIN_SECRET_LENGTH ? { secret } : null;
}

function canIncludeReviewContext(environment) {
  return Boolean(reviewContextConfiguration({ environment }));
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(secret, encodedPayload) {
  return crypto.createHmac('sha256', secret)
    .update(`${RECEIPT_PREFIX}.${encodedPayload}`)
    .digest('base64url');
}

function safeString(value, maximum) {
  const text = String(value || '').trim();
  return text.length <= maximum ? text : '';
}

function answerDigest(answer) {
  return crypto.createHash('sha256')
    .update(String(answer || ''), 'utf8')
    .digest('base64url');
}

function reviewQuestion(value) {
  const question = String(value || '').replace(/\s+/g, ' ').trim();
  return question && question.length <= MAX_REVIEW_QUESTION_CHARS ? question : '';
}

function reviewContextKey(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

function reviewContextAad(receiptId) {
  return Buffer.from(`blog-ai-feedback-review-v1:${receiptId}`, 'utf8');
}

function encryptReviewQuestion(question, receiptId, options) {
  const config = reviewContextConfiguration(options);
  const value = reviewQuestion(question);
  if (!config || !value || !receiptId) return '';

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    reviewContextKey(config.secret),
    nonce
  );
  cipher.setAAD(reviewContextAad(receiptId));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, question: value }), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    REVIEW_CONTEXT_PREFIX,
    nonce.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptReviewQuestion(value, receiptId, options) {
  const config = reviewContextConfiguration(options);
  const parts = String(value || '').split('.');
  if (
    !config ||
    !receiptId ||
    parts.length !== 4 ||
    parts[0] !== REVIEW_CONTEXT_PREFIX ||
    parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    return '';
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      reviewContextKey(config.secret),
      Buffer.from(parts[1], 'base64url')
    );
    decipher.setAAD(reviewContextAad(receiptId));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final()
    ]).toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && parsed.v === 1 ? reviewQuestion(parsed.question) : '';
  } catch (error) {
    return '';
  }
}

function boundedTtl(options) {
  const requested = Number(options && options.ttlMs);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TTL_MS;
  return Math.min(Math.round(requested), MAX_TTL_MS);
}

function createPayload(values, options) {
  const now = Number(options && options.nowMs) || Date.now();
  const citationChunkIds = [...new Set((values.citationChunkIds || [])
    .map(value => safeString(value, 300))
    .filter(Boolean))]
    .slice(0, 6);
  const traceId = safeString(values.traceId, 128);
  if (!/^trace_[A-Za-z0-9_-]+$/.test(traceId)) {
    throw new FeedbackReceiptError('Cannot issue feedback receipt');
  }

  const payload = {
    v: 1,
    jti: safeString(options && options.jti, 128) ||
      crypto.randomUUID().replace(/-/g, ''),
    exp: now + boundedTtl(options),
    traceId,
    indexVersion: safeString(values.indexVersion, 128),
    route: safeString(values.route, 64),
    evidenceStatus: safeString(values.evidenceStatus, 32),
    verificationStatus: safeString(values.verificationStatus, 32),
    retrievalStrategy: safeString(values.retrievalStrategy, 64),
    citationChunkIds,
    modelAnswered: Boolean(values.modelAnswered),
    answerDigest: answerDigest(values.answer)
  };
  const encryptedReviewContext = encryptReviewQuestion(
    values.reviewQuestion,
    payload.jti,
    options
  );
  if (encryptedReviewContext) payload.reviewContext = encryptedReviewContext;
  return payload;
}

function issueFeedbackReceipt(values, options) {
  const settings = options || {};
  const secret = settings.secret || getReceiptSecret(settings.environment);
  if (String(secret).length < MIN_SECRET_LENGTH) return null;

  const payload = createPayload(values || {}, settings);
  const encodedPayload = base64url(JSON.stringify(payload));
  const signed = signature(secret, encodedPayload);
  return {
    receipt: `${RECEIPT_PREFIX}.${encodedPayload}.${signed}`,
    expiresAt: new Date(payload.exp).toISOString()
  };
}

function parseReceipt(receipt) {
  const value = String(receipt || '').trim();
  const parts = value.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== RECEIPT_PREFIX ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[2])
  ) {
    throw new FeedbackReceiptError('Invalid feedback receipt');
  }
  return { encodedPayload: parts[1], receivedSignature: parts[2] };
}

function verifyFeedbackReceipt(receipt, options) {
  const settings = options || {};
  const secret = settings.secret || getReceiptSecret(settings.environment);
  if (String(secret).length < MIN_SECRET_LENGTH) {
    throw new FeedbackReceiptError('Feedback collection is not configured', 503);
  }

  const parsed = parseReceipt(receipt);
  const expectedSignature = signature(secret, parsed.encodedPayload);
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(parsed.receivedSignature);
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    throw new FeedbackReceiptError('Invalid feedback receipt');
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64url(parsed.encodedPayload));
  } catch (error) {
    throw new FeedbackReceiptError('Invalid feedback receipt');
  }

  const now = Number(settings.nowMs) || Date.now();
  if (
    !payload ||
    payload.v !== 1 ||
    !/^[A-Za-z0-9]{16,128}$/.test(String(payload.jti || '')) ||
    !/^trace_[A-Za-z0-9_-]+$/.test(String(payload.traceId || '')) ||
    !Number.isFinite(payload.exp)
  ) {
    throw new FeedbackReceiptError('Invalid feedback receipt');
  }
  if (payload.exp <= now) {
    throw new FeedbackReceiptError('Feedback receipt has expired', 410);
  }

  return Object.freeze({
    receiptId: payload.jti,
    expiresAt: new Date(payload.exp).toISOString(),
    traceId: payload.traceId,
    indexVersion: safeString(payload.indexVersion, 128),
    route: safeString(payload.route, 64),
    evidenceStatus: safeString(payload.evidenceStatus, 32),
    verificationStatus: safeString(payload.verificationStatus, 32),
    retrievalStrategy: safeString(payload.retrievalStrategy, 64),
    citationChunkIds: [...new Set((payload.citationChunkIds || [])
      .map(value => safeString(value, 300))
      .filter(Boolean))]
      .slice(0, 6),
    modelAnswered: Boolean(payload.modelAnswered),
    answerDigest: safeString(payload.answerDigest, 128),
    reviewQuestion: decryptReviewQuestion(
      payload.reviewContext,
      payload.jti,
      settings
    )
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  FeedbackReceiptError,
  MAX_REVIEW_QUESTION_CHARS,
  MIN_SECRET_LENGTH,
  canIncludeReviewContext,
  canSignFeedbackReceipt,
  decryptReviewQuestion,
  encryptReviewQuestion,
  issueFeedbackReceipt,
  verifyFeedbackReceipt
};
