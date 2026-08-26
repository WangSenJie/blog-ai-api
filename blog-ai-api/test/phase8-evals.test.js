'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPhase8Report,
  managedConfiguration
} = require('../evals/phase8-run');

test('phase 8 implementation report passes every local memory safety gate', async () => {
  const report = await buildPhase8Report({ environment: {} });
  assert.equal(report.phase, 8);
  assert.equal(report.implementation.passed, true);
  assert.ok(Object.values(report.implementation.checks).every(Boolean));
  assert.equal(report.acceptance.implementationPassed, true);
  assert.equal(report.acceptance.managedRedisActive, false);
  assert.equal(
    report.acceptance.status,
    'implementation_passed_managed_validation_pending'
  );
});

test('managed Redis readiness reports presence without exposing secret values', () => {
  const environment = {
    MEMORY_V1_ENABLED: 'true',
    REDIS_URL: 'rediss://default:redis-secret@example.redis.cloud:6379',
    MEMORY_TOKEN_SECRET: 'token-secret',
    MEMORY_KEY_SECRET: 'key-secret'
  };
  const configuration = managedConfiguration(environment);
  assert.deepEqual(configuration, {
    featureEnabled: true,
    credentialsPresent: true
  });
  assert.equal(JSON.stringify(configuration).includes('redis-secret'), false);
});
