'use strict';

const { createClient } = require('redis');
const { assertRecordSize } = require('./record');
const {
  DEFAULT_STORE_TIMEOUT_MS,
  MAX_REQUEST_INDEX_SIZE,
  MemoryStore,
  MemoryStoreError,
  assertRequestId,
  assertTokenDigest
} = require('./store');

const GET_AND_REFRESH_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value
`;

const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  return cjson.encode({status = 'missing'})
end
local decoded = cjson.decode(current)
if tonumber(decoded.version) ~= tonumber(ARGV[1]) then
  return cjson.encode({status = 'conflict', currentVersion = decoded.version})
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return cjson.encode({status = 'updated'})
`;

const BEGIN_REQUEST_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return cjson.encode({status = 'missing'})
end
local existing = redis.call('GET', KEYS[2])
if existing then
  return cjson.encode({status = 'existing', request = existing})
end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('LPUSH', KEYS[3], ARGV[3])
redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[4]) - 1)
redis.call('EXPIRE', KEYS[3], ARGV[2])
return cjson.encode({status = 'started', request = ARGV[1]})
`;

const COMPLETE_REQUEST_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then
  return cjson.encode({status = 'missing'})
end
local decoded = cjson.decode(existing)
if decoded.status == 'completed' then
  return cjson.encode({status = 'existing', request = existing})
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return cjson.encode({status = 'completed'})
`;

const DELETE_MEMORY_SCRIPT = `
local existed = redis.call('EXISTS', KEYS[1])
local requestIds = redis.call('LRANGE', KEYS[2], 0, tonumber(ARGV[2]) - 1)
for _, requestId in ipairs(requestIds) do
  redis.call('DEL', ARGV[1] .. requestId)
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return existed
`;

function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  return JSON.parse(value);
}

function mapStoreError(error) {
  if (error instanceof MemoryStoreError) return error;
  const message = String(error && error.message || '').toLowerCase();
  if (message.includes('unauthorized') || message.includes('auth') || message.includes('token')) {
    return new MemoryStoreError('Memory storage authentication failed', 'MEMORY_STORE_AUTH');
  }
  return new MemoryStoreError('Memory storage is temporarily unavailable', 'MEMORY_STORE_UNAVAILABLE');
}

function withTimeout(operation, timeoutMs) {
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new MemoryStoreError('Memory storage timed out', 'MEMORY_STORE_TIMEOUT'));
    }, timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timeout));
}

function nodeRedisSetOptions(options) {
  const source = options || {};
  const normalized = {};
  if (source.nx || source.NX) normalized.NX = true;
  if (source.xx || source.XX) normalized.XX = true;
  if (source.ex || source.EX) normalized.EX = Number(source.ex || source.EX);
  return normalized;
}

function createRedisUrlClient(options) {
  const settings = options || {};
  const clientFactory = settings.clientFactory || createClient;
  const rawClient = clientFactory({
    url: settings.url,
    socket: {
      connectTimeout: Number(settings.timeoutMs) || DEFAULT_STORE_TIMEOUT_MS
    }
  });
  let connecting;

  // node-redis requires an error listener. Command failures are still propagated
  // to the caller and mapped to bounded, provider-neutral MemoryStore errors.
  rawClient.on('error', () => {});

  async function ready() {
    if (rawClient.isReady) return rawClient;
    if (!rawClient.isOpen) {
      if (!connecting) {
        connecting = rawClient.connect().finally(() => {
          connecting = undefined;
        });
      }
      await connecting;
    }
    return rawClient;
  }

  return {
    async set(key, value, setOptions) {
      const client = await ready();
      return client.set(key, value, nodeRedisSetOptions(setOptions));
    },
    async get(key) {
      const client = await ready();
      return client.get(key);
    },
    async eval(script, keys, args) {
      const client = await ready();
      return client.eval(script, {
        keys,
        arguments: args
      });
    }
  };
}

class RedisMemoryStore extends MemoryStore {
  constructor(options) {
    const settings = options || {};
    super('redis');
    this.timeoutMs = Number(settings.timeoutMs) || DEFAULT_STORE_TIMEOUT_MS;
    this.client = settings.client || createRedisUrlClient({
      url: settings.url,
      timeoutMs: this.timeoutMs,
      clientFactory: settings.clientFactory
    });
  }

  memoryKey(tokenDigest) {
    assertTokenDigest(tokenDigest);
    return `memory:v1:${tokenDigest}`;
  }

  requestKey(tokenDigest, requestId) {
    assertTokenDigest(tokenDigest);
    assertRequestId(requestId);
    return `request:v1:${tokenDigest}:${requestId}`;
  }

  requestIndexKey(tokenDigest) {
    assertTokenDigest(tokenDigest);
    return `request-index:v1:${tokenDigest}`;
  }

  async execute(operation) {
    try {
      return await withTimeout(
        Promise.resolve().then(operation),
        this.timeoutMs
      );
    } catch (error) {
      throw mapStoreError(error);
    }
  }

  async create(tokenDigest, record, ttlSeconds) {
    assertRecordSize(record);
    const result = await this.execute(() => this.client.set(
      this.memoryKey(tokenDigest),
      JSON.stringify(record),
      { nx: true, ex: ttlSeconds }
    ));
    return result === 'OK';
  }

  async get(tokenDigest, ttlSeconds) {
    const value = await this.execute(() => this.client.eval(
      GET_AND_REFRESH_SCRIPT,
      [this.memoryKey(tokenDigest)],
      [String(ttlSeconds)]
    ));
    return parseJson(value);
  }

  async compareAndSet(tokenDigest, expectedVersion, nextRecord, ttlSeconds) {
    assertRecordSize(nextRecord);
    if (nextRecord.version !== expectedVersion + 1) {
      throw new MemoryStoreError(
        'Invalid memory record version',
        'MEMORY_VERSION_INVALID',
        { statusCode: 400, retryable: false }
      );
    }
    const result = parseJson(await this.execute(() => this.client.eval(
      CAS_SCRIPT,
      [this.memoryKey(tokenDigest)],
      [String(expectedVersion), JSON.stringify(nextRecord), String(ttlSeconds)]
    )));
    return result && result.status === 'updated'
      ? { status: 'updated', record: nextRecord }
      : result;
  }

  async delete(tokenDigest) {
    const result = await this.execute(() => this.client.eval(
      DELETE_MEMORY_SCRIPT,
      [this.memoryKey(tokenDigest), this.requestIndexKey(tokenDigest)],
      [`request:v1:${tokenDigest}:`, String(MAX_REQUEST_INDEX_SIZE)]
    ));
    return Number(result) === 1;
  }

  async beginRequest(tokenDigest, requestId, ttlSeconds) {
    const request = {
      status: 'processing',
      requestId,
      createdAt: new Date().toISOString()
    };
    const result = parseJson(await this.execute(() => this.client.eval(
      BEGIN_REQUEST_SCRIPT,
      [
        this.memoryKey(tokenDigest),
        this.requestKey(tokenDigest, requestId),
        this.requestIndexKey(tokenDigest)
      ],
      [
        JSON.stringify(request),
        String(ttlSeconds),
        requestId,
        String(MAX_REQUEST_INDEX_SIZE)
      ]
    )));
    if (!result || result.status === 'missing') return { status: 'missing' };
    const stored = parseJson(result.request);
    return result.status === 'started'
      ? Object.assign({ started: true }, stored)
      : stored;
  }

  async completeRequest(tokenDigest, requestId, responseSnapshot, ttlSeconds) {
    const previous = await this.getRequest(tokenDigest, requestId);
    if (!previous) return { status: 'missing' };
    if (previous.status === 'completed') return previous;
    let completed = {
      status: 'completed',
      requestId,
      createdAt: previous.createdAt,
      completedAt: new Date().toISOString(),
      responseSnapshot
    };
    if (Buffer.byteLength(JSON.stringify(completed), 'utf8') > 32 * 1024) {
      completed = {
        status: 'completed',
        requestId,
        createdAt: previous.createdAt,
        completedAt: new Date().toISOString(),
        replayUnavailable: true,
        responseSummary: { statusCode: 200 }
      };
    }
    const result = parseJson(await this.execute(() => this.client.eval(
      COMPLETE_REQUEST_SCRIPT,
      [this.requestKey(tokenDigest, requestId)],
      [JSON.stringify(completed), String(ttlSeconds)]
    )));
    if (!result || result.status === 'missing') return { status: 'missing' };
    if (result.status === 'existing') return parseJson(result.request);
    return completed;
  }

  async getRequest(tokenDigest, requestId) {
    const value = await this.execute(() => this.client.get(
      this.requestKey(tokenDigest, requestId)
    ));
    return parseJson(value);
  }
}

function createRedisMemoryStore(options) {
  const settings = options || {};
  if (!settings.client && !settings.url) {
    throw new MemoryStoreError(
      'Memory storage is not configured',
      'MEMORY_STORE_CONFIGURATION'
    );
  }
  return new RedisMemoryStore(settings);
}

module.exports = {
  RedisMemoryStore,
  createRedisUrlClient,
  createRedisMemoryStore
};
