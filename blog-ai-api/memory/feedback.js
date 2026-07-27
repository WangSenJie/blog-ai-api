'use strict';

const FEEDBACK_LIMITS = Object.freeze({
  maxBodyBytes: 8 * 1024,
  maxReceiptChars: 4096
});

const RATINGS = new Set(['helpful', 'not_helpful']);
const NEGATIVE_REASONS = new Set([
  'answer_incorrect',
  'citation_mismatch',
  'should_have_refused',
  'should_have_answer',
  'missing_content'
]);

class FeedbackValidationError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'FeedbackValidationError';
    this.statusCode = statusCode || 400;
  }
}

function feedbackError(message, statusCode) {
  throw new FeedbackValidationError(message, statusCode);
}

function parseFeedbackBody(rawBody) {
  let serialized;
  if (typeof rawBody === 'string') {
    serialized = rawBody;
  } else {
    try {
      serialized = JSON.stringify(rawBody || {});
    } catch (error) {
      feedbackError('Invalid JSON body');
    }
  }
  if (Buffer.byteLength(serialized, 'utf8') > FEEDBACK_LIMITS.maxBodyBytes) {
    feedbackError('Request body is too large', 413);
  }
  if (typeof rawBody !== 'string') return rawBody || {};

  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      feedbackError('Invalid JSON body');
    }
    return parsed;
  } catch (error) {
    if (error instanceof FeedbackValidationError) throw error;
    feedbackError('Invalid JSON body');
  }
}

function boundedString(value, field, maximum, optional) {
  if (value === undefined || value === null) {
    if (optional) return '';
    feedbackError(`Missing ${field}`);
  }
  if (typeof value !== 'string') feedbackError(`Invalid ${field}`);
  const text = value.trim();
  if (!text && !optional) feedbackError(`Missing ${field}`);
  if (text.length > maximum) feedbackError(`${field} is too long`);
  return text;
}

function normalizeFeedbackRequest(rawBody) {
  const body = parseFeedbackBody(rawBody);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    feedbackError('Invalid JSON body');
  }
  const receipt = boundedString(
    body.receipt,
    'feedback receipt',
    FEEDBACK_LIMITS.maxReceiptChars
  );
  if (!/^f1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(receipt)) {
    feedbackError('Invalid feedback receipt');
  }
  const rating = boundedString(body.rating, 'rating', 32);
  if (!RATINGS.has(rating)) feedbackError('Unsupported rating');
  const reason = boundedString(body.reason, 'reason', 64, true);
  if (rating === 'helpful' && reason) {
    feedbackError('Helpful feedback cannot include a reason');
  }
  if (reason && !NEGATIVE_REASONS.has(reason)) {
    feedbackError('Unsupported feedback reason');
  }

  return { receipt, rating, reason };
}

module.exports = {
  FEEDBACK_LIMITS,
  FeedbackValidationError,
  NEGATIVE_REASONS,
  RATINGS,
  normalizeFeedbackRequest
};
