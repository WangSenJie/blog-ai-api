'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createRequestTrace } = require('../lib/trace');

test('request trace exposes a stable id and finite non-negative timings', () => {
  const trace = createRequestTrace();
  const operationStartedAt = trace.start();
  trace.end('operationMs', operationStartedAt);
  const snapshot = trace.snapshot();

  assert.match(trace.traceId, /^trace_[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(snapshot.operationMs));
  assert.ok(snapshot.operationMs >= 0);
  assert.ok(Number.isFinite(snapshot.totalMs));
  assert.ok(snapshot.totalMs >= 0);
});
