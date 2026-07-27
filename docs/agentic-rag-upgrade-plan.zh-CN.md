# 博客 Agentic RAG 升级实施方案

> 记录日期：2026-07-22
>
> 状态：已完成（阶段 0 至阶段 5 已完成）
>
> 范围：在现有 Hexo、Vercel 和 BM25 问答能力上，逐步升级为可检索、可判断、可重试、可验证的 Agentic RAG。

## 1. 背景与现状

当前博客已经具备一条可用的轻量 RAG 链路：

```text
用户问题
  -> 浏览器优先请求 Vercel API
  -> 服务端执行受控路由、查询改写、Hybrid RAG 工具检索和证据评分
  -> 必要时有限重试，并返回文章切片、引用和相关文章
  -> 可选调用 OpenAI 兼容模型组织答案
  -> API 失败时浏览器使用共享检索核心执行本地 BM25 降级
```

当前实现的主要特点：

- 语料来自 `source/_posts/`，构建时导出为 `posts.json`、`chunks.json`、`vectors.json`、`code-blocks.json`、`learning-graph.json` 和 `manifest.json`。
- 当前验收构建共有 107 篇源文章；71 篇已发布，全部产生可检索 chunk，共 964 个；32 篇未发布文章和 4 篇缺少公开 URL 的文章被跳过。PDF-only 页面会生成标题、描述和资源链接组成的元数据 chunk。单个正文 chunk 最多约 700 个字符，重叠约 100 个字符。
- 浏览器降级路径与 API 使用同一套中文二元词切分、URL 规范化和 BM25 排序核心。
- 标题、标签、分类、小节标题和当前页面会获得额外权重。
- API 已支持由浏览器携带的短对话历史、查询改写、任务路由、只读工具、Hybrid RAG 与有限检索重试；阶段 4 在其之上增加逐结论结构化引用验证、校准的证据门槛与可选反馈传输；阶段 5 增加服务端多文章对比、作者维护的学习路线/下一篇推荐与精确代码块解释。

关键实现位置：

- `scripts/build-ai-corpus.js`：文章解析与切片。
- `source/js/blog-ai-agent.js`：浏览器问答与本地 BM25 降级。
- `blog-ai-api/api/ask.js`：服务端问答入口。
- `blog-ai-api/lib/retrieval-core.js`：服务端与浏览器共用的检索核心源文件。
- `blog-ai-api/lib/embedding.js`、`blog-ai-api/lib/hybrid-retrieve.js`：离线向量、RRF 融合和重排序。
- `blog-ai-api/lib/corpus-integrity.js`：manifest、SHA-256 与语料结构校验。
- `blog-ai-api/lib/retrieve.js`：服务端 BM25 检索。
- `blog-ai-api/lib/generate.js`：基于检索结果生成回答。
- `blog-ai-api/agent/`：阶段 3 的受控 Agent 状态机与节点。
- `blog-ai-api/tools/`：六个只读博客工具，其中阶段 5 的三个专用工具用于对比、学习路线和代码块解释。
- `blog-ai-api/memory/session.js`：请求、短历史和页面上下文契约。

## 2. 升级目标

最终系统需要具备以下能力：

1. 同时理解精确关键词和语义相近的提问。
2. 根据问题自主判断是否检索、检索什么以及调用哪个工具。
3. 将上下文相关问题改写为独立查询，并在必要时拆分为子问题。
4. 判断检索证据是否充分；证据不足时最多改写并重试一到两次。
5. 基于完整证据回答，并为关键结论提供可追溯引用。
6. 支持“它”“第二篇”“继续解释”等多轮指代。
7. 支持当前页总结、多文章比较、相关文章和学习路径推荐。
8. 对站内没有答案的问题稳定拒答，不补充未经检索支持的事实。
9. 能通过固定测试集持续衡量召回、回答、延迟和成本。

本次升级不追求无边界的自主 Agent。博客场景采用有明确节点、循环上限和工具权限的受控工作流。

### 实施追踪

| 阶段 | 交付结果 | 状态 |
| --- | --- | --- |
| 阶段 0 | 评测集、BM25 基线与 trace 日志 | 已完成（2026-07-22） |
| 阶段 1 | 服务端统一检索与浏览器降级 | 已完成并验收（2026-07-22） |
| 阶段 2 | BM25 + Vector + RRF + Reranker | 已完成并验收（2026-07-24） |
| 阶段 3 | 多轮会话、Agent 工具与有限检索循环 | 已完成并回归验收（2026-07-24，当前由 Hybrid RAG 提供检索） |
| 阶段 4 | 引用验证、拒答校准与质量闭环 | 已完成并验收（2026-07-27） |
| 阶段 5 | 多文章对比、作者维护学习路径、代码块解释与下一篇推荐 | 已完成并验收（2026-07-27） |

每完成一个阶段，应在本表更新状态，并在对应阶段记录评测报告、关键决策和未解决问题。

## 3. 目标架构

```text
用户消息 + 当前页面 + 会话历史
                  |
                  v
          [意图识别与任务路由]
           /        |         \
       无需检索   当前页任务   站内知识任务
                              |
                              v
                     [查询改写与拆分]
                              |
                              v
                      [search_blog 工具]
                        /           \
                  BM25 Top K     Vector Top K
                        \           /
                         [RRF 排名融合]
                               |
                         [Reranker 重排]
                               |
                       [证据充分性判断]
                         /            \
                       充分            不充分
                        |               |
                        |        改写查询后有限重试
                        v
                  [基于证据生成回答]
                        |
                  [引用和事实一致性检查]
                        |
                        v
             Answer + Citations + Trace
```

推荐继续使用现有 Node.js 与 Vercel 部署方式。Agent 分支较少时先用普通 JavaScript 状态机实现；当分支、持久化、中断恢复等需求明显增加后，再评估 LangGraph.js。框架不应成为升级检索质量的前置条件。

## 4. 检索层设计

### 4.1 保留 BM25

BM25 继续承担精确关键词召回，尤其适合：

- 技术名词和模型名称；
- 类名、函数名与代码关键词；
- 文章标题、标签和分类；
- 用户明确给出的站内术语。

现有标题、标签、分类、小节标题和当前页加权规则继续保留，但应集中到服务端实现。

### 4.2 增加向量召回

构建语料时离线生成 chunk embedding。查询时生成 query embedding，以向量相似度召回语义相关内容。向量召回重点解决：

- 同义表达；
- 没有直接关键词重合的自然语言提问；
- 概念描述反查文章；
- 跨文章的主题关联。

第一版可以将预生成向量随 API 部署，用于验证质量。随着语料或冷启动开销增加，再迁移到支持向量索引的数据库或托管向量存储。

### 4.3 使用 RRF 融合

BM25 分数和向量相似度不在同一量纲，不直接线性相加。分别取两路 Top 20，再使用 Reciprocal Rank Fusion 合并：

```text
RRF(chunk) = 1 / (k + BM25 排名)
           + 1 / (k + 向量排名)
```

初始可令 `k = 60`，随后通过评测集调整。RRF 的主要价值是依据排名融合两路候选，不需要先校准两种分数。

### 4.4 增加重排与上下文整理

对融合后的约 20 个候选进行语义重排，保留约 5 至 8 个 chunk。进入生成模型前还需要：

- 去除相同或高度重叠的 chunk；
- 限制单篇文章占用的候选数量；
- 保留当前页的必要上下文；
- 对比较类问题保证每个比较对象都有证据；
- 按 token 预算裁剪上下文，而不是只截取固定长度 snippet。

重排分数同样不是概率意义上的置信度。拒答阈值必须通过真实问题集校准。

## 5. 数据管道设计

### 5.1 Chunk 元数据

在现有字段基础上增加稳定标识和增量索引字段：

```json
{
  "id": "stable-chunk-id",
  "contentHash": "sha256:...",
  "postId": "...",
  "postTitle": "...",
  "postUrl": "...",
  "headingPath": ["RAG", "混合检索"],
  "sectionTitle": "混合检索",
  "chunkIndex": 3,
  "tags": ["Agent", "RAG"],
  "categories": ["AI 应用"],
  "publishedAt": "2026-07-22",
  "content": "...",
  "embedding": []
}
```

`contentHash` 用于识别新增、修改和删除的 chunk，只重新计算发生变化的 embedding。

### 5.2 构建流程

```text
Markdown
  -> 解析 front matter 和标题层级
  -> 文本清洗与结构化切片
  -> 计算 contentHash
  -> 增量生成 embedding
  -> 写入关键词索引和向量索引
  -> 生成索引版本与构建报告
```

构建报告至少包含文章数、chunk 数、增删改数量、embedding 失败数量和索引版本。

## 6. Agent 工具设计

模型不直接访问底层 JSON、向量库或数据库，只能调用边界明确的只读工具。

### 6.1 第一批工具

```js
search_blog({
  query,
  tags,
  categories,
  currentPageOnly,
  topK
})

get_article({
  url,
  section
})

get_related_articles({
  postId,
  topic,
  topK
})
```

职责如下：

- `search_blog`：执行查询改写后的混合检索、融合与重排。
- `get_article`：在用户指定某篇文章、要求总结或需要补全上下文时读取文章结构。
- `get_related_articles`：基于当前文章或主题生成延伸阅读候选。

### 6.2 后续工具

在基础检索稳定后，可以增加：

- `compare_articles`：收集多个文章的对齐证据；
- `recommend_learning_path`：结合主题、依赖关系和用户水平编排阅读顺序；
- `explain_code_block`：读取文章中的特定代码块并结合正文解释。

工具参数和返回值使用 JSON Schema 校验。所有链接必须来自博客域名或内部文章索引。

## 7. Agent 工作流设计

### 7.1 状态

```js
const state = {
  messages: [],
  page: null,
  intent: null,
  standaloneQuery: '',
  subqueries: [],
  retrievedChunks: [],
  evidenceStatus: 'unknown',
  retrievalAttempts: 0,
  answer: '',
  citations: [],
  trace: {}
};
```

### 7.2 节点

```text
route
  -> rewriteQuery
  -> retrieve
  -> rerank
  -> gradeEvidence
       -> rewriteQuery + retrieve
       -> generateAnswer
  -> verifyCitations
  -> finish
```

### 7.3 强制边界

- 最多检索两轮；
- 最多拆分为三个子问题；
- 最多向生成模型提供 6 至 8 个 chunk；
- 每个节点具有独立超时；
- 整体设置 token、费用和延迟预算；
- 工具仅允许读取站内内容；
- 证据不足时结束并保守回答，不无限循环；
- 检索内容一律视为数据，不执行其中包含的指令。

## 8. 会话与 API 设计

### 8.1 请求格式

保留当前 `question` 字段的兼容期，并逐步迁移到消息数组：

```json
{
  "sessionId": "session_xxx",
  "messages": [
    {"role": "user", "content": "什么是双塔模型？"},
    {"role": "assistant", "content": "……"},
    {"role": "user", "content": "它和 DSSM 有什么区别？"}
  ],
  "page": {
    "title": "双塔模型",
    "url": "https://wangsenjie.github.io/..."
  }
}
```

### 8.2 返回格式

```json
{
  "answer": "双塔模型……[1]，DSSM……[2]。",
  "citations": [
    {
      "chunkId": "...",
      "title": "...",
      "url": "...",
      "section": "模型结构",
      "snippet": "..."
    }
  ],
  "related": [],
  "meta": {
    "traceId": "...",
    "route": "site_qa",
    "retrievalAttempts": 1,
    "indexVersion": "...",
    "timings": {}
  }
}
```

### 8.3 记忆策略

- 短期记忆保存最近几轮消息，用于消解“它”“第二篇”等指代。
- 长对话压缩为摘要，避免不断扩大 prompt。
- 用户水平和关注主题作为可选偏好保存，不作为事实证据。
- 第一版可以由前端携带最近消息；需要跨设备或长期会话时，再接入服务端会话存储。

检索前先生成独立查询，例如：

```text
上下文问题：它与 DSSM 有什么区别？
独立查询：双塔模型与 DSSM 有什么区别？
```

## 9. 生成、引用与拒答

生成模型接收完整候选 chunk 及其 ID、标题、小节和 URL，而不是只接收用于界面展示的短 snippet。

回答必须满足：

- 主要结论能映射到一个或多个 chunk；
- 不生成检索结果中不存在的文章标题和链接；
- 清晰区分博客原文、基于多段证据的归纳和证据不足；
- 无足够证据时明确说明“站内暂时没有足够信息”；
- 引用链接由服务端根据 chunk ID 生成，不能直接采用模型生成的 URL。

生成后执行轻量验证：

1. 每个关键结论是否有引用；
2. 引用内容是否支持对应结论；
3. 是否存在语料之外的事实性补充；
4. 引用 ID 与服务端候选是否一致；
5. 失败时删除无依据内容，必要时转为拒答。

## 10. 前后端职责

生产模式的服务端是检索和引用的唯一事实来源：

```text
浏览器 -> Agent API -> 服务端检索、生成与验证
```

浏览器本地 BM25 继续保留为 API 不可用时的降级能力：

```text
网络错误 / 超时 / 非 2xx / 无效响应
  -> 本地 BM25
  -> 返回文章和片段，不调用模型
```

前端正常请求只发送问题、模式和当前页面上下文，不再发送本地候选内容。服务端始终忽略旧客户端可能提交的候选片段，以自己的已校验索引作为唯一事实来源。合法的服务端拒答或不含引用的有效响应不会触发浏览器降级。

通用分词、URL 规范化、有效 chunk 过滤和 BM25 排序已集中在 `blog-ai-api/lib/retrieval-core.js`。语料导出时将其复制为 `source/js/blog-ai-retrieval.js`，供浏览器故障路径使用，从而避免两套检索规则漂移。

服务端引用契约为 `chunkId`、`title`、`url`、`section`、`snippet`。响应同时返回 `meta.indexVersion`，它等于 manifest 的 `corpusVersion`；只有将 `indexVersion` 与 `chunkId` 组合起来，才能追溯同一索引版本中的原始 chunk。跨版本稳定 chunk ID 不属于阶段 1，留到阶段 2 设计。

`manifest.json` 对 `posts.json` 和 `chunks.json` 分别记录 SHA-256 与记录数，并汇总语料统计和完整性告警。构建、同步和服务端加载会强校验文件哈希、数组与计数、文章 URL 唯一性、chunk ID 唯一性、chunk 可索引性以及 chunk 与已发布文章的归属关系。

## 11. 安全与稳定性

- 模型密钥只存放在服务端环境变量中。
- 保留 CORS 白名单，并增加请求体大小与问题长度限制。
- 增加按来源 IP 或会话的速率限制。
- 对模型输出做 HTML 转义，引用 URL 使用站内白名单校验。
- 不记录密钥、完整授权头和不必要的用户隐私数据。
- 对 embedding、rerank 和生成分别设置超时与降级策略。
- 生成失败时返回检索结果；向量服务失败时降级为 BM25。
- 每次响应返回 `traceId`，便于定位检索和模型调用问题。

## 12. 评测与可观测性

### 12.1 测试集

建立 80 至 120 个固定问题，覆盖：

- 精确关键词；
- 同义和语义改写；
- 当前页总结；
- 多轮指代；
- 多文章比较；
- 学习路径；
- 博客中不存在答案的问题；
- 容易召回错误文章的相似概念。

每个样本至少标注：问题类型、相关文章、相关 chunk、关键答案点和是否应拒答。

### 12.2 指标

| 层级 | 指标 |
| --- | --- |
| 召回 | Recall@5、Recall@20 |
| 排序 | MRR、nDCG、正确 chunk 的 Top 5 命中率 |
| 回答 | 事实正确率、引用支持率、引用完整率、拒答正确率 |
| Agent | 路由正确率、工具选择正确率、平均检索轮数 |
| 工程 | P50/P95 延迟、token 成本、调用成本、失败率、降级率 |

所有检索策略、阈值、embedding 模型或 reranker 的变更都应运行回归评测。上线后增加“有帮助/没帮助”反馈，并将失败问题整理回离线测试集。

## 13. 推荐代码结构

```text
blog-ai-api/
  api/
    ask.js
  agent/
    run.js
    state.js
    prompts.js
    nodes/
      route.js
      rewrite-query.js
      retrieve.js
      grade-evidence.js
      generate-answer.js
      verify-citations.js
  tools/
    search-blog.js
    get-article.js
    get-related-articles.js
  retrieval/
    bm25.js
    vector.js
    rrf.js
    rerank.js
    context.js
  memory/
    session.js
  evals/
    dataset.json
    run.js
    report.js
  data/
    posts.json
    chunks.json
    embeddings.json
    manifest.json
  scripts/
    sync-corpus.js
    embed.js
    build-index.js
```

## 14. 分阶段实施计划

### 阶段 0：建立基线

任务：

- 建立第一批 30 至 50 个标注问题，随后扩充到 80 至 120 个。
- 记录当前 BM25 的 Recall@K、MRR、错误召回和无答案表现。
- 为 API 增加基础耗时与 trace 日志。

完成标准：能够用同一套问题重复比较新旧检索效果。

实施结果（2026-07-22）：

- 建立 40 个固定问题，包含 34 个站内正例和 6 个无答案样例。
- 增加无依赖评测 runner，输出文章级 Recall@5/20、HitRate@5、MRR@20、nDCG@20、拒答率和分类指标。
- 使用规范化后的有效文章 URL 去重，并记录语料 SHA-256，保证报告可复现。
- API 响应和 `X-Trace-Id` 响应头增加 trace ID。
- 记录语料加载、BM25 检索、响应构建、模型生成和总耗时。
- 增加 Node 内置测试，覆盖检索、指标、trace、API 校验、模型成功和模型降级。

BM25 基线：

| 指标 | 结果 |
| --- | ---: |
| 正例 Recall@5 / HitRate@5 | 0.9118 |
| 正例 Recall@20 | 0.9706 |
| MRR@20 | 0.8179 |
| nDCG@20 | 0.8547 |
| 无答案拒答准确率 | 0 |

已确认的基线问题：

- 定义题规则可能奖励与查询实体无关的定义性段落。
- 当前检索只要求分数大于零，六个无答案问题全部产生了错误候选。
- 60 个空 URL chunk 会参与 BM25 索引并可能污染排序或引用。
- SVM、MLP 和 Logistic Regression 是 PDF-only 页面，当前清洗后没有正文 chunk；仅增加向量检索无法修复这类语料缺失。

评测数据与完整报告：

- `blog-ai-api/evals/dataset.json`
- `blog-ai-api/evals/reports/bm25-baseline.json`

### 阶段 1：服务端统一检索

任务：

- 生产模式只采用服务端返回的检索与引用。
- 浏览器 BM25 仅作为断网或 API 失败时的降级。
- 抽取共享分词逻辑，消除不必要的重复实现。
- 服务端忽略客户端提交的候选内容。
- 过滤空 URL chunk，阻止生成不可点击引用，并输出语料完整性告警。

完成标准：线上引用均能由服务端 chunk ID 追溯，降级路径仍可使用。

实施与验收结果（2026-07-22）：

- 正常路径改为服务端 API 优先；成功响应不会下载浏览器静态语料或执行本地 BM25。
- 浏览器仅在网络错误、20 秒请求超时、非 2xx 状态或无效响应时，按需加载 `chunks.json` 并执行 BM25 降级。
- 前端请求不再包含 `retrieval.sources`；服务端忽略旧客户端可能发送的候选内容。
- 服务端与浏览器通过共享检索核心保持分词、URL 规范化、有效 chunk 判断和 BM25 排序一致。
- 引用完整返回 `chunkId`、`title`、`url`、`section`、`snippet`；`meta.indexVersion + chunkId` 可追溯到同一索引版本。
- manifest 为 posts/chunks 提供 SHA-256、计数和语料版本，并在导出、同步与加载时执行结构强校验。
- Hexo 构建会逐条核对导出的文章 URL 与实际生成路由；本阶段修正了 2 条历史 slug 偏差，验收结果为 69/69 文章链接可点击。
- 当前验收语料统计为 69 篇 published posts、66 篇 indexed posts 和 886 个 chunks；32 篇 unpublished posts 已跳过；Logistic Regression、MLP、支持向量机 3 篇 PDF-only 文章因无可索引正文而没有 chunk。
- 阶段 0 的基线报告与指标保留为历史比较基准；阶段 1 使用仅指向已发布文章的数据集 v2 另存 `bm25-phase1.json`，不覆盖历史报告。
- 阶段 1 验收指标为 Recall@5 `0.9118`、Recall@20 `0.9706`、MRR@20 `0.8258`、nDCG@20 `0.8602`；无答案拒答准确率仍为 `0`，属于后续阶段的已知问题。
- 跨版本稳定 chunk ID 明确留到阶段 2；阶段 1 的 `chunkId` 只保证在对应 `indexVersion` 内可追溯。

### 阶段 2：Hybrid RAG

实施与验收结果（2026-07-24）：

- chunk ID 以文章公开 URL、标题路径、重复标题出现序号和小节内序号为定位键；正文或元数据变化不会改变同一结构位置的 ID。每个 chunk 同时具有覆盖正文、标题、分类、标签和资源链接的 `contentHash`。
- manifest 升级为 schema v2，完整性校验同时覆盖 `posts.json`、`chunks.json` 和 `vectors.json` 的 SHA-256、条数、embedding 维度与每个 vector 对应的 `chunkId + contentHash`。`corpusVersion` 也包含 vector 文件哈希。
- 构建期使用依赖零外部服务的 `local-semantic-hash-v1` 离线 embedding（384 维、概念簇加权）；增量构建仅复用同一 `contentHash` 且 embedding 版本一致的向量。当前报告为 964 个新增向量、0 个失败。后续可替换该 provider，而不改变 vectors 文件、Hybrid 工具或 Agent 契约。
- `search_blog` 与 `get_related_articles` 分别取得 BM25 Top 20 和 Vector Top 20，以 `k=60` 的 Reciprocal Rank Fusion 合并；随后使用语义相似度、词项覆盖、标题命中和当前页信号重排。相同正文去重，每篇文章最多保留 3 个候选；当前页候选会保留。`get_article` 继续按源文顺序读取，不参与排序。
- Agent 上下文选择继续强制 8 个完整 chunk、12,000 字符和保守 6,000 token 上限，并新增正文去重和单文章 3 个 chunk 配额。
- PDF-only 页面现在产生 `文章元数据` chunk，至少包含文章标题、描述、标签/分类和站内资源链接；PDF 全文抽取仍属于后续语料增强工作。
- 独立 Hybrid 数据集 `evals/hybrid-dataset.json` 对同一批题目分别运行 BM25 与 Hybrid：语义题 Recall@5 从 `0.6000` 升至 `0.9000`，MRR@20 从 `0.4035` 升至 `0.5917`；精确题 Recall@5 与 MRR@20 均保持 `1.0000`。验收通过。

完成标准：已满足。语义改写类问题的召回明显优于基线，精确关键词问题未退化。

### 阶段 3：多轮会话与 Agent 工作流

任务：

- API 支持 `messages`、`sessionId` 和页面上下文。
- 实现意图路由、独立查询改写和子问题拆分。
- 将检索、全文读取和相关文章封装为工具。
- 实现证据评分和最多两轮检索。
- 设置循环、token、成本和超时上限。

完成标准：能够正确处理多轮指代、文章比较和证据不足后的有限重试。

实施与验收结果（2026-07-23，2026-07-24 Hybrid 回归）：

- `/api/ask` 同时兼容旧 `question` 请求和新的 `messages + sessionId + page` 请求。`sessionId` 只用于请求关联，不代表认证或服务端持久会话；浏览器携带最近最多 8 条消息，服务端不使用不可靠的 Vercel 进程内会话 Map。
- API handler 会同时检查 `Content-Length` 与已解析/序列化请求体，应用层上限为 32 KB；当前问题限制为 1,000 字，单条历史限制为 2,000 字，历史总量限制为 8,000 字，只接受 `user` 和 `assistant` 角色。POST 必须使用 `application/json`，带有非白名单浏览器 Origin 的请求会直接返回 403，而不是只依赖浏览器隐藏响应。客户端历史引用必须重新映射到当前 corpus，且只读取最近一个 assistant turn 的引用和独立查询元数据：最近一轮没有引用时会形成安全屏障，不会回退到更早文章；历史回答正文不能作为事实证据。由于托管平台可能先于 handler 解析请求体，生产环境仍需在网关或平台层配置同等或更严格的上游大小限制。
- 使用普通 JavaScript 实现显式受控状态机：`route -> rewrite -> split -> retrieve -> grade -> retry/answer`。固定路由覆盖直接回复、当前页总结、当前页问答、相关文章、文章比较和全站问答。
- 已封装 `search_blog`、`get_article`、`get_related_articles` 三个白名单只读工具。工具严格校验参数、站内 URL 和 `topK`，返回完整 chunk 副本，不允许模型选择任意工具或修改语料。
- 支持“它”“这两篇”“第一篇/第二篇”“前者/后者”“继续解释”等指代，历史文章标题只从当前语料重新解析；比较题和复合问题最多拆成 3 个子查询。
- 结构性证据评分不足时只允许改写后再检索一次；最多 2 轮、6 次工具调用。两轮仍不足时返回有效的保守回答且不调用模型。阶段 4 已将用于拒答的结构性覆盖门槛从该受控流程中抽出，使用独立校准集选择；它仍不是概率意义上的置信度。
- 上下文最多保留 8 个完整 chunk、12,000 字符和保守估算 6,000 tokens；模型最多调用 1 次，输出预算默认 700 tokens；服务端总时限 17 秒，生成节点 10 秒。token 预算当前按“一个 Unicode 字符至多计一个 token”的保守近似执行，并不等同于具体模型 tokenizer。若配置模型输入/输出单价和单请求美元上限，还会将上下文、历史、页面和问题的估算输入一并纳入调用前成本检查；未配置单价时只执行调用次数与 token 上限。
- 生成模型接收完整候选 chunk，而不是只接收 140 字展示 snippet。用户输入、页面信息、对话历史和检索正文均标记为不可信数据；最终引用 ID、标题和 URL 始终由服务端语料生成。
- 浏览器使用带 2 小时 TTL 的 `sessionStorage` 保存短会话，并提供“新对话”按钮；重置会中止当前请求并忽略迟到响应，busy 状态会阻止重复提交。合法的服务端拒答仍不会触发本地 BM25 降级。
- trace 增加路由、改写、逐轮检索、逐轮证据评分和生成耗时；响应增加 `route`、`standaloneQuery`、`subqueries`、`retrievalAttempts`、`evidenceStatus`、`stopReason`、工具调用摘要和预算快照。
- 新增独立阶段 3 离线数据集与报告，不覆盖阶段 0/1 的 BM25 历史。全量 Node 测试通过，其中浏览器运行时测试实际覆盖合法服务端拒答不触发本地降级、重置后忽略迟到响应、会话 TTL 过期清理和空引用轮次清除旧锚点；真实语料验收为 28/28 用例通过，并覆盖消息内指代、嵌套文章标题、显式标题总结/相关文章工具、推荐领域概念与阅读推荐的路由消歧、顿号/前者形式的文章比较，以及“第二篇”问答只检索所选文章；路由、改写、工具选择、文章覆盖、多轮指代、文章比较、安全停止、限制遵守和旧请求兼容指标均为 `1.0`，平均检索轮数 `1.0`、最大轮数 `2`。
- 阶段 3 Agent 离线回归为 28/28 用例通过，路由、改写、工具选择、文章覆盖、多轮指代、文章比较、安全停止、限制遵守和旧请求兼容指标均为 `1.0`；`search_blog` 与 `get_related_articles` 已报告 `hybrid_rrf_rerank`，而 `get_article` 保持源文顺序读取。

阶段边界与未解决问题：

- 阶段 2 已实施。浏览器 API 正常路径使用服务端 Hybrid RAG；浏览器本地降级继续使用 BM25，以保持无网络、无向量下载场景的轻量和可预测性。`bm25_multi_query` 仅表示多子查询，正常单查询的 API 元数据会标记为 `hybrid_rrf_rerank`。
- 阶段 4 的逐结论引用验证、拒答阈值校准和可选反馈传输已接入。引用验证要求 quote 来自选中 chunk，并采用抽取式发布规则：空白规范化后模型结论必须等于 quote，确定性回答只允许添加服务端拥有的 `《文章标题》：` 前缀。这不等同于通用自然语言蕴含证明；复杂语义需求仍应通过离线样本扩充和人工复核发现。
- 当前仍是单标签页短期记忆，不支持跨设备或长期账户会话。阶段 5 已评估持久存储，但因尚无身份、授权、保留和删除策略，未把学习进度或会话写入服务端。
- 阶段 3 的基础双文章比较已由阶段 5 的受控维度对齐工具补充；学习路线与“下一篇”仅来自作者维护的图，不从标签、日期或向量相似度推断依赖关系。
- 当前接口还没有用户鉴权、按 IP/会话的分布式速率限制和跨实例全局费用账本。公开接入付费模型前，必须在 Vercel 网关/WAF 或持久化存储层增加限流与滥用保护，并同时设置模型供应商预算告警；现有单请求成本上限不能替代这些生产控制。

评测数据与报告：

- `blog-ai-api/evals/hybrid-dataset.json`
- `blog-ai-api/evals/reports/hybrid-phase2.json`
- `blog-ai-api/evals/agent-dataset.json`
- `blog-ai-api/evals/reports/agent-phase3.json`

### 阶段 4：引用验证与质量闭环

实施与验收（2026-07-27）：

- 回答新增 `claims` 契约。每条事实性结论都包含 `text`、唯一的 `citationIds`、`citationIndexes` 与 `quote`；服务端从选中的当前索引 chunk 重新构造 `chunkId`、标题、URL、小节和摘要，模型不能自行提供 URL 或引用元数据。
- 新增引用验证节点。它拒绝空/过多/超长结论、不是唯一引用的结论、未选中或不存在的 chunk ID，以及无法在原 chunk 中找到的 quote。所有公开事实结论采用抽取式规则：空白规范化后模型 `text` 必须与 quote 相同；确定性回答最多只能在该原 quote 前添加来自 cited chunk 的服务端 `《文章标题》：` 前缀。草稿失败时先退回确定性结论，仍不能通过则返回不带引用的保守拒答。
- 响应增加 `meta.citationVerification`、`meta.evidenceCalibration` 和引用验证耗时。`citationVerification.status` 为 `verified` 时，所有公开结论都有一个已验证的选中 chunk；`not_required` 只用于非事实的直接/澄清回复。验证失败会把证据状态归为不足，不保留旧引用或 related 结果。
- 新增 `phase4-dataset.json`：校准集和 holdout 集严格分开，覆盖精确命中、边界正例、当前页问答、比较、站外主题、缺失比较对象和“文章标题命中但正文并不支持该细节”的难负例。runner 仅在校准集网格中选择 coverage gate，再对 holdout 检查引用完整率、引用支持率、来源一致性、无依据结论率、拒答精确率/召回率、回答通过率和路由正确率。当前配置 `phase4-v1` 的站内/复合问题门槛为 `0.23`；这是证据门槛，不是用户可解释的概率置信度。
- 新增 `POST /api/feedback`，但默认关闭。只有 `FEEDBACK_RECEIPT_SECRET`、`FEEDBACK_WEBHOOK_URL` 和 `FEEDBACK_WEBHOOK_SECRET` 均有效时，`/api/ask` 才签发短期 receipt，浏览器才展示“有帮助/需要改进”。客户端只提交 receipt、评分和预定义原因；不接受自由文本。
- 默认 feedback receipt 和转发 event 不含原始问题、回答、会话 ID、IP 或浏览器标识，只包含质量归因所需的索引/路由/验证/引用元数据与回答摘要哈希。若运营方在告知用户并设置保留策略后，额外启用 `FEEDBACK_INCLUDE_REVIEW_CONTEXT=true`（也接受 `1`/`yes`）和独立的、至少 32 字符的 `FEEDBACK_REVIEW_CONTEXT_SECRET`，服务端才会把当前 `question` 规范化并限为 320 字符，以 AES-256-GCM 密文放入 signed receipt。浏览器不读明文；服务端仅在 `not_helpful` 反馈时解密并向 webhook 增加 `reviewQuestion`，不携带回答、会话或历史消息。接收端必须按最小权限存储该可选字段、加密静态数据、设置短保留期和删除流程。
- 转发只允许 HTTPS webhook，且以 `v1.<timestamp>.<raw JSON body>` 的 HMAC-SHA256 签名；接收方必须检查时间戳、验证签名，并以 `Idempotency-Key`/`receiptId` 做持久化去重。此 API 是无状态传输，不能自行阻止有效 receipt 的重放或网络重试后的重复投递。
- 添加 `eval:phase4`、`eval:phase4:update` 命令和 `RAG quality` CI 工作流。CI 在 Node 20 下运行 API 单测、Hybrid 评测、阶段 3 Agent 评测和阶段 4 评测；默认评测不写工作树，只有显式 `:update` 才生成 `evals/reports/phase4.json`。

完成标准：关键结论均有可验证引用，无答案问题能够稳定拒答，并且所有阶段 4 holdout 指标通过。运行命令如下：

```bash
npm --prefix blog-ai-api test
npm --prefix blog-ai-api run eval:hybrid
npm --prefix blog-ai-api run eval:agent
npm --prefix blog-ai-api run eval:phase4
```

阶段边界：抽取式验证能防止引用 ID/URL 伪造、无 quote、错误来源以及“高词面重合但改变事实”的改写，但它不产生新的解释性综合结论，也不是通用语义事实核验器。反馈 webhook 默认只提供最小化的聚合质量信号；可选的 `reviewQuestion` 仅可复原一条受限问题，不能复原回答或完整会话。任何启用该字段或更强会话复盘的机制都必须另行取得适当授权，并定义保留、访问控制和删除策略。

### 阶段 5：扩展博客 Agent 能力

实施与验收（2026-07-27）：

- 语料 manifest 升级为 schema v3。`code-blocks.json` 保存 Markdown 原始围栏代码、稳定的代码块 ID、页面锚点、章节、行号、关联 chunk 与内容哈希；`learning-graph.json` 保存学习节点、路线和边。导出、同步和加载均校验这两份工件的 SHA-256、计数、文章/代码块关联和图结构，防止 API 使用过期或错配的代码与路线数据。当前验收语料包含 395 个代码块、4 条路线、15 个学习节点和 22 条显式边。
- 构建期使用 Markdown-it 解析围栏代码，并在 Hexo 渲染后的对应高亮代码容器前注入同一语料生成的安全锚点。因此代码解释返回的是站内某个可定位的原始代码块，而不是从普通文本 chunk 重新拼接代码。
- 新增 `compare_articles` 只读工具：仅接受当前语料中已知的站内文章 URL，按“核心原文、实现/方法、流程/步骤、适用场景、优点/特点、局限/注意项”对齐来源 chunk。每个可展示单元都回连到原文；某一维度没有来源时显式返回缺口和 `partial`，不会用模型或相似文章补写。
- 新增 `recommend_learning_path` 只读工具：只读取 `scripts/learning-graph-config.js` 中经作者维护的顺序。目前包含 Agent 开发、数学分析、前端与 Vue、循环神经网络四条路线；已知当前文章时只返回下一篇，未知主题或未配置路线时安全说明不可推荐，不把相关性伪装成前置依赖。
- 新增 `explain_code_block` 只读工具：只能按当前站内文章、语料生成的稳定代码块 ID、序号、章节或受限查询选择代码块；不接受任意代码、不执行代码、不访问外网。回答同时展示原始代码与同一文章中的可验证文字上下文，事实性说明仍须通过阶段 4 的逐结论引用验证。
- Agent 增加高级比较、学习路线/下一篇和代码解释三类专用路由。它们各自调用一个确定性的只读工具并返回结构化结果；专用路线不调用外部生成模型，基础问答仍保留原有 Hybrid RAG、有限重试和引用约束。
- 浏览器将服务端的对比矩阵、路线步骤和带锚点的代码块分别渲染为结构化卡片，并对文本与代码进行 HTML 转义。API 不可用时，本地 BM25 降级不会假装能够完成多维对比、依赖路线或代码语义解释，而是明确提示这些能力需要服务端语料工件。
- 新增阶段 5 离线评测，覆盖多文章维度对齐及缺口、已维护路线与当前文章的下一篇、未配置路线的安全停止、精确代码块选择/锚点及其引用验证；同时保留阶段 2 Hybrid、阶段 3 Agent 和阶段 4 引用验证回归。

完成标准：已满足。扩展能力均经白名单只读工具接入，来源性结论继续接受逐结论引用验证；导航型学习结果只表达作者维护的阅读元数据，不把它包装为可验证的博客事实。

运行命令如下：

```bash
npm --prefix blog-ai-api test
npm --prefix blog-ai-api run eval:hybrid
npm --prefix blog-ai-api run eval:agent
npm --prefix blog-ai-api run eval:phase4
npm --prefix blog-ai-api run eval:phase5
```

阶段边界与隐私决策：阶段 5 没有新增跨设备档案、账户学习进度或服务端长会话。学习路线只基于本次请求给出的主题、当前文章和可选已完成文章，浏览器仍只使用短期 `sessionStorage` 会话；服务端不据此建立用户画像。若未来需要持久化学习路径，必须先增加明确身份与用户同意、数据最小化、加密与访问控制、保留期限和可验证删除流程。当前学习图也只覆盖作者已审阅的少数路线；未配置的主题必须拒绝推荐。代码工具提供的是定位和受限上下文解释，不是代码执行器、安全审计器或通用编程助手。

## 15. 总体验收标准

- 博客中存在答案的问题能召回正确文章和具体小节。
- 同义提问、上下文指代和多文章问题达到预设评测指标。
- 每个关键结论都有可点击、可追溯的站内引用。
- 博客中没有答案时不使用模型常识补齐。
- 任一外部模型服务失败后仍能降级返回安全、可用的检索结果。
- Agent 循环次数、上下文大小、接口延迟和单次成本均有上限。
- 检索、重排、生成和验证的耗时能够通过 `traceId` 定位。
- 语料更新支持增量索引，不需要每次重算全部 embedding。

## 16. 当前决策摘要

1. 保留 BM25，并新增向量召回；目标是混合检索，不是用向量完全替代关键词检索。
2. 使用 RRF 融合两路排名，再通过 reranker 选出最终上下文。
3. 服务端是生产检索和引用的唯一事实来源，浏览器检索只负责降级。
4. Agent 使用受控状态图，最多进行两轮检索。
5. 先用现有 JavaScript 技术栈实现，复杂度达到需要时再引入工作流框架。
6. 先建立评测基线，再更换召回、模型或存储方案。
7. 阶段 3 先建立了可替换的 Agent 工具和工作流接口；阶段 2 已替换 `search_blog` 与 `get_related_articles` 的内部检索实现，不改多轮请求与受控循环契约。

## 17. 参考资料

- [LangGraph：Build a custom RAG agent with LangGraph](https://docs.langchain.com/oss/python/langgraph/agentic-rag)
- [Elasticsearch：Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html)
- 项目早期规划：`docs/ai-agent-implementation.zh-CN.md`
