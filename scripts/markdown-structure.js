'use strict';

const crypto = require('crypto');
const yaml = require('js-yaml');
const MarkdownIt = require('markdown-it');

const STRUCTURED_BLOCK_TYPES = Object.freeze([
  'paragraph',
  'list',
  'table',
  'code',
  'formula',
  'quote',
  'image',
  'callout'
]);

const markdownParser = new MarkdownIt({
  // Parse HTML so Markdown comments become html_block/html_inline tokens and
  // can be excluded without touching comment text inside fenced code blocks.
  html: true,
  linkify: false,
  typographer: false
});

function stripHtmlCommentsOutsideFences(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let fence = null;
  let inComment = false;

  return lines.map(line => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        !String(fenceMatch[2] || '').trim()
      ) fence = null;
      return line;
    }
    if (!inComment && fenceMatch) {
      fence = {
        marker: fenceMatch[1][0],
        length: fenceMatch[1].length
      };
      return line;
    }

    let cursor = 0;
    let output = '';
    while (cursor < line.length) {
      if (inComment) {
        const close = line.indexOf('-->', cursor);
        if (close < 0) {
          output += ' '.repeat(line.length - cursor);
          cursor = line.length;
          continue;
        }
        output += ' '.repeat(close + 3 - cursor);
        cursor = close + 3;
        inComment = false;
        continue;
      }

      const open = line.indexOf('<!--', cursor);
      if (open < 0) {
        output += line.slice(cursor);
        cursor = line.length;
        continue;
      }
      output += line.slice(cursor, open);
      output += ' '.repeat(4);
      cursor = open + 4;
      inComment = true;
    }
    return output;
  }).join('\n');
}

function parseFrontMatter(frontMatterText, sourceName) {
  const source = String(frontMatterText || '').trim();
  if (!source) return {};

  let parsed;
  try {
    parsed = yaml.load(source, {
      filename: sourceName || undefined,
      json: true,
      schema: yaml.JSON_SCHEMA
    });
  } catch (error) {
    const location = sourceName ? ` in ${sourceName}` : '';
    throw new Error(`Invalid YAML front matter${location}: ${error.message}`);
  }

  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    const location = sourceName ? ` in ${sourceName}` : '';
    throw new Error(`Front matter must be a YAML mapping${location}`);
  }
  return parsed;
}

function stripHexoTags(value) {
  return String(value || '').replace(/\{%-?[\s\S]*?-?%\}/g, '');
}

function inlineTokenText(token) {
  if (!token) return '';
  if (token.type === 'text' || token.type === 'code_inline') {
    return token.content || '';
  }
  if (token.type === 'softbreak' || token.type === 'hardbreak') {
    return '\n';
  }
  if (token.type === 'image') {
    return token.content ? `图片：${token.content}` : '';
  }
  if (token.type === 'html_inline') return '';
  if (Array.isArray(token.children)) {
    return token.children.map(inlineTokenText).filter(Boolean).join('');
  }
  return '';
}

function inlineContent(token) {
  const children = token && Array.isArray(token.children) ? token.children : [];
  if (children.length) {
    return stripHexoTags(children.map(inlineTokenText).join(''));
  }
  return stripHexoTags(token && token.content || '');
}

function markdownToText(markdown) {
  const source = stripHtmlCommentsOutsideFences(markdown);
  if (!source.trim()) return '';

  const tokens = markdownParser.parse(source, {});
  const parts = [];
  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') {
      continue;
    }
    if (token.type !== 'inline') continue;
    const value = inlineContent(token).trim();
    if (value) parts.push(value);
  }

  // markdown-it treats display-math fences as ordinary inline text without a
  // math plugin. Keep the formula text while removing only the $$ delimiters.
  return parts.join('\n\n')
    .replace(/^\s*\$\$\s*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findContainerEnd(tokens, startIndex) {
  const open = tokens[startIndex];
  if (!open || !/_open$/.test(open.type)) return startIndex;
  const closeType = open.type.replace(/_open$/, '_close');
  let depth = 0;

  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === open.type) {
      depth += 1;
    } else if (token.type === closeType) {
      if (!depth) return index;
      depth -= 1;
    }
  }
  return startIndex;
}

function tokenRangeText(tokens, startIndex, endIndex) {
  const parts = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const token = tokens[index];
    if (!token || token.type !== 'inline') continue;
    const value = inlineContent(token).trim();
    if (value) parts.push(value);
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tableTokenText(tokens, startIndex, endIndex) {
  const rows = [];
  let cells = null;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.type === 'tr_open') {
      cells = [];
      continue;
    }
    if (token.type === 'tr_close') {
      if (cells && cells.length) rows.push(cells.join(' | '));
      cells = null;
      continue;
    }
    if (cells && token.type === 'inline') {
      const value = inlineContent(token).replace(/\s+/g, ' ').trim();
      cells.push(value);
    }
  }
  return rows.join('\n').trim();
}

function hasMeaningfulImageOnlyContent(inlineToken) {
  const children = inlineToken && Array.isArray(inlineToken.children)
    ? inlineToken.children
    : [];
  let hasImage = false;
  for (const child of children) {
    if (child.type === 'image') {
      hasImage = true;
      continue;
    }
    if (['link_open', 'link_close', 'softbreak', 'hardbreak'].includes(child.type)) continue;
    if (child.type === 'text' && !String(child.content || '').trim()) continue;
    return false;
  }
  return hasImage;
}

function isDisplayFormula(raw) {
  const source = String(raw || '').trim();
  return (/^\$\$[\s\S]*\$\$$/.test(source) ||
    /^\\\[[\s\S]*\\\]$/.test(source));
}

function isCallout(raw) {
  const source = String(raw || '').trim();
  return /^(?:\{%-?\s*(?:note|tabs?|collapse|details)\b|:{3,}\w+)/i.test(source);
}

function blockSourceLines(token) {
  if (!token || !Array.isArray(token.map)) return null;
  const start = Number(token.map[0]) + 1;
  const end = Number(token.map[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return null;
  }
  return { start, end };
}

function sectionAnchor(headingPath, occurrence) {
  const location = [
    ...(headingPath || []).map(value => String(value || '').trim()),
    String(occurrence || 0)
  ].join('\u0000');
  return `section_${crypto.createHash('sha256').update(location).digest('hex').slice(0, 16)}`;
}

function structuredBlock(tokens, startIndex, lines, headingPath, sectionTitle) {
  const token = tokens[startIndex];
  if (
    !token ||
    (token.level !== 0 && token.type !== 'fence' && token.type !== 'code_block')
  ) return null;
  const sourceLines = blockSourceLines(token);
  const raw = sourceLines
    ? lines.slice(sourceLines.start - 1, sourceLines.end).join('\n')
    : String(token.content || '');
  let endIndex = startIndex;
  let type = '';
  let content = '';

  if (token.type === 'fence' || token.type === 'code_block') {
    type = 'code';
    content = String(token.content || '').replace(/\r\n/g, '\n').trimEnd();
  } else if (token.type === 'paragraph_open') {
    endIndex = findContainerEnd(tokens, startIndex);
    const inline = tokens.slice(startIndex, endIndex + 1).find(item => item.type === 'inline');
    if (isDisplayFormula(raw)) type = 'formula';
    else if (isCallout(raw)) type = 'callout';
    else if (hasMeaningfulImageOnlyContent(inline)) type = 'image';
    else type = 'paragraph';
    content = type === 'formula'
      ? raw.replace(/^\s*(?:\$\$|\\\[)\s*/, '').replace(/\s*(?:\$\$|\\\])\s*$/, '').trim()
      : tokenRangeText(tokens, startIndex, endIndex);
  } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    endIndex = findContainerEnd(tokens, startIndex);
    type = 'list';
    content = tokenRangeText(tokens, startIndex, endIndex);
  } else if (token.type === 'table_open') {
    endIndex = findContainerEnd(tokens, startIndex);
    type = 'table';
    content = tableTokenText(tokens, startIndex, endIndex);
  } else if (token.type === 'blockquote_open') {
    endIndex = findContainerEnd(tokens, startIndex);
    type = isCallout(raw) ? 'callout' : 'quote';
    content = tokenRangeText(tokens, startIndex, endIndex);
  } else if (token.type === 'html_block') {
    type = 'callout';
    content = stripHexoTags(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!type || !STRUCTURED_BLOCK_TYPES.includes(type)) return null;
  return {
    type,
    content: stripHexoTags(content).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
    raw,
    sourceLines,
    headingPath: (headingPath || []).slice(),
    sectionTitle: sectionTitle || '',
    tokenEndIndex: endIndex
  };
}

function splitDisplayFormulaBlocks(block) {
  if (!block || block.type === 'code' || !/^[ \t]*\$\$[ \t]*$/m.test(block.raw || '')) {
    return [block];
  }
  const lines = String(block.raw || '').split('\n');
  const baseLine = block.sourceLines ? block.sourceLines.start : 1;
  const segments = [];
  let buffer = [];
  let bufferStart = 0;
  let formula = [];
  let formulaStart = -1;
  let inFormula = false;
  let codeFence = '';

  function sourceLines(start, end) {
    return { start: baseLine + start, end: baseLine + end };
  }

  function flushText(endIndex) {
    if (!buffer.length) return;
    const raw = buffer.join('\n');
    const content = markdownToText(raw);
    if (content) {
      segments.push(Object.assign({}, block, {
        content,
        raw,
        sourceLines: sourceLines(bufferStart, endIndex),
        type: block.type
      }));
    }
    buffer = [];
  }

  function flushFormula(endIndex) {
    const raw = formula.join('\n');
    const content = formula.slice(1, -1).join('\n').trim();
    if (content) {
      segments.push(Object.assign({}, block, {
        content,
        raw,
        sourceLines: sourceLines(formulaStart, endIndex),
        type: 'formula'
      }));
    }
    formula = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (!inFormula && fence) {
      const marker = fence[1][0];
      if (!codeFence) codeFence = marker;
      else if (codeFence === marker) codeFence = '';
    }

    if (!codeFence && trimmed === '$$') {
      if (!inFormula) {
        flushText(index - 1);
        inFormula = true;
        formulaStart = index;
        formula = [line];
      } else {
        formula.push(line);
        flushFormula(index);
        inFormula = false;
        bufferStart = index + 1;
      }
      continue;
    }

    if (inFormula) {
      formula.push(line);
    } else {
      if (!buffer.length) bufferStart = index;
      buffer.push(line);
    }
  }

  if (inFormula) {
    bufferStart = formulaStart;
    buffer = formula.concat(buffer);
  }
  flushText(lines.length - 1);
  return segments.length ? segments : [block];
}

function parseMarkdownDocument(markdown) {
  const source = stripHtmlCommentsOutsideFences(markdown);
  const lines = source.split('\n');
  const tokens = markdownParser.parse(source, {});
  const headingStack = [];
  const headingOccurrences = new Map();
  const blocks = [];
  const sections = [];
  let sectionTitle = '';
  let headingPath = [];
  let currentBlocks = [];
  let currentAnchor = sectionAnchor([], 0);

  function flushSection() {
    if (!currentBlocks.length) return;
    sections.push({
      sectionTitle,
      headingPath: headingPath.slice(),
      sectionAnchor: currentAnchor,
      blocks: currentBlocks.slice(),
      content: currentBlocks
        .filter(block => block.type !== 'code' && block.content)
        .map(block => block.content)
        .join('\n\n')
        .trim()
    });
    currentBlocks = [];
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'heading_open' && token.level === 0) {
      flushSection();
      const inline = tokens[index + 1];
      const level = Number(String(token.tag || '').slice(1));
      const title = inlineContent(inline).replace(/\s+/g, ' ').trim();
      if (Number.isSafeInteger(level) && level >= 1 && level <= 6 && title) {
        headingStack.length = level - 1;
        headingStack[level - 1] = title;
        headingPath = headingStack.filter(Boolean);
        sectionTitle = title;
        const key = headingPath.join('\u0000');
        const occurrence = headingOccurrences.get(key) || 0;
        headingOccurrences.set(key, occurrence + 1);
        currentAnchor = sectionAnchor(headingPath, occurrence);
      }
      continue;
    }

    const block = structuredBlock(tokens, index, lines, headingPath, sectionTitle);
    if (!block) continue;
    const expanded = splitDisplayFormulaBlocks(block);
    blocks.push(...expanded);
    currentBlocks.push(...expanded);
  }
  flushSection();

  return {
    blocks,
    sections,
    contentText: sections.map(section => section.content).filter(Boolean).join('\n\n').trim()
  };
}

module.exports = {
  STRUCTURED_BLOCK_TYPES,
  inlineContent,
  markdownParser,
  markdownToText,
  parseFrontMatter,
  parseMarkdownDocument,
  sectionAnchor,
  stripHtmlCommentsOutsideFences
};
