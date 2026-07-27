'use strict';

const {
  FeedbackReceiptError,
  verifyFeedbackReceipt
} = require('../lib/feedback-receipt');
const {
  feedbackCollectionConfigured,
  feedbackEvent,
  forwardFeedbackEvent
} = require('../lib/feedback-sink');
const {
  applyCors,
  contentType,
  declaredContentLength,
  sendJson
} = require('../lib/http');
const {
  createRequestTrace
} = require('../lib/trace');
const {
  FEEDBACK_LIMITS,
  FeedbackValidationError,
  normalizeFeedbackRequest
} = require('../memory/feedback');

function buildMeta(trace) {
  return {
    traceId: trace.traceId,
    timings: trace.snapshot()
  };
}

module.exports = async (req, res) => {
  const trace = createRequestTrace();
  const originAllowed = applyCors(req, res);
  res.setHeader('X-Trace-Id', trace.traceId);

  if (req.method === 'OPTIONS') {
    if (!originAllowed) {
      sendJson(res, 403, { error: 'Origin is not allowed', meta: buildMeta(trace) });
    } else {
      res.statusCode = 200;
      res.end();
    }
    return;
  }

  if (!originAllowed) {
    sendJson(res, 403, { error: 'Origin is not allowed', meta: buildMeta(trace) });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed', meta: buildMeta(trace) });
    return;
  }
  if (contentType(req) !== 'application/json') {
    sendJson(res, 415, {
      error: 'Content-Type must be application/json',
      meta: buildMeta(trace)
    });
    return;
  }
  const contentLength = declaredContentLength(req);
  if (
    Number.isFinite(contentLength) &&
    contentLength > FEEDBACK_LIMITS.maxBodyBytes
  ) {
    sendJson(res, 413, { error: 'Request body is too large', meta: buildMeta(trace) });
    return;
  }
  if (!feedbackCollectionConfigured()) {
    sendJson(res, 503, {
      error: 'Feedback collection is not configured',
      meta: buildMeta(trace)
    });
    return;
  }

  try {
    const feedback = normalizeFeedbackRequest(req.body || {});
    const receipt = verifyFeedbackReceipt(feedback.receipt);
    const event = feedbackEvent(receipt, feedback);
    const forwardingStartedAt = trace.start();
    await forwardFeedbackEvent(event);
    trace.end('feedbackForwardMs', forwardingStartedAt);

    console.info('feedback.js accepted', {
      traceId: trace.traceId,
      receiptId: receipt.receiptId,
      rating: feedback.rating,
      reason: feedback.reason || '',
      route: receipt.route,
      verificationStatus: receipt.verificationStatus
    });
    sendJson(res, 202, {
      accepted: true,
      receiptId: receipt.receiptId,
      meta: buildMeta(trace)
    });
  } catch (error) {
    if (
      error instanceof FeedbackValidationError ||
      error instanceof FeedbackReceiptError
    ) {
      sendJson(res, error.statusCode || 400, {
        error: error.message,
        meta: buildMeta(trace)
      });
      return;
    }

    console.error('feedback.js failed', {
      traceId: trace.traceId,
      message: error && error.message ? error.message : 'Unknown error'
    });
    sendJson(res, 503, {
      error: 'Feedback collection is temporarily unavailable',
      meta: buildMeta(trace)
    });
  }
};
