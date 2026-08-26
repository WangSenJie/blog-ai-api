'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('crypto');

const { createMemoryRecord } = require('../memory/record');
const {
  RedisMemoryStore,
  createRedisUrlClient
} = require('../memory/redis-store');
const { issueMemoryToken } = require('../memory/token');
const {
  InMemoryMemoryStore,
  MAX_REQUEST_INDEX_SIZE,
  MemoryStoreError
} = require('../memory/store');

const DIGEST = 'a'.repeat(64);

test('REDIS_URL adapter connects lazily and maps commands to node-redis', async () => {
  const calls = [];
  const rawClient = {
    isOpen: false,
    isReady: false,
    on(event) {
      calls.push({ name: 'on', event });
    },
    async connect() {
      calls.push({ name: 'connect' });
      this.isOpen = true;
      this.isReady = true;
      return this;
    },
    async set(...args) {
      calls.push({ name: 'set', args });
      return 'OK';
    },
    async get(key) {
      calls.push({ name: 'get', key });
      return 'value';
    },
    async eval(script, options) {
      calls.push({ name: 'eval', script, options });
      return 'result';
    }
  };
  let clientOptions;
  const client = createRedisUrlClient({
    url: 'rediss://default:secret@example.redis.cloud:6379',
    timeoutMs: 250,
    clientFactory(options) {
      clientOptions = options;
      return rawClient;
    }
  });

  assert.equal(await client.set('key', 'value', { nx: true, ex: 60 }), 'OK');
  assert.equal(await client.get('key'), 'value');
  assert.equal(await client.eval('return 1', ['key'], ['arg']), 'result');
  assert.deepEqual(clientOptions, {
    url: 'rediss://default:secret@example.redis.cloud:6379',
    socket: { connectTimeout: 250 }
  });
  assert.equal(calls.filter(call => call.name === 'connect').length, 1);
  assert.deepEqual(calls.find(call => call.name === 'set').args[2], {
    NX: true,
    EX: 60
  });
  assert.deepEqual(calls.find(call => call.name === 'eval').options, {
    keys: ['key'],
    arguments: ['arg']
  });
});

test('in-memory store implements rolling TTL, CAS, idempotency, and bounded deletion', async () => {
  let now = Date.parse('2026-08-25T00:00:00.000Z');
  const store = new InMemoryMemoryStore({ now: () => now });
  const record = createMemoryRecord({ now, ttlSeconds: 10 });

  assert.equal(await store.create(DIGEST, record, 10), true);
  assert.equal(await store.create(DIGEST, record, 10), false);
  now += 9000;
  assert.equal((await store.get(DIGEST, 10)).version, 1);
  now += 9000;
  assert.equal((await store.get(DIGEST, 10)).version, 1);

  const next = JSON.parse(JSON.stringify(record));
  next.version = 2;
  assert.equal(
    (await store.compareAndSet(DIGEST, 1, next, 10)).status,
    'updated'
  );
  assert.deepEqual(
    await store.compareAndSet(DIGEST, 1, next, 10),
    { status: 'conflict', currentVersion: 2 }
  );

  const requestId = randomUUID();
  const started = await store.beginRequest(DIGEST, requestId, 20);
  assert.equal(started.started, true);
  assert.equal((await store.beginRequest(DIGEST, requestId, 20)).status, 'processing');
  await store.completeRequest(DIGEST, requestId, { answer: 'ok' }, 20);
  const replay = await store.beginRequest(DIGEST, requestId, 20);
  assert.equal(replay.status, 'completed');
  assert.deepEqual(replay.responseSnapshot, { answer: 'ok' });

  for (let index = 0; index < MAX_REQUEST_INDEX_SIZE + 5; index += 1) {
    await store.beginRequest(DIGEST, randomUUID(), 20);
  }
  assert.equal(store.requestIndexes.get(DIGEST).length, MAX_REQUEST_INDEX_SIZE);
  assert.equal(await store.delete(DIGEST), true);
  assert.equal(await store.get(DIGEST, 10), null);
  assert.equal(store.requestIndexes.has(DIGEST), false);
});

test('Redis keys contain only the keyed digest and operations never need a key scan', async () => {
  const calls = [];
  const client = {
    async set(...args) {
      calls.push({ name: 'set', args });
      return 'OK';
    },
    async eval(script, keys, args) {
      calls.push({ name: 'eval', keys, args });
      if (script.includes("local value = redis.call('GET'")) {
        return JSON.stringify({ version: 1 });
      }
      if (script.includes("local current = redis.call('GET'")) {
        return JSON.stringify({ status: 'updated' });
      }
      if (script.includes("redis.call('LPUSH'")) {
        return JSON.stringify({
          status: 'started',
          request: args[0]
        });
      }
      if (script.includes("decoded.status == 'completed'")) {
        return JSON.stringify({ status: 'completed' });
      }
      return 1;
    },
    async get(key) {
      calls.push({ name: 'get', key });
      return key.startsWith('request:v1:')
        ? JSON.stringify({
          status: 'processing',
          requestId: key.slice(key.lastIndexOf(':') + 1),
          createdAt: '2026-08-25T00:00:00.000Z'
        })
        : null;
    }
  };
  const issued = issueMemoryToken({
    tokenSecret: 'store-token-secret-1234567890-abcdef',
    keySecret: 'store-key-secret-abcdef-0987654321',
    randomBytes: () => Buffer.alloc(32, 11)
  });
  const rawToken = issued.token;
  const digest = issued.tokenDigest;
  const store = new RedisMemoryStore({ client, timeoutMs: 50 });
  const record = createMemoryRecord({ now: Date.now(), ttlSeconds: 60 });

  await store.create(digest, record, 60);
  await store.get(digest, 60);
  const next = JSON.parse(JSON.stringify(record));
  next.version = 2;
  await store.compareAndSet(digest, 1, next, 60);
  const requestId = randomUUID();
  await store.beginRequest(digest, requestId, 60);
  await store.completeRequest(digest, requestId, { answer: 'ok' }, 60);
  await store.delete(digest);

  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes(rawToken), false);
  assert.match(serialized, new RegExp(`memory:v1:${digest}`));
  assert.match(serialized, new RegExp(`request-index:v1:${digest}`));
  assert.match(serialized, new RegExp(`request:v1:${digest}:${requestId}`));
  assert.equal(calls.some(call => call.name === 'keys'), false);
});

test('oversized response snapshots become completed non-replayable markers', async () => {
  const store = new InMemoryMemoryStore();
  const record = createMemoryRecord({ now: Date.now(), ttlSeconds: 60 });
  const requestId = randomUUID();
  await store.create(DIGEST, record, 60);
  await store.beginRequest(DIGEST, requestId, 60);
  const completed = await store.completeRequest(
    DIGEST,
    requestId,
    { answer: 'x'.repeat(40 * 1024) },
    60
  );

  assert.equal(completed.status, 'completed');
  assert.equal(completed.replayUnavailable, true);
  assert.equal(Object.hasOwn(completed, 'responseSnapshot'), false);
  assert.deepEqual(completed.responseSummary, { statusCode: 200 });
});

test('Redis adapter maps stalled provider calls to a bounded timeout error', async () => {
  const store = new RedisMemoryStore({
    timeoutMs: 5,
    client: {
      get() { return new Promise(() => {}); }
    }
  });

  await assert.rejects(
    () => store.getRequest(DIGEST, randomUUID()),
    error => (
      error instanceof MemoryStoreError &&
      error.code === 'MEMORY_STORE_TIMEOUT'
    )
  );
});
