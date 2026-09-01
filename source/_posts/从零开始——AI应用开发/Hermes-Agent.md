---
title: Harmes-Agent
date: 2026-07-30
description: Harmes Agent 工作流
categories:
  - 从零开始——AI应用开发
  - Harmes
tags:
comments: True
mathjax: false
---

## Agent Loop

- Turn: 从一次用户输入到一次最终回答
- Iteration: Agent loop 的逻辑循环
- CLI: 普通命令行界面，Python直接调用 Agent
- TUI: 终端的图形化应用，通过 JSON-RPC 调用 Python
- Desktop: 桌面图形应用

### 初始化 Agent

> Agent 由哪些组建组装而成？

```text
Provider + Model
Transport
Tools / Toolsets
ContextEngine
MemoryManager
SessionDB（可选注入）
Callbacks
IterationBudget
```

- Transport：模型 API 协议适配层，负责把 Hermes 内部统一格式的数据，转换成不同模型服务商能够理解的请求；再把服务商返回的数据转换回 Hermes 的统一格式。
- ContextEngine：负责决定哪些历史消息、工具结果和记忆，要在下一次请求时发送给大模型。
- MemoryManager：记忆系统的总调度器
- SessionDB：完整会话的持久化数据库访问层
- Callbacks：传给 `AIAgent` 的回调函数集合。Agent 执行到某个事件时，会调用对应函数，把状态通知给 CLI、TUI、Gateway、ACP 或其他上层程序。
- IterationBudge：Agent 的迭代次数计数器和上限控制器。

### 构造 TurnContext

> 收到一条用户消息后，要先准备什么？

```
恢复会话
  → 清理用户输入
  → 恢复或构造 system prompt
  → 检查是否需要提前压缩
  → 执行 pre_llm_call 插件
  → 预取长期记忆
  → 有 SessionDB 时保存用户消息
```

- `build_turn_context`：每个用户 Turn 执行一次
- `conversation_loop`：同一个 Turn 内可以循环很多次

### 组装 system prompt

```text
用户发送消息
    ↓
build_turn_context()
    ↓
_cached_system_prompt 是否存在？
    ├─ 存在：直接复用
    └─ 不存在：
         ↓
       SessionDB 中是否保存过？
         ├─ 有：原样恢复
         └─ 无：build_system_prompt()
                  ↓
             build_system_prompt_parts()
                  ↓
       stable + context + volatile
                  ↓
             缓存并写入 SessionDB
    ↓
每次调用模型时：
system prompt + 对话历史 + 当前用户消息
```

> Hermes 在第一次 Turn 开始前，根据 Agent 的身份、工具、工作区、记忆和运行环境，生成一份“本会话的操作说明书”，缓存下来；后面的每次模型调用都复用它。

Hermes 将 system prompt 分成三层

- `stable`

  - 身份/SOUL、行为规范、工具指导、Skills 索引、平台通用提示

  - 身份

    - Hermes 优先加载 `SOUL.md`
      - 如果 `SOUL.md` 存在，则使用 `SOUL.md` 的自定义身份
      - 如果 `SOUL.md` 不存在，则使用 `DEFAULT_AGENT_IDENTITY`

  - 工具指导

    - Hermes会查看 `agent.valid_tool_names`，然后决定添加什么提示
      ```text
      加载了 memory
          → 加入 Memory 使用说明
      
      加载了 session_search
          → 加入历史会话搜索说明
      
      加载了 skill_manage
          → 加入 Skill 管理说明
      ```

  - Skills 索引

    - Hermes 会先检查 `["skills_list", "skill_view", "skill_manage"]` 是否可用，其中

      - `skills_lists` 负责查看 skill 名称和简介
      - `skills_view` 负责加载 `SKILL.md` 以及引用文件
      - `skill_manage` 负责创建、修改和删除 skill

      ```text
      valid_tool_names
            │
            ├─ 有没有 skill_view 等工具？
            │      └─ 决定是否显示整个 Skill 索引
            │
            └─ 当前有哪些执行能力？
                   └─ 决定具体显示哪些 Skill
      ```

    - Hermes 采用渐进式加载 skill

      - `System prompt` 先告诉模型有哪些 `Skill`
      - 模型决定需要某个 `skill`
      - `skill_view` 再读取完整 `SKILL.md`

      否则几十个 `Skill` 的完整内容会迅速占满上下文

- `context`

  ```text
  build_system_prompt_parts()
      │
      ├─ 创建 context_parts
      │
      ├─ 加入工作区快照
      │
      ├─ 加入可选 caller system_message
      │
      └─ build_context_files_prompt()
             │
             ├─ 确定 cwd
             ├─ 按优先级查找文件
             ├─ 读取文件
             ├─ 安全扫描
             ├─ 长度截断
             └─ 包装成 "# Project Context"
                      │
                      ↓
            context_parts.append(...)
  ```

  - 工作区说明、调用方 system message、`AGENTS.md` 等项目上下文

    - 工作区快照
      ```text
      当前工作目录
      是否是 Git 仓库
      仓库状态
      项目类型
      工作区相关 Coding 指导
      ```

    - [可选] 调用方传入的 `system_message`

      - 在普通 `CLI/TUI` 中通常是 `system_message = None`

      - 在开发者直接使用 `AIAgent` 接口并主动传入才有，即开发者使用 Hermes 框架开发智能体的时候，可以实现写好这个 `system_message` 规则。例如开发者想基于 Hermes 框架做一个代码审查 Agent，就可以实现定义规则
        ```python
        CODE_REVIEW_RULES = """
        你是一名代码审查 Agent。
        只分析代码，不修改文件。
        重点检查安全性、正确性和性能。
        按严重程度输出问题。
        """
        ```

        然后把用户运行时的输入和预设规则一起给 Hermes：
        ```python
        result = agent.run_conversation(
            user_message=user_input,
            system_message=CODE_REVIEW_RULES,
        )
        ```

    - 项目上下文

      - Hermes 根据当前项目寻找项目规则：
        ```text
        .hermes.md / HERMES.md
        AGENTS.md
        CLAUDE.md
        .cursorrules / .cursor/rules
        ```

        这里是“第一个匹配类型优先”，不是把所有文件无条件叠加。

- `volatile` 
  -  MEMORY、USER、外部记忆块、日期、session/model/provider/platform 信息
  - `volatile` 是 System Prompt 中最可能在不同会话之间变化的尾部快照，并不是每个 Turn 都变化，一个会话 (Session) 里面会有多个 Turn

> Prompt Cache 会从 system prompt 的第一个 Token 开始比较，尽可能找到与之前请求相同的连续内容。前面一旦发生变化，后面的内容即使相同，也可能无法继续复用。因此越稳定的内容应该放在前面。

### 一次完整的 Provider 请求

一次完整的 Provider 请求可以看成

```python
request = {
    "model": "...",
    "messages": [...],
    "tools": [...],
    "max_tokens": 16000,
    "stream": True,
    # reasoning、temperature 等其他参数
}
```

```text
Provider 返回响应
        ↓
统一转换成 assistant_message
        ↓
响应是否 incomplete / length / content_filter？
   ├─ 是 → 继续、重试、恢复或失败
   └─ 否
        ↓
是否有 tool_calls？
   ├─ 有
   │   ├─ 校验工具名和参数
   │   ├─ 执行工具
   │   ├─ 追加 tool result
   │   └─ continue 下一 Iteration
   │
   └─ 没有
       ↓
     content 是否有可见文本？
       ├─ 没有 → 空响应恢复、重试或 fallback
       └─ 有
           ↓
         是否触发继续执行规则？
           ├─ 是 → 添加内部提示，continue
           └─ 否 → 接受为最终答案，break
```

其中，

```text
length
    模型写到一半，输出额度用完
    → 尝试续写

incomplete
    Provider 声明整个响应尚未完成
    → 保留中间状态并继续请求

content_filter
    安全系统不允许继续生成
    → 尝试 fallback，否则明确终止
```

### API Content

> `content` 是干净的用户原文，而 `api_content` 是这一轮真正发送给模型的增强版文本

> sidecar：附在主数据 `contne` 旁边的辅助数据 `api_content`

假设用户输入：`帮我安排一个学习计划`

Hermes 的外部 MemoryProvider 检索到

```text
用户是 Agent 开发新手
用户每天可以学习两小时
```

某个插件又提供：

```
当前课程目标是掌握 Hermes Agent。
```

模型真正需要看到的是：

```
帮我安排一个学习计划

[相关记忆]
用户是 Agent 开发新手。
用户每天可以学习两小时。

[插件上下文]
当前课程目标是掌握 Hermes Agent。
```

但 UI 应该只显示用户真正输入的：

```
帮我安排一个学习计划
```

于是 Hermes需要同时保存两个版本。

#### `content` 和 `api_content`

内部消息大致变成：

```
{
    "role": "user",

    # 用户真正输入的内容
    "content": "帮我安排一个学习计划",

    # 真正发送给模型的增强内容
    "api_content": """
帮我安排一个学习计划

[相关记忆]
用户是 Agent 开发新手。
用户每天可以学习两小时。

[插件上下文]
当前课程目标是掌握 Hermes Agent。
"""
}
```

对应关系：

| 字段          | 用途                         |
| ------------- | ---------------------------- |
| `content`     | UI 展示、聊天记录、会话搜索  |
| `api_content` | 重放当时真正发送给模型的文本 |

`api_content` 是 Hermes内部字段，不是 OpenAI、Anthropic 等 Provider 的标准字段。

#### `api_content` 的内容来源

```text
api_content
=
用户原始 content
+ 外部 MemoryProvider 本轮检索结果
+ pre_llm_call 插件上下文
```

