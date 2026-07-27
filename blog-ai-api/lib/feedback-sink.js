'use strict';

const crypto = require('crypto');

const {
  MIN_SECRET_LENGTH,
  canSignFeedbackReceipt
} = require('./feedback-receipt');

function webhookConfig(environment) {
  const source = environment || process.env;
  const rawUrl = String(source.FEEDBACK_WEBHOOK_URL || '').trim();
  if (!rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;

  const secret = String(source.FEEDBACK_WEBHOOK_SECRET || '');
  if (secret.length < MIN_SECRET_LENGTH) return null;

  const configuredTimeout = Number(source.FEEDBACK_WEBHOOK_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(Math.max(Math.round(configuredTimeout), 500), 5000)
    : 3000;
  return { url: url.toString(), timeoutMs, secret };
}

function feedbackCollectionConfigured(environment) {
  return canSignFeedbackReceipt(environment) && Boolean(webhookConfig(environment));
}

function feedbackEvent(receiptMetadata, feedback) {
  const event = {
    version: 1,
    receiptId: receiptMetadata.receiptId,
    receivedAt: new Date().toISOString(),
    rating: feedback.rating,
    reason: feedback.reason || '',
    indexVersion: receiptMetadata.indexVersion,
    route: receiptMetadata.route,
    evidenceStatus: receiptMetadata.evidenceStatus,
    verificationStatus: receiptMetadata.verificationStatus,
    retrievalStrategy: receiptMetadata.retrievalStrategy,
    citationChunkIds: receiptMetadata.citationChunkIds.slice(),
    modelAnswered: receiptMetadata.modelAnswered,
    answerDigest: receiptMetadata.answerDigest
  };
  // Review context is opt-in, encrypted while it is in the browser receipt,
  // and forwarded only for a negative rating. It never includes a session,
  // conversation history, or raw answer.
  if (feedback.rating === 'not_helpful' && receiptMetadata.reviewQuestion) {
    event.reviewQuestion = receiptMetadata.reviewQuestion;
  }
  return event;
}

function webhookSignature(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret)
    .update(`v1.${timestamp}.${body}`)
    .digest('base64url');
}

async function forwardFeedbackEvent(event, options) {
  const settings = options || {};
  const config = settings.config || webhookConfig(settings.environment);
  if (!config) throw new Error('Feedback webhook is not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);
  const body = JSON.stringify(event);
  const timestamp = String(Date.now());
  const signature = webhookSignature(config.secret, timestamp, body);
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': event.receiptId,
        'X-Blog-AI-Feedback-Version': '1',
        'X-Blog-AI-Feedback-Timestamp': timestamp,
        'X-Blog-AI-Feedback-Signature': `v1=${signature}`
      },
      body,
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Feedback webhook failed: ${response.status}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  feedbackCollectionConfigured,
  feedbackEvent,
  forwardFeedbackEvent,
  webhookSignature,
  webhookConfig
};
