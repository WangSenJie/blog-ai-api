'use strict';

const {
  MemoryRecordError,
  appendTurn,
  createMemoryRecord,
  publicSession,
  startNewThread,
  trustedMemoryContext,
  trustedMessages
} = require('./record');
const { createRedisMemoryStore } = require('./redis-store');
const {
  DEFAULT_MEMORY_TTL_SECONDS,
  DEFAULT_REQUEST_TTL_SECONDS,
  DisabledMemoryStore,
  MemoryStoreError
} = require('./store');
const {
  MemoryTokenError,
  issueMemoryToken,
  verifyMemoryTokenWithRotation
} = require('./token');
const { getReleaseFlags } = require('../lib/release-flags');

const DEFAULT_SERVICE_BUDGET_MS = 1500;
const MAX_CREATE_ATTEMPTS = 3;
const MAX_CAS_ATTEMPTS = 2;

class MemoryServiceError extends Error {
  constructor(message, statusCode, code, options) {
    super(message);
    this.name = 'MemoryServiceError';
    this.statusCode = statusCode || 500;
    this.code = code || 'MEMORY_SERVICE_ERROR';
    this.retryAfter = options && options.retryAfter;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function positiveInteger(value, fallback, limits) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  if (limits && (parsed < limits.min || parsed > limits.max)) return fallback;
  return parsed;
}

function memoryEnvironmentIsolation(environment) {
  const source = environment || process.env;
  const runtime = String(source.VERCEL_ENV || '').trim().toLowerCase();
  const declaredScope = String(
    source.MEMORY_ENVIRONMENT_SCOPE || ''
  ).trim().toLowerCase();
  const required = runtime === 'preview' || runtime === 'development';
  return {
    runtime: runtime || 'local',
    declaredScope,
    required,
    allowed: !required || declaredScope === runtime
  };
}

function unavailableError() {
  return new MemoryServiceError(
    'Memory service is temporarily unavailable',
    503,
    'MEMORY_SERVICE_UNAVAILABLE'
  );
}

function mapTokenError(error) {
  if (!(error instanceof MemoryTokenError)) return error;
  return new MemoryServiceError(error.message, error.statusCode, error.code);
}

function sessionGone() {
  return new MemoryServiceError(
    'Memory session is no longer available',
    410,
    'MEMORY_SESSION_GONE'
  );
}

function versionConflict() {
  return new MemoryServiceError(
    'Memory version conflict',
    409,
    'MEMORY_VERSION_CONFLICT'
  );
}

function requestProcessing() {
  return new MemoryServiceError(
    'The same request is still processing',
    409,
    'MEMORY_REQUEST_PROCESSING',
    { retryAfter: 1 }
  );
}

function replayUnavailable() {
  return new MemoryServiceError(
    'The completed response is too large to replay; use a new requestId',
    409,
    'MEMORY_REPLAY_UNAVAILABLE'
  );
}

function expiresAt(now, ttlSeconds) {
  return new Date(now + ttlSeconds * 1000).toISOString();
}

function withBudget(operation, budgetMs) {
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(unavailableError()), budgetMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timeout));
}

class MemoryService {
  constructor(options) {
    const settings = options || {};
    this.enabled = settings.enabled !== false;
    this.store = settings.store || new DisabledMemoryStore();
    this.tokenSecret = settings.tokenSecret;
    this.keySecret = settings.keySecret;
    this.previousTokenSecret = settings.previousTokenSecret;
    this.previousKeySecret = settings.previousKeySecret;
    this.memoryTtlSeconds = positiveInteger(
      settings.memoryTtlSeconds,
      DEFAULT_MEMORY_TTL_SECONDS
    );
    this.requestTtlSeconds = positiveInteger(
      settings.requestTtlSeconds,
      DEFAULT_REQUEST_TTL_SECONDS
    );
    this.serviceBudgetMs = positiveInteger(
      settings.serviceBudgetMs,
      DEFAULT_SERVICE_BUDGET_MS
    );
    this.now = settings.now || (() => Date.now());
    this.unavailableReason = settings.unavailableReason || '';
  }

  tokenOptions() {
    return {
      tokenSecret: this.tokenSecret,
      keySecret: this.keySecret,
      previousTokenSecret: this.previousTokenSecret,
      previousKeySecret: this.previousKeySecret
    };
  }

  ensureAvailable() {
    if (!this.enabled || this.store.kind === 'disabled') throw unavailableError();
  }

  verify(token) {
    try {
      return verifyMemoryTokenWithRotation(token, this.tokenOptions());
    } catch (error) {
      throw mapTokenError(error);
    }
  }

  issue() {
    try {
      return issueMemoryToken(this.tokenOptions());
    } catch (error) {
      throw mapTokenError(error);
    }
  }

  async createSession() {
    this.ensureAvailable();
    return withBudget((async () => {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const issued = this.issue();
        const record = createMemoryRecord({
          now: this.now(),
          ttlSeconds: this.memoryTtlSeconds
        });
        if (await this.store.create(
          issued.tokenDigest,
          record,
          this.memoryTtlSeconds
        )) {
          return {
            created: true,
            memoryToken: issued.token,
            session: publicSession(record, this.memoryTtlSeconds, this.now())
          };
        }
      }
      throw new MemoryServiceError(
        'Unable to allocate memory session',
        503,
        'MEMORY_SESSION_ALLOCATION_FAILED'
      );
    })(), this.serviceBudgetMs);
  }

  async restoreSession(memoryToken) {
    this.ensureAvailable();
    const { tokenDigest } = this.verify(memoryToken);
    return withBudget((async () => {
      const record = await this.store.get(tokenDigest, this.memoryTtlSeconds);
      if (!record) throw sessionGone();
      return {
        created: false,
        memoryToken,
        session: publicSession(record, this.memoryTtlSeconds, this.now())
      };
    })(), this.serviceBudgetMs);
  }

  async deleteSession(memoryToken) {
    this.ensureAvailable();
    const { tokenDigest } = this.verify(memoryToken);
    await withBudget(
      this.store.delete(tokenDigest),
      this.serviceBudgetMs
    );
  }

  async createThread(input) {
    this.ensureAvailable();
    const { tokenDigest } = this.verify(input.memoryToken);
    return withBudget((async () => {
      const record = await this.store.get(tokenDigest, this.memoryTtlSeconds);
      if (!record) throw sessionGone();
      const existingRequest = await this.store.getRequest(tokenDigest, input.requestId);
      if (existingRequest && existingRequest.status === 'completed') {
        if (!existingRequest.responseSnapshot) throw replayUnavailable();
        return Object.assign({}, existingRequest.responseSnapshot, { replayed: true });
      }
      if (existingRequest && existingRequest.status === 'processing') {
        throw requestProcessing();
      }

      if (
        record.activeThread.threadId !== input.currentThreadId ||
        input.expectedMemoryVersion > record.version
      ) {
        throw versionConflict();
      }

      const request = await this.store.beginRequest(
        tokenDigest,
        input.requestId,
        this.requestTtlSeconds
      );
      if (request.status === 'missing') throw sessionGone();
      if (!request.started) {
        if (request.status === 'completed') {
          if (!request.responseSnapshot) throw replayUnavailable();
          return Object.assign({}, request.responseSnapshot, { replayed: true });
        }
        throw requestProcessing();
      }

      let current = record;
      let next;
      let updated = false;
      for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
        if (current.activeThread.threadId !== input.currentThreadId) {
          throw versionConflict();
        }
        next = startNewThread(current, {
          now: this.now(),
          ttlSeconds: this.memoryTtlSeconds
        });
        const result = await this.store.compareAndSet(
          tokenDigest,
          current.version,
          next,
          this.memoryTtlSeconds
        );
        if (result.status === 'updated') {
          updated = true;
          break;
        }
        if (result.status === 'missing') throw sessionGone();
        current = await this.store.get(tokenDigest, this.memoryTtlSeconds);
        if (!current) throw sessionGone();
      }
      if (!updated) throw versionConflict();

      const response = {
        replayed: false,
        session: publicSession(next, this.memoryTtlSeconds, this.now())
      };
      await this.store.completeRequest(
        tokenDigest,
        input.requestId,
        response,
        this.requestTtlSeconds
      );
      return response;
    })(), this.serviceBudgetMs);
  }

  async prepareAsk(input) {
    if (!input.memoryToken) {
      return {
        status: 'disabled',
        writeStatus: 'not_attempted',
        reason: 'not_requested'
      };
    }
    if (!this.enabled || this.store.kind === 'disabled') {
      return {
        status: 'degraded',
        writeStatus: 'not_attempted',
        reason: 'storage_unavailable'
      };
    }

    let tokenDigest;
    try {
      tokenDigest = this.verify(input.memoryToken).tokenDigest;
    } catch (error) {
      throw error;
    }

    try {
      return await withBudget((async () => {
        const record = await this.store.get(tokenDigest, this.memoryTtlSeconds);
        if (!record) throw sessionGone();
        const existingRequest = await this.store.getRequest(tokenDigest, input.requestId);
        if (existingRequest && existingRequest.status === 'completed') {
          if (!existingRequest.responseSnapshot) throw replayUnavailable();
          const savedMemory = existingRequest.responseSnapshot.memory || {};
          return {
            status: 'active',
            writeStatus: 'duplicate',
            replayed: true,
            threadId: savedMemory.threadId || record.activeThread.threadId,
            version: savedMemory.version || record.version,
            expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
            responseSnapshot: clone(existingRequest.responseSnapshot)
          };
        }
        if (existingRequest && existingRequest.status === 'processing') {
          throw requestProcessing();
        }

        if (
          record.activeThread.threadId !== input.threadId ||
          record.version !== input.expectedMemoryVersion
        ) {
          throw versionConflict();
        }

        const request = await this.store.beginRequest(
          tokenDigest,
          input.requestId,
          this.requestTtlSeconds
        );
        if (request.status === 'missing') throw sessionGone();
        if (!request.started) {
          if (request.status === 'completed') {
            if (!request.responseSnapshot) throw replayUnavailable();
            return {
              status: 'active',
              writeStatus: 'duplicate',
              replayed: true,
              threadId: record.activeThread.threadId,
              version: record.version,
              expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
              responseSnapshot: clone(request.responseSnapshot)
            };
          }
          throw requestProcessing();
        }

        return {
          status: 'active',
          writeStatus: 'pending',
          replayed: false,
          tokenDigest,
          requestId: input.requestId,
          threadId: record.activeThread.threadId,
          version: record.version,
          expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
          record,
          trustedMessages: trustedMessages(record),
          trustedMemory: trustedMemoryContext(record)
        };
      })(), this.serviceBudgetMs);
    } catch (error) {
      if (error instanceof MemoryStoreError || (
        error instanceof MemoryServiceError && error.statusCode === 503
      )) {
        return {
          status: 'degraded',
          writeStatus: 'not_attempted',
          reason: 'storage_unavailable'
        };
      }
      throw error;
    }
  }

  async completeAsk(context, input, payload, memoryDelta) {
    if (!context || context.status !== 'active' || context.replayed) {
      return context || {
        status: 'disabled',
        writeStatus: 'not_attempted'
      };
    }

    let finalizedMemory;
    try {
      return await withBudget((async () => {
        let record = context.record;
        let memoryResult;
        for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
          if (record.activeThread.threadId !== context.threadId) {
            memoryResult = {
              status: 'active',
              writeStatus: 'stale_thread',
              threadId: record.activeThread.threadId,
              version: record.version,
              expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
              replayed: false
            };
            break;
          }
          if ((record.activeThread.recentMessages || []).some(
            message => message.requestId === context.requestId
          )) {
            memoryResult = {
              status: 'active',
              writeStatus: 'committed',
              threadId: record.activeThread.threadId,
              version: record.version,
              expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
              replayed: false
            };
            break;
          }
          let next;
          try {
            next = appendTurn(record, input, payload, {
              now: this.now(),
              ttlSeconds: this.memoryTtlSeconds,
              requestId: context.requestId,
              memoryDelta
            });
          } catch (error) {
            if (
              error instanceof MemoryRecordError &&
              error.code === 'MEMORY_RECORD_TOO_LARGE'
            ) {
              memoryResult = {
                status: 'active',
                writeStatus: 'size_limit',
                threadId: record.activeThread.threadId,
                version: record.version,
                expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
                replayed: false
              };
              break;
            }
            throw error;
          }
          const result = await this.store.compareAndSet(
            context.tokenDigest,
            record.version,
            next,
            this.memoryTtlSeconds
          );
          if (result.status === 'updated') {
            memoryResult = {
              status: 'active',
              writeStatus: 'committed',
              threadId: next.activeThread.threadId,
              version: next.version,
              expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
              replayed: false
            };
            break;
          }
          if (result.status === 'missing') throw sessionGone();
          record = await this.store.get(
            context.tokenDigest,
            this.memoryTtlSeconds
          );
          if (!record) throw sessionGone();
        }

        if (!memoryResult) {
          memoryResult = {
            status: 'active',
            writeStatus: 'version_conflict',
            threadId: record.activeThread.threadId,
            version: record.version,
            expiresAt: expiresAt(this.now(), this.memoryTtlSeconds),
            replayed: false
          };
        }
        finalizedMemory = memoryResult;

        const snapshot = clone(payload);
        snapshot.memory = clone(memoryResult);
        const completed = await this.store.completeRequest(
          context.tokenDigest,
          context.requestId,
          snapshot,
          this.requestTtlSeconds
        );
        if (completed.status === 'missing') {
          return Object.assign({}, memoryResult, {
            status: 'degraded',
            reason: 'request_state_missing'
          });
        }
        return memoryResult;
      })(), this.serviceBudgetMs);
    } catch (error) {
      if (
        error instanceof MemoryStoreError ||
        (error instanceof MemoryServiceError && error.statusCode >= 500)
      ) {
        if (finalizedMemory) {
          return Object.assign({}, finalizedMemory, {
            status: 'degraded',
            reason: 'request_completion_failed'
          });
        }
        return {
          status: 'degraded',
          writeStatus: 'failed',
          reason: 'storage_unavailable'
        };
      }
      return {
        status: 'active',
        writeStatus: 'failed',
        reason: 'memory_update_rejected'
      };
    }
  }
}

function createMemoryService(options) {
  return new MemoryService(options);
}

function createMemoryServiceFromEnvironment(environment) {
  const source = environment || process.env;
  const enabled = getReleaseFlags(source).memoryV1Enabled;
  if (!enabled) {
    return new MemoryService({
      enabled: false,
      store: new DisabledMemoryStore('disabled')
    });
  }

  const isolation = memoryEnvironmentIsolation(source);
  if (!isolation.allowed) {
    return new MemoryService({
      enabled: false,
      store: new DisabledMemoryStore('environment_isolation_required'),
      unavailableReason: 'environment_isolation_required'
    });
  }

  try {
    issueMemoryToken({
      tokenSecret: source.MEMORY_TOKEN_SECRET,
      keySecret: source.MEMORY_KEY_SECRET,
      randomBytes: () => Buffer.alloc(32)
    });
    if (
      String(source.MEMORY_TOKEN_SECRET_PREVIOUS || '').trim() ||
      String(source.MEMORY_KEY_SECRET_PREVIOUS || '').trim()
    ) {
      issueMemoryToken({
        tokenSecret: source.MEMORY_TOKEN_SECRET_PREVIOUS ||
          source.MEMORY_TOKEN_SECRET,
        keySecret: source.MEMORY_KEY_SECRET_PREVIOUS ||
          source.MEMORY_KEY_SECRET,
        randomBytes: () => Buffer.alloc(32, 1)
      });
    }
    const store = createRedisMemoryStore({
      url: source.REDIS_URL,
      timeoutMs: positiveInteger(source.MEMORY_STORE_TIMEOUT_MS, 800)
    });
    return new MemoryService({
      enabled: true,
      store,
      tokenSecret: source.MEMORY_TOKEN_SECRET,
      keySecret: source.MEMORY_KEY_SECRET,
      previousTokenSecret: source.MEMORY_TOKEN_SECRET_PREVIOUS,
      previousKeySecret: source.MEMORY_KEY_SECRET_PREVIOUS,
      memoryTtlSeconds: positiveInteger(
        source.MEMORY_TTL_SECONDS,
        DEFAULT_MEMORY_TTL_SECONDS,
        { min: 60, max: 90 * 24 * 60 * 60 }
      ),
      requestTtlSeconds: positiveInteger(
        source.MEMORY_REQUEST_TTL_SECONDS,
        DEFAULT_REQUEST_TTL_SECONDS,
        { min: 60, max: 7 * 24 * 60 * 60 }
      ),
      serviceBudgetMs: positiveInteger(
        source.MEMORY_SERVICE_BUDGET_MS,
        DEFAULT_SERVICE_BUDGET_MS,
        { min: 100, max: 5000 }
      )
    });
  } catch (error) {
    return new MemoryService({
      enabled: false,
      store: new DisabledMemoryStore('misconfigured'),
      unavailableReason: 'misconfigured'
    });
  }
}

let cachedService;

function getMemoryService() {
  if (!cachedService) cachedService = createMemoryServiceFromEnvironment();
  return cachedService;
}

function resetMemoryServiceForTests() {
  cachedService = undefined;
}

module.exports = {
  DEFAULT_SERVICE_BUDGET_MS,
  MemoryService,
  MemoryServiceError,
  createMemoryService,
  createMemoryServiceFromEnvironment,
  getMemoryService,
  memoryEnvironmentIsolation,
  resetMemoryServiceForTests
};
