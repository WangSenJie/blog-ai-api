# blog-ai-api

Minimal external backend for the blog guide widget.

## Structure

```text
blog-ai-api/
  api/
    ask.js
  agent/
    run.js
    state.js
    config.js
    nodes/
  tools/
    search-blog.js
    get-article.js
    get-related-articles.js
  memory/
    session.js
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
    agent-dataset.json
    run.js
    agent-run.js
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
- `LLM_MAX_OUTPUT_TOKENS`
  - Optional generation ceiling, defaults to `700` and is clamped to 128–1,200 tokens.
- `LLM_MAX_REQUEST_COST_USD`, `LLM_INPUT_COST_PER_MILLION_TOKENS`, and `LLM_OUTPUT_COST_PER_MILLION_TOKENS`
  - Optional cost guard. All three must be configured before the API estimates and enforces a per-request model cost ceiling.

If `LLM_API_*` variables are not set, `/api/ask` will still work in retrieval-only mode.

## Request

`POST /api/ask`

```json
{
  "question": "它如何用于线上召回？",
  "sessionId": "session_8a430443-97b9-4cf1-82ad-00f83f08e195",
  "messages": [
    {
      "role": "user",
      "content": "什么是双塔模型？"
    },
    {
      "role": "assistant",
      "content": "双塔模型由用户塔和物品塔组成。",
      "citations": [
        {
          "chunkId": "双塔模型#0",
          "title": "双塔模型",
          "url": "https://wangsenjie.github.io/..."
        }
      ],
      "indexVersion": "<corpus-version-sha256>",
      "standaloneQuery": "双塔模型"
    },
    {
      "role": "user",
      "content": "它如何用于线上召回？"
    }
  ],
  "page": {
    "title": "双塔模型",
    "url": "https://wangsenjie.github.io/2026/03/31/...",
    "description": "双塔模型的原理"
  }
}
```

`question` remains supported for legacy callers. The current frontend also sends at most eight recent `user`/`assistant` messages. `sessionId` is a correlation identifier, not an authentication token or server-side persistent session. Historical citations are untrusted reference hints: the API resolves their chunk IDs and URLs against the current corpus before using them for reference resolution, and never treats prior assistant text as factual evidence.

The frontend does not send locally retrieved candidates. If an older client includes a `retrieval.sources` field, the API ignores it and always retrieves against its own verified corpus.

The handler rejects a declared or parsed/serialized request body above 32 KiB, questions above 1,000 characters, individual messages above 2,000 characters, and retained history above 8,000 characters. POST requests must use `application/json`. A request carrying a browser `Origin` outside the allow-list is rejected with 403 instead of merely omitting the CORS response header. Because a hosting platform may parse a request before invoking this handler, configure an equal or stricter request-size limit at the production gateway as well.

Only the most recent assistant turn contributes article-reference and standalone-query metadata. An empty or invalid latest reference list forms a safety barrier and cannot fall through to an older cited article.

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
    "route": "site_qa",
    "standaloneQuery": "双塔模型如何用于线上召回？",
    "subqueries": ["双塔模型如何用于线上召回？"],
    "sessionId": "session_...",
    "retrievalAttempts": 1,
    "evidenceStatus": "sufficient",
    "evidenceReason": "query_terms_covered",
    "evidenceGrading": "structural_heuristic",
    "stopReason": "evidence_sufficient",
    "llmFallback": false,
    "indexVersion": "<corpus-version-sha256>",
    "retrieval": {
      "strategy": "bm25",
      "candidates": 12,
      "selectedChunks": 8
    },
    "model": {
      "attempted": true,
      "answered": true
    },
    "timings": {
      "corpusMs": 0.1,
      "routeMs": 0.1,
      "rewriteMs": 0.2,
      "retrievalAttempt1Ms": 12.4,
      "gradeEvidenceAttempt1Ms": 0.2,
      "retrievalMs": 12.8,
      "buildResponseMs": 0.2,
      "generationMs": 650.8,
      "totalMs": 663.9
    }
  }
}
```

The same trace ID is returned in the `X-Trace-Id` response header. Internal errors return a trace ID without exposing implementation details to the browser.

## Controlled Agent workflow

The phase 3 server path is an explicit JavaScript state machine:

```text
route -> rewrite -> split (<= 3) -> retrieve -> grade
                                      ^          |
                                      | retry <= 1
                                      +----------+
                              -> answer or safe stop
```

It has fixed routes for direct replies, current-page summary and Q&A, related articles, article comparison, and site-wide Q&A. Only three allow-listed, read-only tools are callable: `search_blog`, `get_article`, and `get_related_articles`. Retrieval is capped at two rounds, six tool calls, eight complete context chunks, a conservatively estimated 6,000 context tokens, one model call, and a 17-second overall server deadline. The current estimate counts at most one token per Unicode character; it is a safety bound, not the provider model's tokenizer.

The generator receives the selected full chunks rather than UI snippets. Retrieved text and conversation history are explicitly marked as untrusted data, while citations and URLs are always rebuilt from server corpus chunks. An evidence-insufficient 200 response is a valid safe stop and is not a browser-fallback trigger.

Phase 2 is not implemented yet. All three Agent tools currently use BM25; `bm25_multi_query` means several BM25 queries were merged inside the workflow and does not mean vector, RRF, reranking, or Hybrid RAG.

The endpoint does not yet provide user authentication, distributed per-IP/session rate limiting, or a cross-instance global cost ledger. CORS and JSON content-type enforcement reduce browser-origin abuse but are not authentication. Before exposing a paid model publicly, add gateway/WAF or durable-store rate limiting and abuse protection, plus provider-side budget alerts. The optional per-request cost guard is not a replacement for those controls.

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
npm run eval:agent
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

The phase 3 workflow dataset and report are `evals/agent-dataset.json` and `evals/reports/agent-phase3.json`. They are separate from the phase 0/1 BM25 reports and run fully offline with model generation disabled.

The evaluation runner reports article-level Recall@5/20, HitRate@5, MRR@20, nDCG@20, no-answer accuracy, per-category results, and failed cases. Results are deduplicated by normalized published post URL.

## Behavior

- Without model environment variables:
  - `/api/ask` returns a retrieval-only answer using local `chunks.json`
- With model environment variables:
  - `/api/ask` routes, rewrites, retrieves and grades evidence before asking the model to write the answer
  - the model receives bounded full chunks, not only 140-character display snippets
  - citations and related links still come from local retrieval
- In all cases:
  - the workflow is controlled by server code; the model cannot choose arbitrary tools or create an unbounded loop
  - retrieval is performed against the server corpus; client candidates are ignored
  - citations follow the `chunkId`/`title`/`url`/`section`/`snippet` contract
  - `meta.indexVersion` identifies the exact corpus version used by the response
