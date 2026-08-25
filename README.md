# DMH's Blog

> 数学、机器学习与编程学习笔记。

线上地址：[wangsenjie.github.io](https://wangsenjie.github.io)

这是一个基于 [Hexo](https://hexo.io/) 和 [NexT](https://theme-next.js.org/) 的静态博客。除文章展示外，项目还包含一个部署在 Vercel 的站内 RAG 问答 API，支持按文章正文、标签和小节标题检索内容。

## 功能

- Markdown 写作、分类、标签、归档、站内搜索与 RSS。
- MathJax 数学公式渲染。
- PDF 文章内嵌预览。
- Vercel RAG API 服务端优先检索；浏览器 BM25 仅在 API 不可用时降级。
- 可选 OpenAI 兼容模型回答；每条事实性结论均附带经服务端验证的站内引用。
- 校准后的证据门槛与安全拒答；可选、默认最小化数据的“有帮助/需要改进”反馈 webhook。
- 静态资源内容哈希，降低 GitHub Pages 缓存导致的样式或脚本更新延迟。

## 技术栈

- Node.js、Hexo 7、NexT。
- GitHub Pages：静态博客部署。
- Vercel Serverless Functions：`blog-ai-api/api/ask.js`。
- JSON 语料、共享中文二元词切分和 BM25 排序核心：站内检索。

## 本地运行

```bash
npm install
npm run server
```

浏览器访问终端输出的本地地址，通常为 `http://localhost:4000`。

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run server` | 启动本地预览服务器。 |
| `npm run build` | 导出 AI 语料并生成静态站点到 `public/`。 |
| `npm run clean` | 清理 Hexo 生成文件。 |
| `npm run export:ai` | 从文章导出 `posts.json` 与 `chunks.json`。 |
| `npm run test:ai` | 运行 RAG API、检索指标和 trace 测试。 |
| `npm run eval:ai` | 使用固定问题集运行当前 BM25 基线评测。 |
| `npm run eval:hybrid` | 运行 Hybrid RAG 召回回归评测。 |
| `npm run eval:agent` | 运行阶段 3 受控 Agent 工作流评测。 |
| `npm run eval:phase4` | 运行阶段 4 引用、拒答与质量验收评测。 |
| `npm run deploy` | 部署 `public/` 到 GitHub Pages。 |

## 写文章

文章位于 `source/_posts/`，支持按主题建立子目录。每篇文章使用 Markdown 和 Hexo Front Matter，例如：

```markdown
---
title: 文章标题
date: 2026-07-14
categories:
  - 机器学习与深度学习
tags:
  - LSTM
---

正文内容。
```

### 内嵌 PDF

项目已开启 `post_asset_folder` 和 NexT PDF 标签。将 PDF 放入文章同名资源目录后，在正文中引用：

```markdown
{% pdf paper.pdf %}
```

例如 `source/_posts/示例.md` 对应资源目录为 `source/_posts/示例/`。

## RAG 问答

后续 Hybrid RAG、Agent 工具、多轮会话、引用验证与评测建设见 [Agentic RAG 升级实施方案](docs/agentic-rag-upgrade-plan.zh-CN.md)。

### 架构

```text
source/_posts/*.md
        |
        v
scripts/export-ai-documents.js
        |
        +--> data/posts.json, data/chunks.json, data/vectors.json, data/manifest.json
        +--> source/ai-data/*.json       (浏览器 BM25 降级与语料发布)
        +--> source/js/blog-ai-retrieval.js
        |
        v
blog-ai-api/scripts/sync-corpus.js
        |
        v
blog-ai-api/data/*.json                 (Vercel API 权威检索)
```

正常请求只向 Vercel API 发送问题、模式和当前页面上下文，由服务端完成检索并返回引用。浏览器不再发送自行召回的候选内容；只有网络错误、请求超时、非 2xx 响应或无效响应时，才按需加载静态 `chunks.json` 并执行本地 BM25。服务端与浏览器降级路径共用 `blog-ai-api/lib/retrieval-core.js`；导出语料时，该核心会同步为浏览器脚本 `source/js/blog-ai-retrieval.js`。

当前阶段 6 验收索引由 108 篇源文章生成：71 篇已发布文章进入公开语料并产生 745 个结构化检索 chunk，395 个代码块保存在独立索引中；32 篇未发布文章和 5 篇缺少公开 URL 的文章被跳过。所有检索 chunk 都带有文章、小节、源码文件和行号；PDF-only 页面会生成包含标题、描述和资源链接的元数据 chunk。

每条服务端引用遵循 `chunkId`、`title`、`url`、`section`、`snippet` 契约。响应中的 `meta.indexVersion` 对应 manifest 的语料版本；稳定 chunk ID 由文章 URL、标题路径与结构位置生成，`contentHash` 用于识别内容、Profile、来源和检索增强字段的变化。`content` 是唯一引用原文，`retrievalText` 只用于 BM25 和向量召回，不能作为最终引用。

`manifest.json` 记录 posts、chunks、vectors、代码块和学习图的 SHA-256、记录数、语料版本与结构化摄取统计。语料导出、同步和服务端加载会校验文件哈希及结构，包括 URL、chunk ID 唯一性、`contentHash`、Profile、源码位置、`retrievalText`、vector 维度、孤立 chunk 和计数一致性；Hexo 构建还会确认每篇语料文章都有实际生成页面，防止格式合法但点击 404 的引用进入索引。

正常 API 路径中的 `search_blog` 和 `get_related_articles` 会执行 BM25 与 384 维本地向量的双路 Top 20 召回、RRF 融合和重排；浏览器故障降级继续使用轻量 BM25。阶段 6 回归中，语义题 Recall@5 从 `0.7000` 提升至 `0.9000`、MRR@20 从 `0.5152` 提升至 `0.5958`，精确题 Recall@5 与 MRR@20 均保持 `1.0000`；综合 Hit@5 为 `0.9500`、MRR@20 为 `0.7979`。后续检索改动应先运行完整阶段 6 回归再上线。

### 阶段 4：可验证回答与质量闭环

服务端把可回答内容组织为 `claims`：每项包含结论文本、唯一的 `citationIds` 和一段逐字可在所选 chunk 中找到的 `quote`。验证器只接受已选中的服务端 chunk，重新生成引用标题、URL、小节和展示摘要；事实性结论采用抽取式规则：空白规范化后，模型的 `text` 必须与 `quote` 相同，确定性路径最多只能在原 quote 前添加服务端从 cited chunk 得到的 `《文章标题》：` 前缀。模型草稿未通过验证时会退回到可验证的确定性回答；两者都不能通过时返回不带引用的保守拒答，而不是使用模型常识补齐。

拒答门槛不是“置信度”概率。阶段 4 数据集将校准样本与保留验收样本分开：仅用校准集选择结构性证据覆盖阈值，再在 holdout 上检查引用完整率、引用支持率、来源一致性、无依据结论率、拒答精确率/召回率和回答通过率。运行 `npm run eval:phase4` 可在当前服务语料上复验；CI 会同时运行 API 测试、Hybrid、Agent 和阶段 4 回归。

### 更新语料

每次新增或修改文章后，依次执行：

```bash
npm run export:ai
cd blog-ai-api
npm run sync:corpus
cd ..
```

然后提交并推送 `data/`、`source/ai-data/` 和 `blog-ai-api/data/` 中的 `posts.json`、`chunks.json`、`vectors.json`、`manifest.json` 更新。Vercel 项目应以 `blog-ai-api` 为 Root Directory，并通过 Git 集成自动部署。

### API 环境变量

在 Vercel 中配置以下变量：

| 变量 | 说明 |
| --- | --- |
| `ALLOWED_ORIGIN` 或 `ALLOWED_ORIGINS` | 允许访问 API 的博客域名；后者支持逗号分隔的多个域名。 |
| `LLM_API_BASE_URL` | 可选，OpenAI 兼容 API 地址。 |
| `LLM_API_KEY` | 可选，模型服务密钥。 |
| `LLM_MODEL` | 可选，模型名称。 |
| `LLM_API_PATH` | 可选，默认 `/chat/completions`。 |
| `FEEDBACK_RECEIPT_SECRET` | 可选；至少 32 字符。与 webhook 配置齐全时签发短期反馈凭据。 |
| `FEEDBACK_WEBHOOK_URL` | 可选；反馈接收端 HTTPS 地址，不能带用户名或密码。 |
| `FEEDBACK_WEBHOOK_SECRET` | 可选；至少 32 字符，用于 API 到接收端的 HMAC 签名。 |
| `FEEDBACK_WEBHOOK_TIMEOUT_MS` | 可选；反馈转发超时，默认 3000ms，限定在 500–5000ms。 |
| `FEEDBACK_INCLUDE_REVIEW_CONTEXT` | 可选；仅设为 `true`/`1`/`yes` 且同时配置下项时，才允许负反馈带上受限的当前问题。默认关闭。 |
| `FEEDBACK_REVIEW_CONTEXT_SECRET` | 可选；至少 32 字符，用于加密 receipt 内的可选复盘问题；应使用独立高熵密钥。 |

未配置 `LLM_*` 时，API 仍会返回基于站内语料的检索结果。`http://localhost:4000` 和 `http://127.0.0.1:4000` 已允许用于本地预览。

反馈是显式 opt-in：只有 `FEEDBACK_RECEIPT_SECRET`、`FEEDBACK_WEBHOOK_URL` 和 `FEEDBACK_WEBHOOK_SECRET` 都有效时，问答响应才会附带短期 signed receipt，界面才显示“有帮助/需要改进”。浏览器只提交 receipt、评分和预定义原因。默认 receipt 与 webhook event 不包含原始问题、回答、会话 ID 或 IP，只含索引版本、路由、引用 chunk ID、验证状态和回答摘要哈希，因此适合按检索/验证维度聚合质量信号。

如确实需要定位负反馈，可额外显式启用 `FEEDBACK_INCLUDE_REVIEW_CONTEXT=true` 和独立的 `FEEDBACK_REVIEW_CONTEXT_SECRET`。服务端只将当前问题规范化并限制为最多 320 个字符，以 AES-256-GCM 加密后放入 signed receipt；浏览器不能读取明文，`/api/feedback` 只会在 `not_helpful` 时解密并向接收端传送 `reviewQuestion`。它不包含回答、会话 ID、历史消息、IP 或浏览器标识，且默认关闭。启用前应向用户说明这一额外数据用途；接收端必须限制访问、设置最短保留期和删除机制。即使开启，它也只能复原一条受限的问题，不能复原完整对话或答案。

接收端必须验证 `X-Blog-AI-Feedback-Timestamp` 的新鲜度以及 `X-Blog-AI-Feedback-Signature`：其值是对 `v1.<timestamp>.<原始 JSON 请求体>` 的 HMAC-SHA256。还必须用 `Idempotency-Key`（也等于 event 中的 `receiptId`）进行持久化去重。API 不保存 receipt 已使用状态，网络重试或恶意重放都可能重复送达；因此只依赖签名不能代替接收端的时效检查与去重。

## 部署

### 静态博客

`_config.yml` 已配置 GitHub Pages 仓库。发布前先构建，再部署：

```bash
npm run build
npm run deploy
```

`npm run deploy` 会将生成后的 `public/` 推送到 `WangSenJie/WangSenJie.github.io` 的 `main` 分支。

### RAG API

推送包含 `blog-ai-api/` 的更新到当前仓库 `main` 分支即可触发 Vercel Git 自动部署。若需手动部署，请先完成 Vercel CLI 登录：

```bash
cd blog-ai-api
npx vercel login
npx vercel --prod
```

## 项目结构

```text
.
├── source/
│   ├── _posts/             # Markdown 文章
│   ├── _data/              # NexT 覆盖配置与页面注入
│   ├── ai-data/            # 发布到静态站点的 RAG 降级语料与 manifest
│   └── js/                 # 浏览器问答组件与共享检索核心副本
├── scripts/                # Hexo、语料和缓存处理脚本
├── blog-ai-api/            # Vercel RAG API
├── data/                   # 本地导出的完整语料
├── themes/next/            # NexT 主题
├── _config.yml             # Hexo 配置和 GitHub Pages 部署配置
└── package.json
```

## 维护提示

- 修改前端脚本、样式或主题配置后，需要执行 `npm run build && npm run deploy` 才会在博客上线。
- 修改 API、API 语料或 API 环境变量后，需要推送到 GitHub 并等待 Vercel 自动部署完成。
- 如已打开的页面仍使用旧样式或脚本，刷新页面以重新加载版本化静态资源。
