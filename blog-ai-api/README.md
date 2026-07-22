# blog-ai-api

Minimal external backend for the blog guide widget.

## Structure

```text
blog-ai-api/
  api/
    ask.js
  data/
    posts.json
    chunks.json
  lib/
    corpus.js
    retrieve.js
    generate.js
    trace.js
  evals/
    dataset.json
    run.js
    reports/
  test/
  scripts/
    sync-corpus.js
  package.json
  vercel.json
```

## Local setup

1. Export corpus in the main blog project:

```bash
npm run export:ai
```

2. Sync exported JSON into this API project:

```bash
cd blog-ai-api
npm run sync:corpus
```

3. Deploy `blog-ai-api/` to Vercel.

4. After deployment, set the blog frontend config in:

- [source/_data/body-end.swig](/Users/wangsenjie/Sites/blog/source/_data/body-end.swig)

Change:

```js
apiBaseUrl: ''
```

to:

```js
apiBaseUrl: 'https://your-blog-ai-api.vercel.app'
```

## Environment variables

- `ALLOWED_ORIGIN` or `ALLOWED_ORIGINS`
  - Use `ALLOWED_ORIGINS` for a comma-separated list of production origins.
  - `http://localhost:4000` and `http://127.0.0.1:4000` are enabled for local preview.
- `LLM_API_BASE_URL`
  - Example: `https://api.openai.com/v1`
- `LLM_API_KEY`
  - Your model provider API key
- `LLM_MODEL`
  - Example: `gpt-4.1-mini`
- `LLM_API_PATH`
  - Optional, defaults to `/chat/completions`
- `LLM_TIMEOUT_MS`
  - Optional model request timeout, defaults to `15000` and is clamped to 1–60 seconds.

If `LLM_API_*` variables are not set, `/api/ask` will still work in retrieval-only mode.

## Request

`POST /api/ask`

```json
{
  "question": "这个站里有讲双塔模型吗？",
  "mode": "site",
  "page": {
    "title": "双塔模型",
    "url": "https://wangsenjie.github.io/2026/03/31/...",
    "description": "双塔模型的原理"
  }
}
```

## Response

```json
{
  "answer": "锵锵，我在站内翻到了 3 篇比较相关的内容。",
  "citations": [
    {
      "title": "双塔模型",
      "url": "https://wangsenjie.github.io/2026/03/31/...",
      "snippet": "双塔模型模型由用户塔和物品塔两部分组成..."
    }
  ],
  "related": [
    {
      "title": "LightFM",
      "url": "https://wangsenjie.github.io/..."
    }
  ],
  "meta": {
    "traceId": "trace_...",
    "mode": "site",
    "llmFallback": false,
    "retrieval": {
      "strategy": "bm25",
      "candidates": 12
    },
    "model": {
      "attempted": true,
      "answered": true
    },
    "timings": {
      "corpusMs": 0.1,
      "retrievalMs": 12.4,
      "buildResponseMs": 0.2,
      "generationMs": 650.8,
      "totalMs": 663.9
    }
  }
}
```

The same trace ID is returned in the `X-Trace-Id` response header. Internal errors return a trace ID without exposing implementation details to the browser.

## Tests and retrieval evaluation

```bash
npm test
npm run eval:bm25
```

To intentionally refresh the committed baseline report after reviewing a retrieval change:

```bash
npm run eval:bm25:update
```

The evaluation runner reports article-level Recall@5/20, HitRate@5, MRR@20, nDCG@20, no-answer accuracy, per-category results, and failed cases. Results are deduplicated by normalized published post URL.

## Behavior

- Without model environment variables:
  - `/api/ask` returns a retrieval-only answer using local `chunks.json`
- With model environment variables:
  - `/api/ask` first retrieves citations, then asks the model to rewrite the answer
  - citations and related links still come from local retrieval
