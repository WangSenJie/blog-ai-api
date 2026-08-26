'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('crypto');

const askModule = require('../api/ask');
const sessionModule = require('../api/memory/session');
const threadModule = require('../api/memory/thread');
const { createMemoryService } = require('../memory/service');
const { InMemoryMemoryStore, MemoryStoreError } = require('../memory/store');

const TOKEN_SECRET = 'api-token-secret-1234567890-abcdefgh';
const KEY_SECRET = 'api-key-secret-abcdefgh-0987654321';
const originalNodeEnv = process.env.NODE_ENV;

test.before(() => {
  process.env.NODE_ENV = 'test';
});

test.after(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

function memoryService() {
  return createMemoryService({
    store: new InMemoryMemoryStore(),
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET,
    memoryTtlSeconds: 3600,
    requestTtlSeconds: 600
  });
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(value) {
      this.body = value === undefined ? '' : String(value);
    }
  };
}

function request(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body
  };
}

function json(res) {
  return JSON.parse(res.body);
}

test('memory session API creates, restores, rejects tampering, and clears without leaking tokens', async () => {
  const memory = memoryService();
  const handler = sessionModule.createSessionHandler({ memoryService: memory });
  const createResponse = response();
  await handler(request('POST', {}), createResponse);
  const created = json(createResponse);

  assert.equal(createResponse.statusCode, 201);
  assert.match(created.memoryToken, /^m1\./);
  assert.equal(created.memory.status, 'active');

  const restoreResponse = response();
  await handler(request('POST', {
    memoryToken: created.memoryToken
  }), restoreResponse);
  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(Object.hasOwn(json(restoreResponse), 'memoryToken'), false);
  assert.equal(json(restoreResponse).memory.restored, true);

  const parts = created.memoryToken.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  const forgedResponse = response();
  await handler(request('POST', { memoryToken: parts.join('.') }), forgedResponse);
  assert.equal(forgedResponse.statusCode, 401);
  assert.equal(forgedResponse.body.includes(created.memoryToken), false);

  const deleteResponse = response();
  await handler(request('DELETE', {
    memoryToken: created.memoryToken,
    requestId: randomUUID()
  }), deleteResponse);
  assert.equal(deleteResponse.statusCode, 204);
  assert.equal(deleteResponse.body, '');

  const goneResponse = response();
  await handler(request('POST', {
    memoryToken: created.memoryToken
  }), goneResponse);
  assert.equal(goneResponse.statusCode, 410);
});

test('thread API rotates one active thread and replays the same request id', async () => {
  const memory = memoryService();
  const session = await memory.createSession();
  const handler = threadModule.createThreadHandler({ memoryService: memory });
  const body = {
    memoryToken: session.memoryToken,
    currentThreadId: session.session.activeThread.threadId,
    expectedMemoryVersion: 1,
    requestId: randomUUID()
  };
  const firstResponse = response();
  await handler(request('POST', body), firstResponse);
  const first = json(firstResponse);
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(first.memory.version, 2);

  const replayResponse = response();
  await handler(request('POST', body), replayResponse);
  const replay = json(replayResponse);
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replay.memory.replayed, true);
  assert.equal(
    replay.memory.threadId,
    first.memory.threadId
  );
});

test('ask API replays a completed request without invoking the Agent twice', async () => {
  const memory = memoryService();
  const session = await memory.createSession();
  let calls = 0;
  const handler = askModule.createAskHandler({
    memoryService: memory,
    async runAgent() {
      calls += 1;
      return {
        answer: '双塔模型将请求侧与候选侧映射到同一表征空间。',
        claims: [],
        citations: [],
        related: [],
        meta: {
          route: 'site_qa',
          mode: 'site',
          evidenceStatus: 'sufficient',
          retrieval: { strategy: 'test', candidates: 0 },
          retrievalAttempts: 1,
          model: {
            attempted: false,
            answered: false,
            accepted: false,
            rejectionReason: ''
          },
          citationVerification: { status: 'verified' }
        }
      };
    }
  });
  const body = {
    question: '什么是双塔模型？',
    memoryToken: session.memoryToken,
    threadId: session.session.activeThread.threadId,
    expectedMemoryVersion: 1,
    requestId: randomUUID()
  };

  const firstResponse = response();
  await handler(request('POST', body), firstResponse);
  const first = json(firstResponse);
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(first.memory.writeStatus, 'committed');
  assert.equal(first.memory.version, 2);

  const replayResponse = response();
  await handler(request('POST', body), replayResponse);
  const replay = json(replayResponse);
  assert.equal(replayResponse.statusCode, 200);
  assert.equal(replay.answer, first.answer);
  assert.equal(replay.memory.replayed, true);
  assert.equal(replay.memory.writeStatus, 'duplicate');
  assert.equal(calls, 1);
});

test('ask API returns Retry-After for an in-flight duplicate and degrades on Redis failure', async () => {
  const healthy = memoryService();
  const session = await healthy.createSession();
  const body = {
    question: '什么是双塔模型？',
    memoryToken: session.memoryToken,
    threadId: session.session.activeThread.threadId,
    expectedMemoryVersion: 1,
    requestId: randomUUID()
  };
  await healthy.prepareAsk(body);
  let calls = 0;
  const agent = async () => {
    calls += 1;
    return {
      answer: 'fallback answer',
      claims: [],
      citations: [],
      related: [],
      meta: {
        route: 'site_qa',
        mode: 'site',
        evidenceStatus: 'sufficient',
        retrieval: { strategy: 'test', candidates: 0 },
        retrievalAttempts: 1,
        model: { attempted: false, answered: false },
        citationVerification: { status: 'verified' }
      }
    };
  };
  const duplicateHandler = askModule.createAskHandler({
    memoryService: healthy,
    runAgent: agent
  });
  const duplicateResponse = response();
  await duplicateHandler(request('POST', body), duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 409);
  assert.equal(duplicateResponse.getHeader('retry-after'), '1');
  assert.equal(calls, 0);

  const failing = createMemoryService({
    store: {
      kind: 'redis',
      async get() {
        throw new MemoryStoreError('provider unavailable', 'MEMORY_STORE_UNAVAILABLE');
      }
    },
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET
  });
  const degradedHandler = askModule.createAskHandler({
    memoryService: failing,
    runAgent: agent
  });
  const degradedBody = Object.assign({}, body, { requestId: randomUUID() });
  const degradedResponse = response();
  await degradedHandler(request('POST', degradedBody), degradedResponse);
  const degraded = json(degradedResponse);
  assert.equal(degradedResponse.statusCode, 200);
  assert.equal(degraded.memory.status, 'degraded');
  assert.equal(degraded.memory.writeStatus, 'not_attempted');
  assert.equal(calls, 1);
});
