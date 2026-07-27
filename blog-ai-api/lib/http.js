'use strict';

function allowedOrigins(environment) {
  const source = environment || process.env;
  const configuredOrigins = source.ALLOWED_ORIGINS ||
    source.ALLOWED_ORIGIN ||
    'https://wangsenjie.github.io';
  return [...new Set(configuredOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .concat(['http://localhost:4000', 'http://127.0.0.1:4000']))];
}

function applyCors(req, res, environment) {
  const origins = allowedOrigins(environment);
  const requestOrigin = req.headers && req.headers.origin;
  const originAllowed = !requestOrigin || origins.includes(requestOrigin);

  if (!requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origins[0]);
  } else if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Trace-Id');
  return originAllowed;
}

function contentType(req) {
  return String(
    req.headers && req.headers['content-type'] || ''
  ).split(';', 1)[0].trim().toLowerCase();
}

function declaredContentLength(req) {
  return Number(req.headers && req.headers['content-length']);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

module.exports = {
  allowedOrigins,
  applyCors,
  contentType,
  declaredContentLength,
  sendJson
};
