'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('crypto');

const {
  MemoryServiceError,
  createMemoryService,
  createMemoryServiceFromEnvironment
} = require('../memory/service');
const {
  InMemoryMemoryStore,
  MemoryStoreError
} = require('../memory/store');

const TOKEN_SECRET = 'service-token-secret-1234567890-abcdef';
const KEY_SECRET = 'service-key-secret-abcdef-0987654321';

function service(options) {
  return createMemoryService(Object.assign({
    store: new InMemoryMemoryStore(),
    tokenSecret: TOKEN_SECRET,
    keySecret: KEY_SECRET,
    memoryTtlSeconds: 3600,
    requestTtlSeconds: 600
  }, options));
}

function askInput(created, overrides) {
  return Object.assign({
    question: '什么是双塔模型？',
    memoryToken: created.memoryToken,
    threadId: created.session.activeThread.threadId,
    expectedMemoryVersion: created.session.version,
    requestId: randomUUID()
  }, overrides);
}

function answer(text) {
  return {
    answer: text,
    citations: [],
    meta: { standaloneQuery: '双塔模型' }
  };
}

test('session create, restore, thread rotation, and clear preserve the public contract', async () => {
  const memory = service();
  const created = await memory.createSession();
  assert.equal(created.created, true);
  assert.match(created.memoryToken, /^m1\./);

  const restored = await memory.restoreSession(created.memoryToken);
  assert.equal(restored.created, false);
  assert.equal(restored.memoryToken, created.memoryToken);
  assert.equal(restored.session.version, 1);

  const requestId = randomUUID();
  const rotated = await memory.createThread({
    memoryToken: created.memoryToken,
    currentThreadId: created.session.activeThread.threadId,
    expectedMemoryVersion: 1,
    requestId
  });
  assert.equal(rotated.session.version, 2);
  assert.notEqual(
    rotated.session.activeThread.threadId,
    created.session.activeThread.threadId
  );

  const replayed = await memory.createThread({
    memoryToken: created.memoryToken,
    currentThreadId: created.session.activeThread.threadId,
    expectedMemoryVersion: 1,
    requestId
  });
  assert.equal(replayed.replayed, true);
  assert.equal(
    replayed.session.activeThread.threadId,
    rotated.session.activeThread.threadId
  );

  await memory.deleteSession(created.memoryToken);
  await assert.rejects(
    () => memory.restoreSession(created.memoryToken),
    error => error instanceof MemoryServiceError && error.statusCode === 410
  );
});

test('ask request ids replay responses without repeating a memory update', async () => {
  const memory = service();
  const created = await memory.createSession();
  const input = askInput(created);
  const prepared = await memory.prepareAsk(input);
  assert.equal(prepared.status, 'active');
  assert.equal(prepared.replayed, false);

  const completed = await memory.completeAsk(prepared, input, answer('第一个回答'));
  assert.equal(completed.writeStatus, 'committed');
  assert.equal(completed.version, 2);

  const replay = await memory.prepareAsk(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.responseSnapshot.answer, '第一个回答');
  const restored = await memory.restoreSession(created.memoryToken);
  assert.equal(restored.session.version, 2);
});

test('concurrent turns use CAS merge and retain both completed writes', async () => {
  const memory = service();
  const created = await memory.createSession();
  const firstInput = askInput(created, { question: '第一个问题' });
  const secondInput = askInput(created, { question: '第二个问题' });
  const [first, second] = await Promise.all([
    memory.prepareAsk(firstInput),
    memory.prepareAsk(secondInput)
  ]);

  const [firstResult, secondResult] = await Promise.all([
    memory.completeAsk(first, firstInput, answer('第一个回答')),
    memory.completeAsk(second, secondInput, answer('第二个回答'))
  ]);
  assert.equal(firstResult.writeStatus, 'committed');
  assert.equal(secondResult.writeStatus, 'committed');

  const restored = await memory.restoreSession(created.memoryToken);
  assert.equal(restored.session.version, 3);
  const verified = memory.verify(created.memoryToken);
  const record = await memory.store.get(verified.tokenDigest, 3600);
  const content = record.activeThread.recentMessages.map(message => message.content);
  assert.ok(content.includes('第一个问题'));
  assert.ok(content.includes('第二个问题'));
});

test('storage failures explicitly degrade ask while direct memory APIs remain unavailable', async () => {
  const failingStore = {
    kind: 'redis',
    async get() {
      throw new MemoryStoreError('provider detail', 'MEMORY_STORE_UNAVAILABLE');
    }
  };
  const memory = service({ store: failingStore });
  const healthy = service();
  const created = await healthy.createSession();
  const degraded = await memory.prepareAsk(askInput(created));

  assert.deepEqual(degraded, {
    status: 'degraded',
    writeStatus: 'not_attempted',
    reason: 'storage_unavailable'
  });

  const disabled = createMemoryServiceFromEnvironment({
    MEMORY_V1_ENABLED: 'true'
  });
  await assert.rejects(
    () => disabled.createSession(),
    error => error instanceof MemoryServiceError && error.statusCode === 503
  );
});
