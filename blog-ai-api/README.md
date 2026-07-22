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
    manifest.json
  lib/
    corpus.js
    corpus-integrity.js
    retrieval-core.js
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

`sync:corpus` verifies the source manifest and the SHA-256 of both JSON files before copying them. The copied files are verified again, so a partial or mixed-version corpus is not silently deployed.

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

The frontend does not send locally retrieved candidates. If an older client includes a `retrieval.sources` field, the API ignores it and always retrieves against its own verified corpus.

## Response

```json
{
  "answer": "锵锵，我在站内翻到了 3 篇比较相关的内容。",
  "citations": [
    {
      "chunkId": "post-id#0",
      "title": "双塔模型",
      "url": "https://wangsenjie.github.io/2026/03/31/...",
      "section": "模型结构",
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
    "indexVersion": "<corpus-version-sha256>",
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

## Retrieval ownership and browser fallback

The API is the authoritative retrieval and citation source in normal operation. The browser calls `/api/ask` first and does not load or rank the static corpus on a successful response. Browser BM25 is used only after a network error, the configured request timeout, a non-2xx response, or an invalid response body. A valid API answer with no citations, including an evidence-insufficient answer, remains a server result and does not trigger local fallback.

The server and browser fallback use the same dependency-free retrieval core. `blog-ai-api/lib/retrieval-core.js` is the source copy used by Node.js; `npm run export:ai` copies it to `source/js/blog-ai-retrieval.js` for the browser.

## Citation and index contract

Every citation has these fields:

- `chunkId`: the chunk identifier in the serving index;
- `title`: published article title;
- `url`: normalized, allow-listed article URL;
- `section`: section heading, or an empty string;
- `snippet`: display excerpt derived from the chunk.

`meta.indexVersion` is the manifest `corpusVersion`. Consumers must treat `(indexVersion, chunkId)` as the trace key: `chunkId` is traceable only within the same index version. Cross-version stable chunk identifiers are intentionally deferred to phase 2.

## Corpus integrity

`manifest.json` contains the SHA-256 and record count for `posts.json` and `chunks.json`, plus corpus statistics and warnings. Export, synchronization, and manifest-backed API loading perform strong validation:

- both JSON values must be arrays and match manifest counts;
- published post URLs must be valid and unique;
- chunks must have non-empty content, valid published URLs, and unique non-empty IDs;
- every chunk must belong to a published post;
- the file SHA-256 values must match the manifest.

The Hexo `after_generate` check also requires every exported post URL to resolve to a generated route, preventing syntactically valid dead links from becoming citations.

The current corpus contains 69 published posts, 66 indexed posts, and 886 chunks. The exporter skips 32 unpublished posts. Three published PDF-only posts—Logistic Regression, MLP, and 支持向量机—have no indexable text and therefore produce no chunks.

## Tests and retrieval evaluation

```bash
npm test
npm run eval:bm25
```

To intentionally refresh the committed baseline report after reviewing a retrieval change:

```bash
npm run eval:bm25:update
```

To write the phase 1 acceptance report without overwriting the phase 0 history:

```bash
npm run eval:bm25:phase1
```

The committed reports are `evals/reports/bm25-baseline.json` (phase 0) and `evals/reports/bm25-phase1.json` (phase 1, dataset version 2).

The evaluation runner reports article-level Recall@5/20, HitRate@5, MRR@20, nDCG@20, no-answer accuracy, per-category results, and failed cases. Results are deduplicated by normalized published post URL.

## Behavior

- Without model environment variables:
  - `/api/ask` returns a retrieval-only answer using local `chunks.json`
- With model environment variables:
  - `/api/ask` first retrieves citations, then asks the model to rewrite the answer
  - citations and related links still come from local retrieval
- In all cases:
  - retrieval is performed against the server corpus; client candidates are ignored
  - citations follow the `chunkId`/`title`/`url`/`section`/`snippet` contract
  - `meta.indexVersion` identifies the exact corpus version used by the response
