# 博客 Agentic RAG 升级实施方案

> 记录日期：2026-07-22
>
> 状态：待实施
>
> 范围：在现有 Hexo、Vercel 和 BM25 问答能力上，逐步升级为可检索、可判断、可重试、可验证的 Agentic RAG。

## 1. 背景与现状

当前博客已经具备一条可用的轻量 RAG 链路：

```text
用户问题
  -> 浏览器或 Vercel API 执行 BM25 检索
  -> 返回最相关的文章切片、引用和相关文章
  -> 可选调用 OpenAI 兼容模型组织答案
```

当前实现的主要特点：

- 语料来自 `source/_posts/`，构建时导出为 `posts.json` 和 `chunks.json`。
- 语料包含 101 条文章记录和 1029 个 chunk；其中 81 篇已发布文章实际产生了 969 个可检索 chunk。单个 chunk 最多约 700 个字符，重叠约 100 个字符。
- 浏览器端和 API 端分别实现了一套中文二元词切分与 BM25 排序。
- 标题、标签、分类、小节标题和当前页面会获得额外权重。
- API 每次只处理一个问题，没有对话记忆、查询改写、向量召回、重排和证据验证。

关键实现位置：

- `scripts/build-ai-corpus.js`：文章解析与切片。
- `source/js/blog-ai-agent.js`：浏览器问答与本地 BM25 降级。
- `blog-ai-api/api/ask.js`：服务端问答入口。
- `blog-ai-api/lib/retrieve.js`：服务端 BM25 检索。
- `blog-ai-api/lib/generate.js`：基于检索结果生成回答。

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
| 阶段 1 | 服务端统一检索与浏览器降级 | 未开始 |
| 阶段 2 | BM25 + Vector + RRF + Reranker | 未开始 |
| 阶段 3 | 多轮会话、Agent 工具与有限检索循环 | 未开始 |
| 阶段 4 | 引用验证、拒答校准与质量闭环 | 未开始 |
| 阶段 5 | 多文章对比、学习路径等扩展能力 | 未开始 |

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

浏览器本地 BM25继续保留为 API 不可用时的降级能力：

```text
Agent API 失败 -> 本地 BM25 -> 返回文章和片段，不调用模型
```

服务端不信任客户端传入的候选片段。为避免两套 BM25 逻辑逐渐偏离，可以把通用分词和排序实现提取为共享模块；生产结果仍以服务端为准。

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

### 阶段 2：Hybrid RAG

任务：

- 增加稳定 chunk ID、`contentHash` 和索引 manifest。
- 为 PDF-only 页面生成至少包含标题、描述和资源链接的元数据 chunk；需要全文问答时增加 PDF 文本抽取。
- 离线生成 embedding，并支持增量更新。
- 实现 BM25 与向量双路召回。
- 使用 RRF 合并候选，并增加 reranker。
- 增加去重、当前页保留和 token 预算控制。

完成标准：语义改写类问题的召回明显优于基线，精确关键词问题不退化。

### 阶段 3：多轮会话与 Agent 工作流

任务：

- API 支持 `messages`、`sessionId` 和页面上下文。
- 实现意图路由、独立查询改写和子问题拆分。
- 将检索、全文读取和相关文章封装为工具。
- 实现证据评分和最多两轮检索。
- 设置循环、token、成本和超时上限。

完成标准：能够正确处理多轮指代、文章比较和证据不足后的有限重试。

### 阶段 4：引用验证与质量闭环

任务：

- 生成结构化答案和引用。
- 增加引用一致性与无依据内容检查。
- 校准拒答阈值。
- 增加反馈入口、评测报告和 CI 回归任务。

完成标准：关键结论均有可验证引用，无答案问题能够稳定拒答。

### 阶段 5：扩展博客 Agent 能力

任务：

- 多文章对比；
- 个性化学习路径；
- 代码块解释；
- 根据文章依赖关系推荐下一篇；
- 必要时引入持久会话和工作流框架。

完成标准：新增能力以工具方式接入，不破坏基础站内问答和引用约束。

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
7. 先完成 Hybrid RAG，再增加多轮和 Agent 决策能力。

## 17. 参考资料

- [LangGraph：Build a custom RAG agent with LangGraph](https://docs.langchain.com/oss/python/langgraph/agentic-rag)
- [Elasticsearch：Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html)
- 项目早期规划：`docs/ai-agent-implementation.zh-CN.md`
