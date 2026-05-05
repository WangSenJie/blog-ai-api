'use strict';

function getModelConfig() {
  const apiBaseUrl = String(process.env.LLM_API_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || '';
  const apiPath = process.env.LLM_API_PATH || '/chat/completions';

  return {
    apiBaseUrl,
    apiKey,
    model,
    apiPath
  };
}

function canUseModel() {
  const config = getModelConfig();
  return Boolean(config.apiBaseUrl && config.apiKey && config.model);
}

function buildPrompt(question, mode, page, citations) {
  const citationText = (citations || []).map((citation, index) => (
    `[${index + 1}] 标题: ${citation.title}\n链接: ${citation.url}\n片段: ${citation.snippet}`
  )).join('\n\n');

  const pageText = page
    ? `当前页面标题: ${page.title || ''}\n当前页面链接: ${page.url || ''}\n当前页面描述: ${page.description || ''}`
    : '当前没有页面上下文。';

  return [
    '你是一个中文博客站内向导，语气活泼、可爱、像一个会接话的小向导，但不要过度夸张。',
    '你只能基于提供的站内检索结果回答，不要编造站外事实，不要编造文章标题或链接。',
    '如果证据不够，就明确说站内暂时没有足够线索。',
    '回答尽量简洁，适合直接显示在聊天面板里。',
    `模式: ${mode}`,
    pageText,
    `用户问题: ${question}`,
    '可用引用如下：',
    citationText || '没有引用。'
  ].join('\n\n');
}

function extractAnswer(content) {
  const text = String(content || '').trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.answer === 'string') {
      return parsed.answer.trim();
    }
  } catch (error) {
    // Ignore JSON parse errors and fall back to raw text.
  }

  return text;
}

async function generateAnswer(question, mode, page, citations) {
  if (!canUseModel()) return null;

  const { apiBaseUrl, apiKey, model, apiPath } = getModelConfig();
  const endpoint = `${apiBaseUrl}${apiPath}`;
  const prompt = buildPrompt(question, mode, page, citations);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '请基于给定引用回答，并返回纯文本。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const answer = extractAnswer(
    payload &&
      payload.choices &&
      payload.choices[0] &&
      payload.choices[0].message &&
      payload.choices[0].message.content
  );

  return answer || null;
}

module.exports = {
  canUseModel,
  getModelConfig,
  generateAnswer
};
