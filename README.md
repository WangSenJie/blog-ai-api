# DMH's Blog

> 数学、机器学习与编程学习笔记。

线上地址：[wangsenjie.github.io](https://wangsenjie.github.io)

这是一个基于 [Hexo](https://hexo.io/) 和 [NexT](https://theme-next.js.org/) 的静态博客。除文章展示外，项目还包含一个部署在 Vercel 的站内 RAG 问答 API，支持按文章正文、标签和小节标题检索内容。

## 功能

- Markdown 写作、分类、标签、归档、站内搜索与 RSS。
- MathJax 数学公式渲染。
- PDF 文章内嵌预览。
- 浏览器端 BM25 检索与 Vercel RAG API。
- 可选 OpenAI 兼容模型回答，回答附带站内文章引用。
- 静态资源内容哈希，降低 GitHub Pages 缓存导致的样式或脚本更新延迟。

## 技术栈

- Node.js、Hexo 7、NexT。
- GitHub Pages：静态博客部署。
- Vercel Serverless Functions：`blog-ai-api/api/ask.js`。
- JSON 语料、中文二元词切分和 BM25 排序：站内检索。

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
        +--> data/posts.json, data/chunks.json
        +--> source/ai-data/*.json       (浏览器本地检索)
        |
        v
blog-ai-api/scripts/sync-corpus.js
        |
        v
blog-ai-api/data/*.json                 (Vercel API 检索)
```

浏览器和 API 都使用 BM25 检索；标题、标签、分类和小节标题会获得额外权重。对于“什么是 X”“X 的定义”等问题，定义性段落会优先排序。

当前 BM25 基线使用 40 个固定问题评估，完整数据集和报告位于 `blog-ai-api/evals/`。后续检索改动应先运行 `npm run eval:ai`，与该基线比较后再上线。

### 更新语料

每次新增或修改文章后，依次执行：

```bash
npm run export:ai
cd blog-ai-api
npm run sync:corpus
cd ..
```

然后提交并推送 `data/`、`source/ai-data/` 和 `blog-ai-api/data/` 的更新。Vercel 项目应以 `blog-ai-api` 为 Root Directory，并通过 Git 集成自动部署。

### API 环境变量

在 Vercel 中配置以下变量：

| 变量 | 说明 |
| --- | --- |
| `ALLOWED_ORIGIN` 或 `ALLOWED_ORIGINS` | 允许访问 API 的博客域名；后者支持逗号分隔的多个域名。 |
| `LLM_API_BASE_URL` | 可选，OpenAI 兼容 API 地址。 |
| `LLM_API_KEY` | 可选，模型服务密钥。 |
| `LLM_MODEL` | 可选，模型名称。 |
| `LLM_API_PATH` | 可选，默认 `/chat/completions`。 |

未配置 `LLM_*` 时，API 仍会返回基于站内语料的检索结果。`http://localhost:4000` 和 `http://127.0.0.1:4000` 已允许用于本地预览。

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
│   ├── ai-data/            # 发布到静态站点的 RAG 语料
│   └── js/blog-ai-agent.js # 浏览器端问答组件
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
