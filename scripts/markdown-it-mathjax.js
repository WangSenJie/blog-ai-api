'use strict';

function escapeScriptContent(content) {
  return content.replace(/<\/script>/gi, '<\\/script>');
}

function mathInline(state, silent) {
  const start = state.pos;
  const src = state.src;

  if (src[start] !== '$' || src[start + 1] === '$') {
    return false;
  }

  let pos = start + 1;
  let found = false;

  while (pos < state.posMax) {
    if (src[pos] === '$' && src[pos - 1] !== '\\') {
      found = true;
      break;
    }
    pos++;
  }

  if (!found || pos === start + 1) {
    return false;
  }

  if (!silent) {
    const token = state.push('math_inline', '', 0);
    token.content = src.slice(start + 1, pos);
  }

  state.pos = pos + 1;
  return true;
}

function mathBlock(state, startLine, endLine, silent) {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];

  if (state.src.slice(pos, pos + 2) !== '$$') {
    return false;
  }

  pos += 2;
  let firstLine = state.src.slice(pos, max);

  if (silent) {
    return true;
  }

  let content = '';
  let nextLine = startLine;

  if (firstLine.trim().endsWith('$$')) {
    content = firstLine.replace(/\$\$\s*$/, '');
  } else {
    content = firstLine;

    for (;;) {
      nextLine++;
      if (nextLine >= endLine) {
        return false;
      }

      pos = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];
      const line = state.src.slice(pos, max);

      if (line.trim().endsWith('$$')) {
        content += '\n' + line.replace(/\$\$\s*$/, '');
        break;
      }

      content += '\n' + line;
    }
  }

  state.line = nextLine + 1;

  const token = state.push('math_block', 'script', 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, state.line];
  return true;
}

hexo.extend.filter.register('markdown-it:renderer', (md) => {
  if (md.__mathjaxPatched) {
    return;
  }

  md.__mathjaxPatched = true;

  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list']
  });

  md.renderer.rules.math_inline = (tokens, idx) => {
    const content = escapeScriptContent(tokens[idx].content);
    return `<script type="math/tex">${content}</script>`;
  };

  md.renderer.rules.math_block = (tokens, idx) => {
    const content = escapeScriptContent(tokens[idx].content);
    return `<script type="math/tex; mode=display">${content}</script>\n`;
  };
});
