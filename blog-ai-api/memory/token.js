'use strict';

const {
  createHmac,
  randomBytes,
  timingSafeEqual
} = require('crypto');

const TOKEN_PREFIX = 'm1';
const TOKEN_PART_BYTES = 32;
const TOKEN_PART_LENGTH = 43;
const MIN_SECRET_BYTES = 32;

class MemoryTokenError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'MemoryTokenError';
    this.statusCode = statusCode || 400;
    this.code = code || 'MEMORY_TOKEN_INVALID';
  }
}

function secretBuffer(value, name) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
    throw new MemoryTokenError(
      `${name} must contain at least ${MIN_SECRET_BYTES} bytes`,
      503,
      'MEMORY_CONFIGURATION_INVALID'
    );
  }
  return Buffer.from(value, 'utf8');
}

function tokenSecrets(options) {
  const settings = options || {};
  const tokenSecret = secretBuffer(settings.tokenSecret, 'MEMORY_TOKEN_SECRET');
  const keySecret = secretBuffer(settings.keySecret, 'MEMORY_KEY_SECRET');

  if (
    tokenSecret.length === keySecret.length &&
    timingSafeEqual(tokenSecret, keySecret)
  ) {
    throw new MemoryTokenError(
      'Memory token and key secrets must be different',
      503,
      'MEMORY_CONFIGURATION_INVALID'
    );
  }

  return { tokenSecret, keySecret };
}

function signatureFor(unsignedToken, tokenSecret) {
  return createHmac('sha256', tokenSecret)
    .update(unsignedToken, 'utf8')
    .digest();
}

function digestFor(randomId, keySecret) {
  return createHmac('sha256', keySecret)
    .update(randomId, 'utf8')
    .digest('hex');
}

function issueMemoryToken(options) {
  const settings = options || {};
  const { tokenSecret, keySecret } = tokenSecrets(settings);
  const entropy = settings.randomBytes
    ? settings.randomBytes(TOKEN_PART_BYTES)
    : randomBytes(TOKEN_PART_BYTES);

  if (!Buffer.isBuffer(entropy) || entropy.length !== TOKEN_PART_BYTES) {
    throw new MemoryTokenError(
      'Unable to create memory token',
      500,
      'MEMORY_TOKEN_GENERATION_FAILED'
    );
  }

  const randomId = entropy.toString('base64url');
  const unsignedToken = `${TOKEN_PREFIX}.${randomId}`;
  const signature = signatureFor(unsignedToken, tokenSecret).toString('base64url');

  return {
    token: `${unsignedToken}.${signature}`,
    tokenDigest: digestFor(randomId, keySecret)
  };
}

function invalidToken(message, statusCode, code) {
  throw new MemoryTokenError(
    message || 'Invalid memoryToken',
    statusCode || 400,
    code || 'MEMORY_TOKEN_INVALID'
  );
}

function verifyMemoryToken(token, options) {
  const { tokenSecret, keySecret } = tokenSecrets(options);
  if (typeof token !== 'string' || token.length > 160) {
    invalidToken();
  }

  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    parts[0] !== TOKEN_PREFIX ||
    parts[1].length !== TOKEN_PART_LENGTH ||
    parts[2].length !== TOKEN_PART_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[2])
  ) {
    invalidToken();
  }

  let randomPart;
  let suppliedSignature;
  try {
    randomPart = Buffer.from(parts[1], 'base64url');
    suppliedSignature = Buffer.from(parts[2], 'base64url');
  } catch (error) {
    invalidToken();
  }

  if (
    randomPart.length !== TOKEN_PART_BYTES ||
    suppliedSignature.length !== TOKEN_PART_BYTES ||
    randomPart.toString('base64url') !== parts[1] ||
    suppliedSignature.toString('base64url') !== parts[2]
  ) {
    invalidToken();
  }

  const expectedSignature = signatureFor(
    `${TOKEN_PREFIX}.${parts[1]}`,
    tokenSecret
  );
  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    invalidToken('Invalid memoryToken signature', 401, 'MEMORY_TOKEN_UNAUTHORIZED');
  }

  return {
    tokenDigest: digestFor(parts[1], keySecret)
  };
}

function verifyMemoryTokenWithRotation(token, options) {
  const settings = options || {};
  try {
    return Object.assign(verifyMemoryToken(token, settings), {
      secretVersion: 'current'
    });
  } catch (currentError) {
    const hasPrevious = Boolean(
      String(settings.previousTokenSecret || '').trim() ||
      String(settings.previousKeySecret || '').trim()
    );
    if (!hasPrevious) throw currentError;
    try {
      return Object.assign(verifyMemoryToken(token, {
        tokenSecret: settings.previousTokenSecret || settings.tokenSecret,
        keySecret: settings.previousKeySecret || settings.keySecret
      }), {
        secretVersion: 'previous'
      });
    } catch (previousError) {
      throw currentError;
    }
  }
}

module.exports = {
  MEMORY_TOKEN_PREFIX: TOKEN_PREFIX,
  MemoryTokenError,
  issueMemoryToken,
  verifyMemoryToken,
  verifyMemoryTokenWithRotation
};
