'use strict';

const { MEMORY_LIMITS, assertRecordSize } = require('./record');

const DEFAULT_MEMORY_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_REQUEST_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_STORE_TIMEOUT_MS = 800;
const MAX_REQUEST_INDEX_SIZE = 64;

class MemoryStoreError extends Error {
  constructor(message, code, options) {
    super(message);
    this.name = 'MemoryStoreError';
    this.code = code || 'MEMORY_STORE_UNAVAILABLE';
    this.statusCode = options && options.statusCode || 503;
    this.retryable = !options || options.retryable !== false;
  }
}

class MemoryStore {
  constructor(kind) {
    this.kind = kind || 'abstract';
  }

  notImplemented() {
    throw new MemoryStoreError(
      'MemoryStore method is not implemented',
      'MEMORY_STORE_NOT_IMPLEMENTED',
      { statusCode: 500, retryable: false }
    );
  }

  async create() { return this.notImplemented(); }
  async get() { return this.notImplemented(); }
  async compareAndSet() { return this.notImplemented(); }
  async delete() { return this.notImplemented(); }
  async beginRequest() { return this.notImplemented(); }
  async completeRequest() { return this.notImplemented(); }
  async getRequest() { return this.notImplemented(); }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertTokenDigest(tokenDigest) {
  if (typeof tokenDigest !== 'string' || !/^[a-f0-9]{64}$/.test(tokenDigest)) {
    throw new MemoryStoreError(
      'Invalid memory storage key',
      'MEMORY_STORE_KEY_INVALID',
      { statusCode: 400, retryable: false }
    );
  }
}

function assertRequestId(requestId) {
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    throw new MemoryStoreError(
      'Invalid requestId',
      'MEMORY_REQUEST_ID_INVALID',
      { statusCode: 400, retryable: false }
    );
  }
}

function assertRequestSize(request) {
  const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
  if (bytes > MEMORY_LIMITS.maxRecordBytes) {
    throw new MemoryStoreError(
      'Memory request snapshot exceeds the storage limit',
      'MEMORY_REQUEST_TOO_LARGE',
      { statusCode: 400, retryable: false }
    );
  }
}

class DisabledMemoryStore extends MemoryStore {
  constructor(reason) {
    super('disabled');
    this.reason = reason || 'disabled';
  }

  unavailable() {
    throw new MemoryStoreError(
      'Memory storage is not available',
      'MEMORY_STORE_DISABLED'
    );
  }

  async create() { return this.unavailable(); }
  async get() { return this.unavailable(); }
  async compareAndSet() { return this.unavailable(); }
  async delete() { return this.unavailable(); }
  async beginRequest() { return this.unavailable(); }
  async completeRequest() { return this.unavailable(); }
  async getRequest() { return this.unavailable(); }
}

class InMemoryMemoryStore extends MemoryStore {
  constructor(options) {
    super('memory');
    const settings = options || {};
    this.now = settings.now || (() => Date.now());
    this.records = new Map();
    this.requests = new Map();
    this.requestIndexes = new Map();
  }

  recordEntry(tokenDigest) {
    const entry = this.records.get(tokenDigest);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.records.delete(tokenDigest);
      return null;
    }
    return entry;
  }

  requestKey(tokenDigest, requestId) {
    return `${tokenDigest}:${requestId}`;
  }

  requestEntry(tokenDigest, requestId) {
    const key = this.requestKey(tokenDigest, requestId);
    const entry = this.requests.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.requests.delete(key);
      return null;
    }
    return entry;
  }

  async create(tokenDigest, record, ttlSeconds) {
    assertTokenDigest(tokenDigest);
    assertRecordSize(record);
    if (this.recordEntry(tokenDigest)) return false;
    this.records.set(tokenDigest, {
      value: clone(record),
      expiresAt: this.now() + ttlSeconds * 1000
    });
    return true;
  }

  async get(tokenDigest, ttlSeconds) {
    assertTokenDigest(tokenDigest);
    const entry = this.recordEntry(tokenDigest);
    if (!entry) return null;
    if (ttlSeconds) entry.expiresAt = this.now() + ttlSeconds * 1000;
    return clone(entry.value);
  }

  async compareAndSet(tokenDigest, expectedVersion, nextRecord, ttlSeconds) {
    assertTokenDigest(tokenDigest);
    assertRecordSize(nextRecord);
    const entry = this.recordEntry(tokenDigest);
    if (!entry) return { status: 'missing' };
    if (entry.value.version !== expectedVersion) {
      return { status: 'conflict', currentVersion: entry.value.version };
    }
    if (nextRecord.version !== expectedVersion + 1) {
      throw new MemoryStoreError(
        'Invalid memory record version',
        'MEMORY_VERSION_INVALID',
        { statusCode: 400, retryable: false }
      );
    }
    entry.value = clone(nextRecord);
    entry.expiresAt = this.now() + ttlSeconds * 1000;
    return { status: 'updated', record: clone(nextRecord) };
  }

  async delete(tokenDigest) {
    assertTokenDigest(tokenDigest);
    const existed = this.records.delete(tokenDigest);
    const index = this.requestIndexes.get(tokenDigest) || [];
    for (const requestId of index) {
      this.requests.delete(this.requestKey(tokenDigest, requestId));
    }
    this.requestIndexes.delete(tokenDigest);
    return existed;
  }

  async beginRequest(tokenDigest, requestId, ttlSeconds) {
    assertTokenDigest(tokenDigest);
    assertRequestId(requestId);
    if (!this.recordEntry(tokenDigest)) return { status: 'missing' };

    const existing = this.requestEntry(tokenDigest, requestId);
    if (existing) return clone(existing.value);

    const request = {
      status: 'processing',
      requestId,
      createdAt: new Date(this.now()).toISOString()
    };
    this.requests.set(this.requestKey(tokenDigest, requestId), {
      value: request,
      expiresAt: this.now() + ttlSeconds * 1000
    });
    const index = (this.requestIndexes.get(tokenDigest) || [])
      .filter(value => value !== requestId);
    index.unshift(requestId);
    this.requestIndexes.set(tokenDigest, index.slice(0, MAX_REQUEST_INDEX_SIZE));
    return Object.assign({ started: true }, clone(request));
  }

  async completeRequest(tokenDigest, requestId, responseSnapshot, ttlSeconds) {
    assertTokenDigest(tokenDigest);
    assertRequestId(requestId);
    const existing = this.requestEntry(tokenDigest, requestId);
    if (!existing) return { status: 'missing' };
    if (existing.value.status === 'completed') return clone(existing.value);

    let completed = {
      status: 'completed',
      requestId,
      createdAt: existing.value.createdAt,
      completedAt: new Date(this.now()).toISOString(),
      responseSnapshot: clone(responseSnapshot)
    };
    try {
      assertRequestSize(completed);
    } catch (error) {
      if (!(error instanceof MemoryStoreError) || error.code !== 'MEMORY_REQUEST_TOO_LARGE') {
        throw error;
      }
      completed = {
        status: 'completed',
        requestId,
        createdAt: existing.value.createdAt,
        completedAt: new Date(this.now()).toISOString(),
        replayUnavailable: true,
        responseSummary: { statusCode: 200 }
      };
    }
    existing.value = completed;
    existing.expiresAt = this.now() + ttlSeconds * 1000;
    return clone(completed);
  }

  async getRequest(tokenDigest, requestId) {
    assertTokenDigest(tokenDigest);
    assertRequestId(requestId);
    const entry = this.requestEntry(tokenDigest, requestId);
    return entry ? clone(entry.value) : null;
  }
}

module.exports = {
  DEFAULT_MEMORY_TTL_SECONDS,
  DEFAULT_REQUEST_TTL_SECONDS,
  DEFAULT_STORE_TIMEOUT_MS,
  MAX_REQUEST_INDEX_SIZE,
  DisabledMemoryStore,
  InMemoryMemoryStore,
  MemoryStore,
  MemoryStoreError,
  assertRequestId,
  assertTokenDigest
};
