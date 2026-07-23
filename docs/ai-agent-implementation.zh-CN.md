# 博客 AI Agent 实施方案

> 本文保留第一版站内助手的设计背景。截至 2026-07-23，阶段 0、阶段 1 和阶段 3 已完成：当前实现已经具备短期多轮会话、受控 Agent 工具和有限检索循环；阶段 2 的 Hybrid RAG 尚未实施。最新状态与后续边界以 [`agentic-rag-upgrade-plan.zh-CN.md`](./agentic-rag-upgrade-plan.zh-CN.md) 为准。

## 目标

为当前 Hexo 博客建设一个基于站内内容的 AI 助手。这个助手的核心能力不是通用闲聊，而是：

- 回答博客中已经写过的问题
- 总结当前文章
- 推荐相关文章
- 按主题给出阅读路径

由于这个博客是静态站点，且部署在 GitHub Pages 上，因此不适合把模型调用直接放在前端，也不适合把服务端逻辑塞进 Hexo 本体。更合适的方式是拆成三层：

- 博客前端：负责展示聊天入口、采集当前页面上下文、渲染回答结果
- 外部 API 服务：负责检索、拼装 Prompt、调用模型
- 构建期数据管道：负责扫描文章、切分内容、导出检索数据

## 结合你当前博客的推荐架构

### 1. 前端层

建议通过 NexT 的自定义注入点，把一个浮动 AI 助手挂到这里：

- [source/_data/body-end.swig](/Users/wangsenjie/Sites/blog/source/_data/body-end.swig)

这个前端组件负责：

- 打开和关闭聊天面板
- 发送问题到后端 API
- 渲染回答、引用来源、相关文章
- 当用户询问“当前文章”时，把当前页面信息一并传给后端

前端不要直接调用模型厂商 API。

### 2. 后端层

推荐部署方式：

- `Vercel Functions`

原因：

- 对小型 Node API 足够轻
- 环境变量管理简单
- 适合给 GitHub Pages 这样的静态前端提供接口
- 与你现有的 JavaScript 生态更贴近

也可以用 Cloudflare Workers，但如果目标是先尽快上线第一版，Vercel 的心智负担更低一些。

后端建议单独建一个仓库，不要和 Hexo 站点强耦合。博客继续保持静态发布，AI 服务独立部署。

### 3. 检索层

推荐使用“关键词检索 + 向量检索”的混合方案：

- 关键词检索：命中标题、tag、分类、正文关键词
- 向量检索：解决用户换一种说法提问的问题

你的博客内容以技术长文和学习笔记为主，单纯靠站内搜索不够，尤其是当用户问“这个站里有没有讲过类似 XX 的内容”时，语义检索会明显更有效。

### 4. 数据层

在构建阶段扫描：

- [source/_posts](/Users/wangsenjie/Sites/blog/source/_posts)

为每篇文章抽取：

- 标题
- slug
- 永久链接
- 日期
- tag
- category
- 摘要
- 正文纯文本

然后进行：

- 正文切块
- 生成 embedding
- 导出给后端使用的结构化 JSON

## 第一版应该做什么

建议第一版只做下面四件最值钱的事：

- 全站问答：基于现有博客文章回答问题
- 当前文章总结：总结用户正在阅读的这一页
- 相关文章推荐：根据当前主题推荐下一篇
- 学习路径引导：比如“想学推荐算法，先看哪些文章”

第一版不建议做这些：

- 通用 Agent 工具调用
- 访问外部网页
- 多轮复杂规划
- 用户账号体系
- 长期对话记忆

这些复杂度很高，但对你这个博客的核心价值提升有限。先把“站内知识问答”做准，收益最大。

## 典型用户场景

### 1. 问整站内容

用户可能会问：

- “你这个站里写过双塔模型吗？”
- “有没有讲过 Transformer 相关内容？”
- “这个博客里有哪些 Pandas 题解？”

系统行为：

- 在全站文章中召回相关内容块
- 用中文回答
- 返回 2 到 5 条引用来源，附带文章标题和链接

### 2. 问当前文章

用户可能会问：

- “总结一下这篇文章”
- “这一页讲的重点是什么？”
- “这篇文章适合什么基础的人看？”

系统行为：

- 把当前页面的标题、URL、tag、分类、摘要传给后端
- 检索时提高当前文章内容的权重
- 优先根据当前文章回答

### 3. 问下一步该看什么

用户可能会问：

- “我刚看完 SVD，下一篇建议看什么？”
- “如果想补推荐算法，阅读顺序怎么排？”

系统行为：

- 识别主题
- 找出同主题、前置主题、进阶主题文章
- 给出一个短的阅读顺序

## 建议的代码组织

### 在当前 Hexo 仓库里新增

- `docs/ai-agent-implementation.zh-CN.md`
- `scripts/build-ai-corpus.js`
- `scripts/export-ai-documents.js`
- `source/_data/ai-agent.swig`
- `source/_data/ai-agent.js`
- `source/_data/ai-agent.styl`

职责建议：

- `build-ai-corpus.js`：读取文章并整理为统一结构
- `export-ai-documents.js`：导出给后端使用的 JSON 数据
- `ai-agent.swig`：注入聊天组件挂载点
- `ai-agent.js`：前端交互逻辑和 API 请求
- `ai-agent.styl`：组件样式

### 在独立 API 仓库里建议这样组织

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

## API 设计建议

### `POST /api/ask`

请求体示例：

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

返回体示例：

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

请求体示例：

```json
{
  "page": {
    "title": "Transformer架构",
    "url": "https://wangsenjie.github.io/...",
    "content": "..."
  }
}
```

返回体示例：

```json
{
  "summary": "这篇文章主要讲了..."
}
```

如果你想先把接口数压到最少，第一版也可以只保留 `/api/ask`，通过 `mode: "page_summary"` 来区分“总结当前页”和“普通问答”。

## 构建期数据流程

### 第一步：解析文章

读取目录：

- [source/_posts](/Users/wangsenjie/Sites/blog/source/_posts)

对每篇文章做这些事情：

- 解析 front matter
- 将 markdown 转成纯文本
- 必要时去掉代码块，避免噪声过大
- 保留标题结构，便于后续按章节切分
- 生成最终线上 URL

### 第二步：切分文章

建议切分规则：

- 每个 chunk 约 500 到 900 个中文字符
- chunk 之间保留 100 到 150 个字符重叠
- 优先按标题层级切，再按长度切

每个 chunk 保存这些元信息：

- `postTitle`
- `postUrl`
- `tags`
- `categories`
- `sectionTitle`
- `content`

### 第三步：生成向量

为这些内容生成 embedding：

- chunk 正文
- 可选地为标题加摘要也生成一份向量

存储内容至少包括：

- 向量值
- chunk 元信息
- 检索用的轻量关键词字段

### 第四步：将数据提供给 API

对于你当前这个站点规模，前期有两种合适方案：

- 方案 A：生成好的 JSON 直接提交到 API 仓库
- 方案 B：上传到对象存储，再由 API 读取

建议先用方案 A。简单、稳定、够用。

## 检索策略

建议使用三段式流程：

1. 关键词粗召回
2. 向量相似度召回
3. 轻量重排后再交给模型生成答案

排序信号建议包括：

- 语义相似度
- 标题命中
- 分类命中
- tag 命中
- 当前页面加权

如果用户明显是在问当前文章，那么最终上下文里至少强制保留一段当前文章内容，避免答偏。

## Prompt 约束

这个助手必须遵守这些规则：

- 主要依据召回到的博客内容作答
- 如果站内证据不足，就明确说“站内内容没有清楚覆盖这个问题”
- 不要编造文章标题或链接
- 优先用简洁中文回答
- 只要回答了事实性内容，就附上来源链接

这一步很关键。否则很容易出现“回答看起来像对的，但其实不是来自你博客”的问题。

## 前端接入建议

### 接入点

建议使用：

- [source/_data/body-end.swig](/Users/wangsenjie/Sites/blog/source/_data/body-end.swig)

接入方式：

- 保留你当前已有的分享脚本
- 在页面底部追加一个 AI 助手挂载节点
- 再加载一段小型前端脚本

例如：

```html
<div id="blog-ai-agent"></div>
```

### 当前页面上下文

可以在模板里注入一个全局对象，供前端脚本读取：

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

前端请求 API 时，只要当前页有这个对象，就把它一起带上。

## 安全要求

不要做这些事：

- 不要把模型 API Key 放进这个 Hexo 仓库
- 不要让浏览器直接请求模型供应商接口
- 不要直接信任模型返回的 HTML

应该做这些事：

- API Key 只放在后端部署平台的环境变量里
- 返回给前端的 snippet 做基本清洗
- 后端按 IP 做简单限流
- 只允许你的博客域名跨域访问

## 推荐的分阶段路线

### 第一阶段

- 加前端聊天框外壳
- 建一个 `/api/ask`
- 先只用文章元数据和关键词检索

目标：

- 快速验证交互闭环和引用格式

### 第二阶段

- 增加 chunk 切分和 embedding 检索
- 提高同义提问、泛化提问下的命中率

目标：

- 让助手真正可用

### 第三阶段

- 增加当前页总结
- 增加相关文章推荐
- 增加学习路径建议

目标：

- 提高站内停留时间和内容消费深度

## 验收标准

如果第一版满足下面几点，就算上线可用：

- 能正确回答博客里确实写过的问题
- 能返回正确的文章链接
- 对博客里没写过的问题会明确拒答或保守回答
- 能总结当前页面内容
- 接口响应时间可接受

建议延迟目标：

- 2 到 4 秒内开始返回
- 普通问题 8 秒内完整回答

## 实施顺序

建议按这个顺序做：

1. 在当前 Hexo 仓库里加文章导出脚本
2. 单独搭一个 API 仓库并实现 `/api/ask`
3. 在 NexT 自定义注入点挂上前端聊天框
4. 拿你现有博客内容做 20 到 30 个真实问题测试
5. 等全链路通了，再加 embedding

## 最后的建议

如果你的目标是尽快上线，不要一开始就追求“AI Agent”这个词本身，而是先做一个“基于博客内容的检索型助手”。

对你这种技术内容型博客来说，最有价值的不是让它像 ChatGPT 一样什么都聊，而是：

- 知道你站里写过什么
- 能准确把内容找出来
- 能引用正确文章
- 能把读者继续引到下一篇

这才是第一版最应该做对的事情。

## 下一步

这份文档之后，最实际的下一步有三个：

- 在这个仓库里创建 `scripts/export-ai-documents.js`
- 增加前端聊天框注入文件
- 搭一个最小可跑的 `blog-ai-api` 项目骨架
