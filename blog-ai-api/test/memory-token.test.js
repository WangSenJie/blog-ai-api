'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MemoryTokenError,
  issueMemoryToken,
  verifyMemoryToken,
  verifyMemoryTokenWithRotation
} = require('../memory/token');

const TOKEN_SECRET = 'token-secret-for-memory-tests-1234567890';
const KEY_SECRET = 'key-secret-for-memory-tests-0987654321';

test('memory tokens are signed, opaque, and mapped to a separate key digest', () => {
  const issued = issueMemoryToken({
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET,
    randomBytes: () => Buffer.alloc(32, 7)
  });
  const verified = verifyMemoryToken(issued.token, {
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET
  });

  assert.match(issued.token, /^m1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  assert.match(issued.tokenDigest, /^[a-f0-9]{64}$/);
  assert.equal(verified.tokenDigest, issued.tokenDigest);
  assert.equal(issued.token.includes(issued.tokenDigest), false);
});

test('malformed and forged memory tokens are rejected with distinct safe status codes', () => {
  const issued = issueMemoryToken({
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET
  });
  const parts = issued.token.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;

  assert.throws(
    () => verifyMemoryToken('not-a-token', {
      tokenSecret: TOKEN_SECRET,
      keySecret: KEY_SECRET
    }),
    error => error instanceof MemoryTokenError && error.statusCode === 400
  );
  assert.throws(
    () => verifyMemoryToken(parts.join('.'), {
      tokenSecret: TOKEN_SECRET,
      keySecret: KEY_SECRET
    }),
    error => (
      error instanceof MemoryTokenError &&
      error.statusCode === 401 &&
      error.code === 'MEMORY_TOKEN_UNAUTHORIZED'
    )
  );
});

test('memory token and key secrets must be long and independently configured', () => {
  for (const options of [
    { tokenSecret: 'short', keySecret: KEY_SECRET },
    { tokenSecret: TOKEN_SECRET, keySecret: 'short' },
    { tokenSecret: TOKEN_SECRET, keySecret: TOKEN_SECRET }
  ]) {
    assert.throws(
      () => issueMemoryToken(options),
      error => (
        error instanceof MemoryTokenError &&
        error.code === 'MEMORY_CONFIGURATION_INVALID'
      )
    );
  }
});

test('memory token rotation accepts the previous pair only during the compatibility window', () => {
  const nextTokenSecret = 'next-token-secret-for-memory-tests-123456';
  const nextKeySecret = 'next-key-secret-for-memory-tests-65432109';
  const issued = issueMemoryToken({
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET,
    randomBytes: () => Buffer.alloc(32, 9)
  });
  const verified = verifyMemoryTokenWithRotation(issued.token, {
    tokenSecret: nextTokenSecret,
    keySecret: nextKeySecret,
    previousTokenSecret: TOKEN_SECRET,
    previousKeySecret: KEY_SECRET
  });

  assert.equal(verified.tokenDigest, issued.tokenDigest);
  assert.equal(verified.secretVersion, 'previous');
  assert.throws(
    () => verifyMemoryTokenWithRotation(issued.token, {
      tokenSecret: nextTokenSecret,
      keySecret: nextKeySecret
    }),
    error => error.code === 'MEMORY_TOKEN_UNAUTHORIZED'
  );
});
