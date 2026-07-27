'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const feedbackHandler = require('../api/feedback');
const {
  FeedbackReceiptError,
  issueFeedbackReceipt,
  verifyFeedbackReceipt
} = require('../lib/feedback-receipt');
const {
  feedbackCollectionConfigured,
  feedbackEvent,
  forwardFeedbackEvent,
  webhookSignature
} = require('../lib/feedback-sink');
const {
  FeedbackValidationError,
  normalizeFeedbackRequest
} = require('../memory/feedback');

const FEEDBACK_ENV_KEYS = [
  'FEEDBACK_RECEIPT_SECRET',
  'FEEDBACK_REVIEW_CONTEXT_SECRET',
  'FEEDBACK_INCLUDE_REVIEW_CONTEXT',
  'FEEDBACK_WEBHOOK_URL',
  'FEEDBACK_WEBHOOK_SECRET',
  'FEEDBACK_WEBHOOK_TIMEOUT_MS'
];

const receiptSecret = 'receipt-secret-for-phase-four-tests-1234';
const reviewContextSecret = 'review-context-secret-for-phase-four-1234';
const webhookSecret = 'webhook-secret-for-phase-four-tests-1234';

function makeResponse() {
  const headers = new Map();
  return {
    body: '',
    ended: false,
    statusCode: 0,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(value) {
      this.body = value === undefined ? '' : String(value);
      this.ended = true;
    }
  };
}

function parseBody(response) {
  return JSON.parse(response.body);
}

function receiptPayload(receipt) {
  const [, encodedPayload] = receipt.split('.');
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
}

function receiptValues(overrides) {
  return Object.assign({
    traceId: 'trace_feedback_receipt_test',
    indexVersion: 'index-test',
    route: 'site_qa',
    evidenceStatus: 'sufficient',
    verificationStatus: 'verified',
    retrievalStrategy: 'hybrid_rrf_rerank',
    citationChunkIds: ['post#0'],
    modelAnswered: true,
    answer: '回答正文，不应写入反馈回执。',
    reviewQuestion: '这是一条只在负向反馈时才会交给审核者的问题。'
  }, overrides || {});
}

function receiptOptions(overrides) {
  return Object.assign({
    secret: receiptSecret,
    jti: 'feedbackreceipttest01'
  }, overrides || {});
}

async function withFeedbackEnvironment(values, callback) {
  const saved = {};
  for (const key of FEEDBACK_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, values || {});
  try {
    return await callback();
  } finally {
    for (const key of FEEDBACK_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('signed feedback receipts verify, reject tampering, and expire', () => {
  const issued = issueFeedbackReceipt(receiptValues(), receiptOptions({
    nowMs: 1_700_000_000_000,
    ttlMs: 1_000
  }));
  assert.ok(issued);

  const verified = verifyFeedbackReceipt(issued.receipt, receiptOptions({
    nowMs: 1_700_000_000_500
  }));
  assert.equal(verified.receiptId, 'feedbackreceipttest01');
  assert.equal(verified.traceId, 'trace_feedback_receipt_test');
  assert.equal(verified.answerDigest.length > 20, true);
  assert.equal(verified.reviewQuestion, '');

  const [prefix, payload, signature] = issued.receipt.split('.');
  const last = payload.endsWith('A') ? 'B' : 'A';
  const tampered = `${prefix}.${payload.slice(0, -1)}${last}.${signature}`;
  assert.throws(
    () => verifyFeedbackReceipt(tampered, receiptOptions()),
    error => error instanceof FeedbackReceiptError &&
      error.message === 'Invalid feedback receipt'
  );

  assert.throws(
    () => verifyFeedbackReceipt(issued.receipt, receiptOptions({
      nowMs: 1_700_000_001_000
    })),
    error => error instanceof FeedbackReceiptError && error.statusCode === 410
  );
});

test('review context is opt-in, encrypted in the receipt, and needs its own secret', () => {
  const question = '这是一条只在负向反馈时才会交给审核者的问题。';
  const defaultIssued = issueFeedbackReceipt(
    receiptValues({ reviewQuestion: question }),
    receiptOptions()
  );
  const defaultPayload = receiptPayload(defaultIssued.receipt);
  assert.equal(Object.hasOwn(defaultPayload, 'reviewContext'), false);
  assert.equal(JSON.stringify(defaultPayload).includes(question), false);
  assert.equal(
    verifyFeedbackReceipt(defaultIssued.receipt, receiptOptions()).reviewQuestion,
    ''
  );

  const encryptedIssued = issueFeedbackReceipt(
    receiptValues({ reviewQuestion: question }),
    receiptOptions({
      contextSecret: reviewContextSecret,
      includeReviewContext: true,
      jti: 'feedbackreceipttest02'
    })
  );
  const encryptedPayload = receiptPayload(encryptedIssued.receipt);
  assert.match(encryptedPayload.reviewContext, /^c1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(encryptedPayload).includes(question), false);
  assert.equal(
    verifyFeedbackReceipt(encryptedIssued.receipt, receiptOptions({
      jti: 'ignored-by-verification'
    })).reviewQuestion,
    ''
  );
  assert.equal(
    verifyFeedbackReceipt(encryptedIssued.receipt, receiptOptions({
      contextSecret: 'a-different-review-context-secret-1234',
      includeReviewContext: true
    })).reviewQuestion,
    ''
  );
  assert.equal(
    verifyFeedbackReceipt(encryptedIssued.receipt, receiptOptions({
      contextSecret: reviewContextSecret,
      includeReviewContext: true
    })).reviewQuestion,
    question
  );
});

test('feedback request schema permits only supported ratings and negative reasons', () => {
  const receipt = 'f1.payload_value.signature_value';
  assert.deepEqual(normalizeFeedbackRequest({
    receipt: ` ${receipt} `,
    rating: 'not_helpful',
    reason: 'citation_mismatch'
  }), {
    receipt,
    rating: 'not_helpful',
    reason: 'citation_mismatch'
  });
  assert.deepEqual(normalizeFeedbackRequest({ receipt, rating: 'helpful' }), {
    receipt,
    rating: 'helpful',
    reason: ''
  });

  for (const value of [
    { receipt, rating: 'maybe' },
    { receipt, rating: 'helpful', reason: 'answer_incorrect' },
    { receipt, rating: 'not_helpful', reason: 'free-form feedback' },
    { receipt: 'not-a-receipt', rating: 'helpful' },
    { receipt, rating: ['helpful'] }
  ]) {
    assert.throws(
      () => normalizeFeedbackRequest(value),
      error => error instanceof FeedbackValidationError && error.statusCode === 400
    );
  }
});

test('feedback events include review question only for negative feedback', () => {
  const receiptMetadata = {
    receiptId: 'feedbackreceipttest03',
    indexVersion: 'index-test',
    route: 'site_qa',
    evidenceStatus: 'sufficient',
    verificationStatus: 'verified',
    retrievalStrategy: 'hybrid_rrf_rerank',
    citationChunkIds: ['post#0'],
    modelAnswered: true,
    answerDigest: 'digest',
    reviewQuestion: '需要审核的问题'
  };
  const positive = feedbackEvent(receiptMetadata, { rating: 'helpful', reason: '' });
  const negative = feedbackEvent(receiptMetadata, {
    rating: 'not_helpful',
    reason: 'answer_incorrect'
  });

  assert.equal(Object.hasOwn(positive, 'reviewQuestion'), false);
  assert.equal(negative.reviewQuestion, '需要审核的问题');
  assert.equal(Object.hasOwn(negative, 'answer'), false);
  assert.equal(Object.hasOwn(negative, 'sessionId'), false);
});

test('webhook forwarding signs a non-redirecting idempotent request', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 202 };
  };

  const event = {
    version: 1,
    receiptId: 'feedbackreceipttest04',
    rating: 'not_helpful',
    reason: 'answer_incorrect'
  };
  try {
    await forwardFeedbackEvent(event, {
      config: {
        url: 'https://feedback.example.test/collect',
        secret: webhookSecret,
        timeoutMs: 500
      }
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(captured.url, 'https://feedback.example.test/collect');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, 'error');
  assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(captured.options.headers['Idempotency-Key'], event.receiptId);
  assert.equal(captured.options.headers['X-Blog-AI-Feedback-Version'], '1');
  const timestamp = captured.options.headers['X-Blog-AI-Feedback-Timestamp'];
  assert.match(timestamp, /^\d+$/);
  assert.equal(
    captured.options.headers['X-Blog-AI-Feedback-Signature'],
    `v1=${webhookSignature(webhookSecret, timestamp, captured.options.body)}`
  );
});

test('feedback API enforces configuration and CORS before accepting a receipt', async () => {
  await withFeedbackEnvironment({}, async () => {
    assert.equal(feedbackCollectionConfigured(), false);
    const response = makeResponse();
    await feedbackHandler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { receipt: 'f1.payload.signature', rating: 'helpful' }
    }, response);
    const payload = parseBody(response);
    assert.equal(response.statusCode, 503);
    assert.equal(payload.error, 'Feedback collection is not configured');
  });

  await withFeedbackEnvironment({
    FEEDBACK_RECEIPT_SECRET: receiptSecret,
    FEEDBACK_WEBHOOK_URL: 'https://feedback.example.test/collect',
    FEEDBACK_WEBHOOK_SECRET: webhookSecret
  }, async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => {
      fetchCalls += 1;
      return { ok: true, status: 202 };
    };
    try {
      const response = makeResponse();
      await feedbackHandler({
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          'content-type': 'application/json'
        },
        body: { receipt: 'f1.payload.signature', rating: 'helpful' }
      }, response);
      const payload = parseBody(response);
      assert.equal(response.statusCode, 403);
      assert.equal(payload.error, 'Origin is not allowed');
      assert.equal(response.getHeader('access-control-allow-origin'), undefined);
      assert.equal(fetchCalls, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('feedback API forwards a verified request through the signed webhook contract', async () => {
  await withFeedbackEnvironment({
    FEEDBACK_RECEIPT_SECRET: receiptSecret,
    FEEDBACK_REVIEW_CONTEXT_SECRET: reviewContextSecret,
    FEEDBACK_INCLUDE_REVIEW_CONTEXT: 'true',
    FEEDBACK_WEBHOOK_URL: 'https://feedback.example.test/collect',
    FEEDBACK_WEBHOOK_SECRET: webhookSecret,
    FEEDBACK_WEBHOOK_TIMEOUT_MS: '500'
  }, async () => {
    assert.equal(feedbackCollectionConfigured(), true);
    const issued = issueFeedbackReceipt(receiptValues(), {
      environment: process.env,
      jti: 'feedbackreceipttest05'
    });
    const originalFetch = global.fetch;
    const originalInfo = console.info;
    let captured;
    global.fetch = async (url, options) => {
      captured = { url, options, event: JSON.parse(options.body) };
      return { ok: true, status: 202 };
    };
    console.info = () => {};

    try {
      const response = makeResponse();
      await feedbackHandler({
        method: 'POST',
        headers: {
          origin: 'http://localhost:4000',
          'content-type': 'application/json'
        },
        body: {
          receipt: issued.receipt,
          rating: 'not_helpful',
          reason: 'answer_incorrect'
        }
      }, response);
      const payload = parseBody(response);

      assert.equal(response.statusCode, 202);
      assert.equal(payload.accepted, true);
      assert.equal(payload.receiptId, 'feedbackreceipttest05');
      assert.equal(
        response.getHeader('access-control-allow-origin'),
        'http://localhost:4000'
      );
      assert.equal(captured.url, 'https://feedback.example.test/collect');
      assert.equal(captured.event.receiptId, 'feedbackreceipttest05');
      assert.equal(captured.event.rating, 'not_helpful');
      assert.equal(captured.event.reviewQuestion, receiptValues().reviewQuestion);
      assert.equal(Object.hasOwn(captured.event, 'receipt'), false);
      assert.equal(Object.hasOwn(captured.event, 'answer'), false);
      assert.equal(captured.options.redirect, 'error');
      assert.equal(
        captured.options.headers['Idempotency-Key'],
        'feedbackreceipttest05'
      );
    } finally {
      global.fetch = originalFetch;
      console.info = originalInfo;
    }
  });
});
