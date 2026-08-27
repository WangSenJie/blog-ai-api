'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('crypto');

const {
  MemoryServiceError,
  createMemoryService,
  createMemoryServiceFromEnvironment,
  memoryEnvironmentIsolation
} = require('../memory/service');
const {
  InMemoryMemoryStore,
  MemoryStoreError
} = require('../memory/store');
const {
  issueMemoryToken,
  verifyMemoryToken
} = require('../memory/token');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'reports', 'phase8.json');
const EVAL_TOKEN_SECRET = 'phase8-token-secret-1234567890-abcdef';
const EVAL_KEY_SECRET = 'phase8-key-secret-abcdef-0987654321';

function service(options) {
  return createMemoryService(Object.assign({
    store: new InMemoryMemoryStore(),
    tokenSecret: EVAL_TOKEN_SECRET,
    keySecret: EVAL_KEY_SECRET,
    memoryTtlSeconds: 3600,
    requestTtlSeconds: 600
  }, options));
}

function askInput(created, question) {
  return {
    question,
    memoryToken: created.memoryToken,
    threadId: created.session.activeThread.threadId,
    expectedMemoryVersion: created.session.version,
    requestId: randomUUID()
  };
}

function answer(text) {
  return {
    answer: text,
    citations: [],
    meta: { standaloneQuery: text }
  };
}

async function auditImplementation() {
  const issued = issueMemoryToken({
    tokenSecret: EVAL_TOKEN_SECRET,
    keySecret: EVAL_KEY_SECRET
  });
  const verified = verifyMemoryToken(issued.token, {
    tokenSecret: EVAL_TOKEN_SECRET,
    keySecret: EVAL_KEY_SECRET
  });
  const forgedParts = issued.token.split('.');
  forgedParts[2] = `${forgedParts[2][0] === 'A' ? 'B' : 'A'}${forgedParts[2].slice(1)}`;
  let forgeryRejected = false;
  try {
    verifyMemoryToken(forgedParts.join('.'), {
      tokenSecret: EVAL_TOKEN_SECRET,
      keySecret: EVAL_KEY_SECRET
    });
  } catch (error) {
    forgeryRejected = error.statusCode === 401;
  }

  const memory = service();
  const created = await memory.createSession();
  const input = askInput(created, '第一个问题');
  const prepared = await memory.prepareAsk(input);
  const committed = await memory.completeAsk(prepared, input, answer('第一个回答'));
  const replay = await memory.prepareAsk(input);
  const afterReplay = await memory.restoreSession(created.memoryToken);

  const concurrentCreated = await memory.createSession();
  const firstInput = askInput(concurrentCreated, '并发问题一');
  const secondInput = askInput(concurrentCreated, '并发问题二');
  const [firstContext, secondContext] = await Promise.all([
    memory.prepareAsk(firstInput),
    memory.prepareAsk(secondInput)
  ]);
  const concurrentResults = await Promise.all([
    memory.completeAsk(firstContext, firstInput, answer('并发回答一')),
    memory.completeAsk(secondContext, secondInput, answer('并发回答二'))
  ]);
  const afterConcurrent = await memory.restoreSession(concurrentCreated.memoryToken);

  const failingMemory = service({
    store: {
      kind: 'redis',
      async get() {
        throw new MemoryStoreError('simulated outage', 'MEMORY_STORE_UNAVAILABLE');
      }
    }
  });
  const degraded = await failingMemory.prepareAsk(askInput(created, '降级问题'));

  await memory.deleteSession(created.memoryToken);
  let cleared = false;
  try {
    await memory.restoreSession(created.memoryToken);
  } catch (error) {
    cleared = error instanceof MemoryServiceError && error.statusCode === 410;
  }

  const keyExamples = [
    `memory:v1:${verified.tokenDigest}`,
    `request:v1:${verified.tokenDigest}:${randomUUID()}`,
    `request-index:v1:${verified.tokenDigest}`
  ];
  const checks = {
    tokenFormat: /^m1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(issued.token),
    tokenForgeryRejected: forgeryRejected,
    rawTokenAbsentFromKeys: keyExamples.every(key => !key.includes(issued.token)),
    idempotentReplay: committed.writeStatus === 'committed' &&
      replay.replayed === true &&
      replay.responseSnapshot.answer === '第一个回答' &&
      afterReplay.session.version === 2,
    concurrentCasMerge: concurrentResults.every(result => result.writeStatus === 'committed') &&
      afterConcurrent.session.version === 3,
    explicitDegradation: degraded.status === 'degraded' &&
      degraded.writeStatus === 'not_attempted',
    clearInvalidatesSession: cleared
  };

  return {
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

function managedConfiguration(environment) {
  const source = environment || process.env;
  const required = [
    'REDIS_URL',
    'MEMORY_TOKEN_SECRET',
    'MEMORY_KEY_SECRET'
  ];
  return {
    featureEnabled: /^(1|true|yes|on)$/i.test(String(
      source.MEMORY_V1_ENABLED || source.MEMORY_ENABLED || ''
    )),
    credentialsPresent: required.every(key => Boolean(String(source[key] || '').trim())),
    environmentIsolation: memoryEnvironmentIsolation(source)
  };
}

async function liveAudit(environment) {
  const memory = createMemoryServiceFromEnvironment(environment || process.env);
  const created = await memory.createSession();
  const restored = await memory.restoreSession(created.memoryToken);
  await memory.deleteSession(created.memoryToken);
  let deleteVerified = false;
  try {
    await memory.restoreSession(created.memoryToken);
  } catch (error) {
    deleteVerified = error instanceof MemoryServiceError && error.statusCode === 410;
  }
  return {
    create: created.session.version === 1,
    restore: restored.session.activeThread.threadId === created.session.activeThread.threadId,
    delete: deleteVerified,
    passed: created.session.version === 1 &&
      restored.session.activeThread.threadId === created.session.activeThread.threadId &&
      deleteVerified
  };
}

async function buildPhase8Report(options) {
  const settings = options || {};
  const implementation = await auditImplementation();
  const configuration = managedConfiguration(settings.environment);
  let live = null;
  if (settings.live) live = await liveAudit(settings.environment);
  const managedRedisActive = Boolean(live && live.passed);

  return {
    phase: 8,
    generatedAt: new Date().toISOString(),
    strategy: 'managed-redis-memory-store-signed-token-v1',
    implementation,
    managedRedis: Object.assign({}, configuration, {
      liveValidated: managedRedisActive
    }),
    acceptance: {
      implementationPassed: implementation.passed,
      managedRedisActive,
      releaseReady: implementation.passed && managedRedisActive,
      status: implementation.passed
        ? managedRedisActive
          ? 'passed'
          : 'implementation_passed_managed_validation_pending'
        : 'failed'
    },
    live
  };
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf('--output');
  return {
    live: argv.includes('--live'),
    outputPath: outputIndex >= 0 && argv[outputIndex + 1]
      ? path.resolve(argv[outputIndex + 1])
      : DEFAULT_OUTPUT_PATH
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildPhase8Report(options);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Phase 8: implementation=${report.acceptance.implementationPassed ? 'PASS' : 'FAIL'} ` +
    `managedRedis=${report.acceptance.managedRedisActive ? 'ACTIVE' : 'PENDING'}`
  );
  console.log(`Report written to ${options.outputPath}`);
  if (!report.acceptance.implementationPassed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  auditImplementation,
  buildPhase8Report,
  liveAudit,
  managedConfiguration,
  parseArgs
};
