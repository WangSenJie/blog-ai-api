# Blog AI Agent Implementation Draft

> This document preserves the original first-version design. As of 2026-07-23, phases 0, 1, and 3 are implemented, including short multi-turn history, allow-listed Agent tools, and a bounded retrieval loop. Phase 2 Hybrid RAG is not implemented; see `docs/agentic-rag-upgrade-plan.zh-CN.md` for the current status and boundaries.

## Goal

Build a retrieval-based AI assistant for this Hexo blog. The assistant should answer questions from site content, recommend related posts, and summarize the current article without exposing model credentials in the browser.

This blog is a static `Hexo + NexT` site deployed to GitHub Pages, so the AI system should be split into:

- Static blog frontend: chat entry, current-page context, result rendering
- External API service: retrieval, prompt assembly, model call
- Build-time index pipeline: extract and chunk posts, produce search metadata

## Recommended Architecture

### 1. Frontend

Inject a floating assistant widget into the blog via:

- [source/_data/body-end.swig](/Users/wangsenjie/Sites/blog/source/_data/body-end.swig)

The widget is responsible for:

- Opening and closing the panel
- Sending user questions to the API
- Showing answer text, citations, and related posts
- Passing current-page context when the user asks about the current article

The frontend should not call the model provider directly.

### 2. API Service

Recommended deployment target:

- `Vercel Functions`

Reason:

- Minimal setup for a small Node-based API
- Easy environment variable management
- Simple CORS handling for a static GitHub Pages frontend
- Fits the existing JavaScript toolchain better than adding an entire backend framework

The API is a separate project from the Hexo repo. Keep the blog static and keep the AI backend independently deployable.

### 3. Retrieval Layer

Use hybrid retrieval:

- Keyword recall from generated post metadata
- Semantic recall from embeddings

This is materially better than plain local search because your content is long-form technical writing, and users will ask paraphrased questions.

### 4. Data Pipeline

At build time, scan:

- [source/_posts](/Users/wangsenjie/Sites/blog/source/_posts)

Extract:

- title
- slug
- permalink
- date
- tags
- categories
- excerpt
- plain-text body

Then:

- split content into chunks
- generate embedding vectors
- emit a compact retrieval dataset for the API

## Product Scope

### MVP

The first version should support only these capabilities:

- Site-wide question answering from existing blog posts
- Current-article summary
- Related article recommendation
- Learning path guidance across existing categories

Do not start with:

- free-form agent tool use
- browsing external websites
- multi-step planner workflows
- account systems
- conversation memory across users

Those are higher complexity and do not improve the core value of the blog enough for v1.

## User Flows

### 1. Ask About the Whole Site

User asks:

- "你写过双塔模型吗？"
- "这个站里有哪些 Transformer 相关文章？"

System behavior:

- retrieve top matching chunks across all posts
- answer in Chinese
- attach 2 to 5 citations with article titles and URLs

### 2. Ask About the Current Article

User asks:

- "总结这篇文章"
- "这一页的重点是什么？"

System behavior:

- pass current page title, url, tags, categories, and excerpt
- boost retrieval score for the current post
- answer with article-specific context first

### 3. Ask for Next Reads

User asks:

- "我刚学完 SVD，下一篇建议看什么？"

System behavior:

- detect topic
- rank adjacent or prerequisite posts
- return a short ordered reading list

## Suggested Repository Layout

### In This Hexo Repo

Add:

- `docs/ai-agent-implementation.md`
- `scripts/build-ai-corpus.js`
- `scripts/export-ai-documents.js`
- `source/_data/ai-agent.swig`
- `source/_data/ai-agent.js`
- `source/_data/ai-agent.styl`

Recommended responsibility:

- `build-ai-corpus.js`: parse local posts and produce clean structured documents
- `export-ai-documents.js`: emit JSON payloads that the backend can ingest
- `ai-agent.swig`: widget container
- `ai-agent.js`: widget behavior and API calls
- `ai-agent.styl`: widget styles

### In a Separate API Repo

Recommended structure:

```text
blog-ai-api/
  api/
    ask.ts
    summarize.ts
  lib/
    retrieve.ts
    rerank.ts
    prompts.ts
    cors.ts
    schema.ts
  data/
    posts.json
    chunks.json
  scripts/
    embed.ts
    ingest.ts
  package.json
  vercel.json
```

## API Design

### `POST /api/ask`

Request:

```json
{
  "question": "这个站里有讲双塔模型吗？",
  "mode": "site",
  "page": {
    "title": "双塔模型",
    "url": "https://wangsenjie.github.io/2024/01/01/example/",
    "tags": ["推荐算法"],
    "categories": ["机器学习"],
    "excerpt": "..."
  }
}
```

Response:

```json
{
  "answer": "有，站内已经写过双塔模型相关内容，重点在...",
  "citations": [
    {
      "title": "双塔模型",
      "url": "https://wangsenjie.github.io/...",
      "snippet": "双塔模型通常用于召回阶段..."
    }
  ],
  "related": [
    {
      "title": "LightFM",
      "url": "https://wangsenjie.github.io/..."
    }
  ]
}
```

### `POST /api/summarize`

Request:

```json
{
  "page": {
    "title": "Transformer架构",
    "url": "https://wangsenjie.github.io/...",
    "content": "..."
  }
}
```

Response:

```json
{
  "summary": "这篇文章主要讲了..."
}
```

For v1, `summarize` can also be folded into `/api/ask` by sending a system action like `"mode": "page_summary"`. That keeps the surface smaller.

## Build Pipeline

### Step 1. Parse posts

Read all markdown files under:

- [source/_posts](/Users/wangsenjie/Sites/blog/source/_posts)

For each post:

- parse front matter
- render markdown to plain text
- strip code fences if needed
- normalize headings
- keep the canonical public URL

### Step 2. Chunk posts

Recommended chunking rules:

- target 500 to 900 Chinese characters per chunk
- overlap 100 to 150 characters
- prefer splitting on headings first

Each chunk should carry:

- `postTitle`
- `postUrl`
- `tags`
- `categories`
- `sectionTitle`
- `content`

### Step 3. Generate embeddings

Create embeddings for:

- chunk content
- optionally title plus excerpt

Store:

- vector
- chunk metadata
- lightweight inverted index terms

### Step 4. Deploy data to the API

For small scale, two acceptable options:

- commit generated JSON into the API repo
- upload generated JSON to object storage and let the API load it

For this blog size, start with committed JSON. It is simpler and adequate.

## Retrieval Strategy

Use a 3-stage pipeline:

1. keyword prefilter
2. embedding similarity recall
3. lightweight rerank before generation

Recommended ranking signals:

- semantic similarity
- title exact match
- category match
- tag match
- current page boost

If the question is obviously about the current page, force at least one chunk from the current post into the final context set.

## Prompting Rules

The assistant should be constrained by these rules:

- answer primarily from retrieved blog content
- if evidence is weak, say the site does not clearly cover it
- do not invent article titles or links
- prefer concise Chinese answers
- always cite the supporting post URLs when answering factual content

This avoids the most common failure mode: plausible but unsupported answers.

## Frontend Integration

### Injection Point

Use:

- [source/_data/body-end.swig](/Users/wangsenjie/Sites/blog/source/_data/body-end.swig)

Recommended approach:

- keep existing share script intact
- append a widget mount node
- load a small script bundle after page content

Example DOM contract:

```html
<div id="blog-ai-agent"></div>
```

### Page Context Contract

Expose the current page context from the template:

```html
<script>
  window.__BLOG_AI_CONTEXT__ = {
    title: "{{ page.title }}",
    url: "{{ config.url }}{{ page.path ? '/' + page.path : location.pathname }}",
    tags: [{% for tag in page.tags %}"{{ tag.name }}"{% if not loop.last %}, {% endif %}{% endfor %}],
    categories: [{% for cat in page.categories %}"{{ cat.name }}"{% if not loop.last %}, {% endif %}{% endfor %}],
    excerpt: "{{ page.description || config.description }}"
  };
</script>
```

The frontend script reads that object and includes it in API requests when available.

## Security

Do not:

- store provider API keys in this Hexo repo
- expose the model API directly to browser requests
- trust raw HTML from model output

Do:

- keep API keys only in the backend deployment environment
- sanitize returned citation snippets
- rate-limit by IP in the backend
- restrict allowed origins to your blog domain

## Recommended Milestones

### Milestone 1

- add frontend widget shell
- add `/api/ask`
- use only keyword retrieval from exported post metadata

Goal:

- validate interaction and citation format quickly

### Milestone 2

- add chunking and embeddings
- improve answer precision for paraphrased technical questions

Goal:

- make the assistant actually useful

### Milestone 3

- add current-page summary mode
- add related reading recommendations

Goal:

- improve engagement and reading depth

## Acceptance Criteria

The v1 assistant is acceptable if it can:

- answer questions about posts that really exist on the blog
- cite the correct article URLs
- refuse unsupported questions instead of hallucinating
- summarize the current page in Chinese
- return within a reasonable latency budget

Recommended latency budget:

- first byte within 2 to 4 seconds
- full answer within 8 seconds for normal questions

## Implementation Order

1. Add corpus export scripts in this Hexo repo
2. Build the separate API repo and define `/api/ask`
3. Add the widget mount and frontend script in NexT custom injection files
4. Test with 20 to 30 real questions from your existing content
5. Add embeddings only after the full path works end to end

## Recommendation

If the goal is to ship fast, do not start with a fully autonomous "agent". Build a retrieval-first assistant with citations. For a content-heavy technical blog, that is the highest-value version and the one most likely to hold up in production.

The next practical step after this document is to scaffold:

- `scripts/export-ai-documents.js` in this repo
- a small separate `blog-ai-api` project with `/api/ask`
- the frontend widget injected through `source/_data/body-end.swig`
