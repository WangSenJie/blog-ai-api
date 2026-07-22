'use strict';

const { randomUUID } = require('crypto');

function now() {
  return process.hrtime.bigint();
}

function elapsedMs(startedAt) {
  return Number(now() - startedAt) / 1e6;
}

function roundMs(value) {
  return Number(value.toFixed(3));
}

function createRequestTrace() {
  const requestStartedAt = now();
  const timings = {};

  return {
    traceId: `trace_${randomUUID()}`,

    start() {
      return now();
    },

    end(name, startedAt) {
      const duration = roundMs(elapsedMs(startedAt));
      timings[name] = duration;
      return duration;
    },

    snapshot() {
      return Object.assign({}, timings, {
        totalMs: roundMs(elapsedMs(requestStartedAt))
      });
    }
  };
}

module.exports = {
  createRequestTrace
};
