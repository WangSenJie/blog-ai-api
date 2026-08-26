# blog-ai-api

Minimal external backend for the blog guide widget.

## Structure

```text
blog-ai-api/
  api/
    ask.js
    feedback.js
    memory/
      session.js
      thread.js
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
    feedback.js
    token.js
    record.js
    store.js
    redis-store.js
    service.js
  data/
    posts.json
    chunks.json
    manifest.json
  lib/
    embedding-providers/
    embedding.js
    hybrid-retrieve.js
    corpus.js
    corpus-integrity.js
    retrieval-core.js
    retrieve.js
    generate.js
    feedback-receipt.js
    feedback-sink.js
    trace.js
  evals/
    dataset.json
    agent-dataset.json
    phase4-dataset.json
    run.js
    agent-run.js
    phase4-run.js
    reports/
  test/
  scripts/
    sync-corpus.js
  package.json
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
- `LLM_JSON_MODE_ENABLED`
  - Optional; defaults to `true`. Set to `false` only when the OpenAI-compatible provider does not support `response_format: { "type": "json_object" }`.
- `GROUNDED_SYNTHESIS_ENABLED` and `SEMANTIC_VERIFICATION_ENABLED`
  - Phase 10 feature flags. Both must be `true` before a natural claim can be published. If either path fails, the request falls back to the verified deterministic answer.
- `GROUNDED_SYNTHESIS_ROLLOUT_PERCENT`
  - Optional stable rollout percentage from 0–100. Bucketing uses the opaque memory digest when available and never uses IP or browser fingerprinting.
- `VERIFIER_API_BASE_URL`, `VERIFIER_API_KEY`, `VERIFIER_MODEL`, and `VERIFIER_API_PATH`
  - Optional independent semantic-verifier provider settings. Each value falls back to the corresponding `LLM_*` setting, but verification is always a separate bounded model call.
- `VERIFIER_TIMEOUT_MS` and `VERIFIER_MAX_OUTPUT_TOKENS`
  - Optional verifier limits. The Agent defaults to a 5-second verification budget, clamps the environment timeout to 1–6 seconds, and defaults to 700 output tokens.
- `RETRIEVAL_ROUND_TIMEOUT_MS`
  - Optional timeout for one retrieval round; defaults to `1500` and is clamped to 500–5,000 milliseconds. A timed-out first round may still use the bounded second attempt.
- `LLM_MAX_REQUEST_COST_USD`, `LLM_INPUT_COST_PER_MILLION_TOKENS`, and `LLM_OUTPUT_COST_PER_MILLION_TOKENS`
  - Optional cost guard. All three must be configured before the API estimates and enforces a per-request model cost ceiling.
- `DASHSCOPE_API_KEY` and `DASHSCOPE_WORKSPACE_ID`
  - Server-only credentials for a manifest that uses the managed `dashscope` embedding provider. `DASHSCOPE_BASE_URL` may replace the workspace-derived endpoint.
- `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS`
  - Optional managed build settings; phase 7 defaults to `qwen3.7-text-embedding` and 1024 dimensions.
- `EMBEDDING_TIMEOUT_MS`, `EMBEDDING_MAX_RETRIES`, `EMBEDDING_BATCH_SIZE`, and `EMBEDDING_CONCURRENCY`
  - Optional bounded managed embedding build/query controls.
- `RAG_RETRIEVAL_MODE`
  - Set to `bm25` to disable the Dense path without changing corpus artifacts.
- `FEEDBACK_RECEIPT_SECRET`
  - Optional secret of at least 32 characters. Together with the webhook settings, it enables short-lived signed feedback receipts.
- `FEEDBACK_WEBHOOK_URL`
  - Optional HTTPS URL for the operator-controlled feedback receiver. URLs with embedded user names or passwords are rejected.
- `FEEDBACK_WEBHOOK_SECRET`
  - Optional secret of at least 32 characters used to authenticate outbound feedback events.
- `FEEDBACK_WEBHOOK_TIMEOUT_MS`
  - Optional webhook deadline. Defaults to 3,000 ms and is clamped to 500–5,000 ms.
- `FEEDBACK_INCLUDE_REVIEW_CONTEXT`
  - Optional and disabled by default. Set to `true`, `1`, or `yes` together with `FEEDBACK_REVIEW_CONTEXT_SECRET` to include a bounded current question for negative-feedback review.
- `FEEDBACK_REVIEW_CONTEXT_SECRET`
  - Optional independent secret of at least 32 characters. It encrypts the opt-in review context inside the browser receipt; do not reuse the receipt or webhook secret.
- `MEMORY_V1_ENABLED`
  - Optional phase 8 feature flag. Keep it unset or `false` for a dark deployment; set it to `true` only after the managed Redis variables below are configured.
- `REDIS_URL`
  - Server-only standard Redis connection string injected by the Vercel Marketplace Redis integration. It contains credentials and must be stored as a secret. Provision separate databases for Development, Preview, and Production instead of sharing key space.
- `MEMORY_TOKEN_SECRET` and `MEMORY_KEY_SECRET`
  - Independent server-only secrets, each containing at least 32 bytes of high-entropy material. The first signs browser bearer tokens; the second derives opaque Redis key digests. Do not reuse either secret for another feature.
- `MEMORY_TTL_SECONDS`
  - Optional rolling memory TTL; defaults to 2,592,000 seconds (30 days).
- `MEMORY_REQUEST_TTL_SECONDS`
  - Optional idempotency TTL; defaults to 86,400 seconds (24 hours).
- `MEMORY_STORE_TIMEOUT_MS` and `MEMORY_SERVICE_BUDGET_MS`
  - Optional storage deadlines; defaults are 800 ms per operation and 1,500 ms per Memory Service call.

If `LLM_API_*` variables are not set, `/api/ask` will still work in retrieval-only mode.

Feedback is disabled unless `FEEDBACK_RECEIPT_SECRET`, `FEEDBACK_WEBHOOK_URL`, and `FEEDBACK_WEBHOOK_SECRET` are all valid. It is independent of whether an external generation model is configured. The review-context switch does not enable feedback by itself and remains disabled unless both of its settings are valid.

Memory is disabled unless `MEMORY_V1_ENABLED=true`, `REDIS_URL`, and both memory secrets are valid. A disabled or unavailable MemoryStore does not fall back to process memory. `/api/ask` continues without persistent memory and reports `memory.status` as `disabled` or `degraded`.

Use the Vercel Marketplace Redis integration to inject `REDIS_URL` into the API project. Treat the connection string and both memory secrets as secrets. Configure provider quota/cost alerts, choose a region close to the Vercel functions, and document the database retention/backup policy before enabling Production.

## Anonymous memory API

Create a session with `POST /api/memory/session` and an empty JSON object. HTTP 201 returns the only copy of the new bearer token:

```json
{
  "memoryToken": "m1.<random-id>.<signature>",
  "memory": {
    "status": "active",
    "version": 1,
    "threadId": "thread_<uuid>",
    "expiresAt": "2026-09-24T00:00:00.000Z",
    "restored": false
  },
  "context": {
    "summary": "",
    "activeTopic": "",
    "recentMessages": [],
    "articleRefs": []
  },
  "meta": { "traceId": "trace_..." }
}
```

Restore by POSTing `{ "memoryToken": "m1...." }` to the same endpoint. A restore response does not repeat the token. A malformed token returns 400, a forged signature returns 401, and a valid token whose record is absent returns 410.

Start a new thread without deleting long-term memory with `POST /api/memory/thread`:

```json
{
  "memoryToken": "m1....",
  "currentThreadId": "thread_<uuid>",
  "expectedMemoryVersion": 7,
  "requestId": "123e4567-e89b-42d3-a456-426614174000"
}
```

Clear the memory with `DELETE /api/memory/session` and a JSON body containing `memoryToken` and a UUID `requestId`. Existing and already-missing records both return 204.

The phase 9 browser integration stores only a versioned anonymous credential record in `localStorage`; conversation text remains bounded in `sessionStorage` for compatibility and degradation. On startup it creates or restores a session, hydrates trusted recent messages, and sends `memoryToken`, `threadId`, `expectedMemoryVersion`, and a fresh UUID `requestId` with managed asks. “New conversation” rotates the server thread without clearing long-term memory, while “Clear memory” deletes server state before removing the local token. A failed clear retains the token so deletion can be retried safely.

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
  },
  "memoryToken": "m1....",
  "threadId": "thread_<uuid>",
  "expectedMemoryVersion": 7,
  "requestId": "123e4567-e89b-42d3-a456-426614174000"
}
```

`question` remains supported for legacy callers. The current frontend also sends at most eight recent `user`/`assistant` messages. `sessionId` is a correlation identifier, not an authentication token or server-side persistent session. Historical citations are untrusted reference hints: the API resolves their chunk IDs and URLs against the current corpus before using them for reference resolution, and never treats prior assistant text as factual evidence.

The four memory fields are optional as a group. If supplied, all four are required. Server memory takes precedence over client-provided compatibility history. The response includes a top-level `memory` object whose status is `active`, `degraded`, or `disabled`; write status is one of `committed`, `duplicate`, `stale_thread`, `version_conflict`, `size_limit`, `failed`, or `not_attempted`. A duplicate completed `requestId` replays its bounded response without invoking the Agent again; a duplicate still being processed returns 409 with `Retry-After`.

The frontend does not send locally retrieved candidates. If an older client includes a `retrieval.sources` field, the API ignores it and always retrieves against its own verified corpus.

The handler rejects a declared or parsed/serialized request body above 32 KiB, questions above 1,000 characters, individual messages above 2,000 characters, and retained history above 8,000 characters. POST requests must use `application/json`. A request carrying a browser `Origin` outside the allow-list is rejected with 403 instead of merely omitting the CORS response header. Because a hosting platform may parse a request before invoking this handler, configure an equal or stricter request-size limit at the production gateway as well.

Only the most recent assistant turn contributes article-reference and standalone-query metadata. An empty or invalid latest reference list forms a safety barrier and cannot fall through to an older cited article.

## Response

```json
{
  "answer": "站内资料可以确认：双塔模型会分别编码用户与物品，再比较两侧向量。 [1]",
  "claims": [
    {
      "id": "claim_1",
      "subquestionId": "sq_1",
      "text": "双塔模型会分别编码用户与物品，再比较两侧向量。",
      "citationIds": ["post-id#0"],
      "citationIndexes": [1],
      "quote": "双塔模型模型由用户塔和物品塔两部分组成"
    }
  ],
  "unansweredSubquestions": [],
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
  "feedback": {
    "receipt": "f1.<signed-payload>.<signature>",
    "expiresAt": "2026-07-28T00:00:00.000Z"
  },
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
    "evidenceGrading": "calibrated_structural_v1",
    "evidenceCalibration": {
      "version": "phase4-v1",
      "score": 0.62,
      "threshold": 0.3,
      "features": {}
    },
    "citationVerification": {
      "status": "verified",
      "totalClaims": 1,
      "supportedClaims": 1,
      "citationCompleteness": 1,
      "citationSupport": 1,
      "unsupportedClaimRate": 0,
      "source": "deterministic"
    },
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
      "answered": true,
      "accepted": true,
      "rejectionReason": ""
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
      "citationVerificationMs": 0.3,
      "totalMs": 663.9
    }
  }
}
```

`claims` is an audit array for the factual statements that form the answer. In Grounded Answer v2 every claim belongs to one required subquestion, has exactly one server-selected citation, and contains a continuous source `quote`. Natural `text` may paraphrase the quote only after the independent semantic verifier confirms support and directness; server code then validates IDs, quote origin, limits, negation, duplicates, and subquestion coverage. The browser renders the server-rebuilt `answer`, while `claims` remains available for citation positioning, feedback, and audit. Missing required parts appear in `unansweredSubquestions`. `feedback` is omitted unless feedback collection is fully configured.

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

It has fixed routes for direct replies, current-page summary and Q&A, related articles, article comparison, and site-wide Q&A. Only three allow-listed, read-only tools are callable: `search_blog`, `get_article`, and `get_related_articles`. Retrieval is capped at two rounds, six tool calls, eight complete context chunks, a conservatively estimated 6,000 context tokens, and at most two sequential model calls (generation plus independent verification) inside the overall deadline. The current estimate counts at most one token per Unicode character; it is a safety bound, not the provider model's tokenizer.

The generator receives the selected full chunks rather than UI snippets. Retrieved text and conversation history are explicitly marked as untrusted data, while citations and URLs are always rebuilt from server corpus chunks. An evidence-insufficient 200 response is a valid safe stop and is not a browser-fallback trigger.

### Phase 4 claim verification and calibrated refusal

For a factual answer, the deterministic builder and optional model must produce a bounded `claims` array. A claim has one selected chunk ID and an evidence quote. The verifier rejects unknown or unselected IDs, missing/oversized claims, and quotes absent from the source chunk. Published factual claims are deliberately extractive: model `text` must equal the normalized `quote`; a deterministic response may add only `《title》：`, where `title` is server-owned metadata from that cited chunk. Only after this check does the server rebuild citations from corpus metadata and render the public answer.

This is a structural evidence check, not a semantic proof or a probability-valued confidence score. If a model draft fails, the server tries the deterministic claim set; if no claim set can be verified, it returns a conservative no-citation refusal. `meta.citationVerification` reports the outcome and metrics, while `meta.evidenceCalibration` exposes the selected structural score/threshold for diagnostics.

The phase 4 dataset separates calibration cases from holdout cases. The runner selects the evidence coverage threshold from calibration cases only, then validates citation completeness, source support, provenance, unsupported-claim rate, rejection recall/precision, answer acceptance, and routing on holdout. It runs with external generation disabled against the exact serving corpus.

Phase 2 is complete. `search_blog` and `get_related_articles` perform BM25 Top 20 plus 384-dimensional local-vector Top 20 retrieval, Reciprocal Rank Fusion (`k=60`), and semantic/lexical reranking. `get_article` intentionally remains a source-order reader. `bm25_multi_query` now only means the Agent issued multiple subqueries; a normal Hybrid result reports `meta.retrieval.strategy: "hybrid_rrf_rerank"`.

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

`meta.indexVersion` is the manifest `corpusVersion`. Consumers should retain it with `chunkId` for an exact serving-index trace. Phase 2 chunk IDs are stable structural identifiers derived from the public article URL, heading path, repeated-heading occurrence, and section offset; `contentHash` distinguishes changed content across corpus versions.

## Optional feedback webhook

`POST /api/feedback` is available only when the three required feedback settings are valid. The normal answer endpoint issues a short-lived signed receipt and the browser sends exactly this bounded payload:

```json
{
  "receipt": "f1.<signed-payload>.<signature>",
  "rating": "not_helpful",
  "reason": "citation_mismatch"
}
```

`rating` is `helpful` or `not_helpful`. A negative rating may use one of `answer_incorrect`, `citation_mismatch`, `should_have_refused`, `should_have_answer`, or `missing_content`; free-form comments are intentionally not accepted. The receipt expires after 24 hours by default (at most 48 hours). The API validates its signature and expiry, then sends the receiver a minimal event containing the receipt ID, rating/reason, index version, route, evidence/verification state, retrieval strategy, citation chunk IDs, model-answer flag, and an SHA-256 answer digest.

By default, the event has no user question. Operators that need limited negative-feedback triage can explicitly set both `FEEDBACK_INCLUDE_REVIEW_CONTEXT=true` (also accepts `1` or `yes`) and an independent `FEEDBACK_REVIEW_CONTEXT_SECRET` of at least 32 characters. On `/api/ask`, only the normalized current `question` of at most 320 characters is encrypted with AES-256-GCM inside the signed browser receipt. The encryption is bound to that receipt ID; the browser sees only ciphertext. On `/api/feedback`, the server decrypts it and adds `reviewQuestion` to the outgoing event only when `rating` is `not_helpful`. It is omitted for helpful feedback, missing/invalid context, and whenever the feature is not configured. It never includes the raw answer, `sessionId`, message history, IP address, or browser identifier.

The receiver request has these relevant headers:

- `Idempotency-Key`: the signed receipt ID;
- `X-Blog-AI-Feedback-Version: 1`;
- `X-Blog-AI-Feedback-Timestamp`: sender time in milliseconds;
- `X-Blog-AI-Feedback-Signature: v1=<base64url-hmac>`.

The signature is HMAC-SHA256 with `FEEDBACK_WEBHOOK_SECRET` over the exact string `v1.<timestamp>.<raw JSON body>`. The receiver must use constant-time verification, reject stale timestamps, and retain/deduplicate `receiptId` durably before treating an event as new. The API deliberately has no receipt-use database: an upstream timeout, client retry, or replay of a still-valid bearer receipt can result in more than one delivery. HMAC authenticates the sender but does not itself supply replay protection.

For privacy, the receipt and forwarded event omit the raw answer, session ID, IP address, and browser identifier; the answer is represented only by a digest. The raw question is also omitted by default. The opt-in `reviewQuestion` exception is deliberately limited to one current question and negative feedback, not a conversation transcript. Before enabling it, publish the purpose to users and configure the receiver with least-privilege access, encryption at rest, a short retention window, and deletion procedures. Even when enabled, it cannot reconstruct the answer or full conversation; do not use the event transport as a general trace store.

## Corpus integrity

`manifest.json` contains the SHA-256 and record count for posts, chunks, vectors, code blocks, and the learning graph, plus corpus statistics, embedding metadata, structured-ingestion metadata, and warnings. Export, synchronization, and manifest-backed API loading perform strong validation:

- both JSON values must be arrays and match manifest counts;
- published post URLs must be valid and unique;
- chunks must have non-empty content, valid published URLs, and unique non-empty IDs;
- every chunk must belong to a published post;
- every vector must have the manifest dimension and match an existing chunk's `id` and `contentHash`;
- every structured chunk must carry a valid Profile, section anchor, source file/line range, block types, and retrieval-only `retrievalText`;
- `contentHash` covers both the citation text and every field that changes retrieval or source provenance;
- ingestion counts, Profile distribution, source-location coverage, and internal-link edges must agree with the exported posts and chunks;
- the file SHA-256 values must match the manifest.

The Hexo `after_generate` check also requires every exported post URL to resolve to a generated route, preventing syntactically valid dead links from becoming citations.

The phase 7 corpus contains 71 published/indexed posts, 451 section parents, 1,904 Child chunks, and 395 exact code-block artifacts. The parser identifies 2,781 Markdown structure blocks, and all exported chunks are reproducible from their source file and line range. Fifteen probability/ODE posts use the author-maintained `math-note` path rule; 56 posts remain on the explicitly reported `generic-article` migration fallback. The exporter skips 32 unpublished posts and 5 sources without public URLs. Published PDF-only posts produce a metadata-only chunk with their title, description, and resource links; PDF full-text extraction remains a future corpus enhancement.

`content` is the only citation source. `retrievalText` adds deterministic title, heading, tag, category, structure-type, and content context for BM25/vector retrieval, but it is marked non-citeable in the manifest. New posts default to `rag.chunk_profile: generic-article`; Front Matter overrides exact document rules, which override directory rules, which override the migration fallback.

The legacy v3 corpus is frozen at Git revision `7e6d67b`. To rehearse or perform the scoped artifact rollback, run `RAG_CHUNK_SCHEMA=legacy-v3 npm run export:ai`, then synchronize the API corpus. Normal exports use `RAG_CHUNK_SCHEMA=chunk-v2`; `RAG_RETRIEVAL_MODE=bm25` independently disables managed Dense retrieval.

Managed vectors are built only by the explicit root command `npm run build:embeddings`. The default `qwen3.7-text-embedding` provider batches at most 20 inputs per request (`text-embedding-v4` overrides remain capped at 10), applies bounded concurrency, timeout and retry controls, and publishes only a complete index whose Chunk IDs, content hashes and embedding fingerprint match. A failed build leaves the current vector index and manifest unchanged. Static browser artifacts deliberately omit `vectors.json` and all provider credentials.

## Tests and retrieval evaluation

```bash
npm test
npm run eval:bm25
npm run eval:hybrid
npm run eval:agent
npm run eval:phase4
npm run eval:phase5
npm run eval:phase6
npm run eval:phase7
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

The phase 2 Hybrid dataset and report are `evals/hybrid-dataset.json` and `evals/reports/hybrid-phase2.json`. It compares BM25 with Hybrid RAG on the same exact and semantic cases, and fails the command unless semantic retrieval improves while exact retrieval does not regress. The phase 3 workflow dataset and report are `evals/agent-dataset.json` and `evals/reports/agent-phase3.json`; they run fully offline with model generation disabled against the Hybrid tool path.

Phase 4 uses `evals/phase4-dataset.json`. Its calibration split selects the configured structural evidence coverage threshold; its holdout split is never used for selection and must meet the all-or-nothing acceptance targets for claim citation completeness/support/provenance, unsupported claims, answerability, rejection, and route. `npm run eval:phase4` prints the report without modifying the working tree. After review, `npm run eval:phase4:update` writes `evals/reports/phase4.json` deliberately. The `RAG quality` GitHub Actions workflow runs API tests plus Hybrid, Agent, and phase 4 evaluations on every push and pull request.

Phase 6 writes `evals/reports/phase6-ingestion.json`. It compares the frozen v3 hashes and metrics with the structured corpus, rebuilds every chunk from Markdown, validates source locations and code boundaries, and requires the current Hybrid, Agent, phase 4, and phase 5 regression reports to match the serving corpus.

Phase 7 writes `evals/reports/phase7.json`. It validates Chunk v2 hierarchy and Token budgets, full vector/fingerprint coverage, Hybrid quality thresholds, BM25 failure paths, the browser no-vector boundary and rollback switches. `implementationPassed` is a local/CI gate; `releaseReady` becomes true only after a real managed 1024-dimensional index is active, so the report cannot confuse the local semantic-hash proxy with production Model Studio validation.

The evaluation runner reports article-level Recall@5/20, HitRate@5, MRR@20, nDCG@20, no-answer accuracy, per-category results, and failed cases. Results are deduplicated by normalized published post URL.

## Behavior

- Without model environment variables:
  - `/api/ask` returns a retrieval-only answer using the verified local corpus and vector index
- With model environment variables:
  - `/api/ask` routes, rewrites, retrieves and grades evidence before asking the model to write the answer
  - the model receives bounded full chunks, not only 140-character display snippets
  - a model draft is published only after its structured claims pass server-side verification; otherwise the verified deterministic answer or a safe refusal is used
  - citations and related links still come from local retrieval
- In all cases:
  - the workflow is controlled by server code; the model cannot choose arbitrary tools or create an unbounded loop
  - retrieval is performed against the server corpus; client candidates are ignored
  - factual claims follow the `text`/single-`citationIds`/`quote` contract, and citations follow the `chunkId`/`title`/`url`/`section`/`snippet` contract
  - `meta.indexVersion` identifies the exact corpus version used by the response
