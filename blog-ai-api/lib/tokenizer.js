'use strict';

const TOKENIZER_VERSION = 'dashscope-compatible-estimate-v1';

function tokenPieces(value) {
  const source = String(value || '').normalize('NFKC');
  const pieces = [];
  const pattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[a-zA-Z0-9_]+|[^\s]/gu;
  for (const match of source.matchAll(pattern)) {
    const piece = match[0];
    if (/^[a-zA-Z0-9_]+$/.test(piece)) {
      const parts = piece.split(/(?=[A-Z])|[_-]+/).filter(Boolean);
      for (const part of parts) {
        const estimated = Math.max(1, Math.ceil(part.length / 4));
        for (let index = 0; index < estimated; index += 1) pieces.push(part);
      }
    } else {
      pieces.push(piece);
    }
  }
  return pieces;
}

function estimateTokens(value) {
  return tokenPieces(value).length;
}

function splitTextByTokenBudget(value, maxTokens) {
  const source = String(value || '').trim();
  const limit = Math.max(1, Number(maxTokens) || 1);
  if (!source || estimateTokens(source) <= limit) return source ? [source] : [];

  const boundaries = source
    .split(/(?<=[。！？!?；;])\s*|\n{2,}|(?<=\.)\s+(?=[A-Z0-9])/u)
    .map(item => item.trim())
    .filter(Boolean);
  const units = boundaries.length > 1 ? boundaries : source.split(/\n/).filter(Boolean);
  const result = [];
  let current = '';

  function flush() {
    if (current.trim()) result.push(current.trim());
    current = '';
  }

  for (const unit of units) {
    if (estimateTokens(unit) > limit) {
      flush();
      let rest = unit;
      while (rest && estimateTokens(rest) > limit) {
        let low = 1;
        let high = rest.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (estimateTokens(rest.slice(0, middle)) <= limit) low = middle;
          else high = middle - 1;
        }
        let breakAt = Math.max(1, low);
        const preferred = Math.max(
          rest.lastIndexOf(' ', breakAt),
          rest.lastIndexOf('\n', breakAt),
          rest.lastIndexOf('，', breakAt),
          rest.lastIndexOf(',', breakAt)
        );
        if (preferred >= Math.floor(breakAt * 0.6)) breakAt = preferred + 1;
        result.push(rest.slice(0, breakAt).trim());
        rest = rest.slice(breakAt).trim();
      }
      if (rest) current = rest;
      continue;
    }

    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (current && estimateTokens(candidate) > limit) flush();
    current = current ? `${current}\n\n${unit}` : unit;
  }
  flush();
  return result;
}

module.exports = {
  TOKENIZER_VERSION,
  estimateTokens,
  splitTextByTokenBudget,
  tokenPieces
};
