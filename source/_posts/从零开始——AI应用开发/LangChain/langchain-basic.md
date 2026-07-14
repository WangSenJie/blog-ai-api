---
title: LangChain 基础
date: 2026-07-03
description: LangChain 基础：聊天模型、消息与搜索工具
categories:
  - 从零开始——AI应用开发
  - LangChain
tags:
comments: True
mathjax: false
---

# LangChain Basic

目标: 认识 `模型 (Model)、消息 (Message)、工具 (Tool)` 三个组件

## 1. 设置 API Key

采用 `DeepSeek` 模型, `OpenAI` 兼容接口

```python
import os, getpass

def _set_env(var: str):
    if not os.environ.get(var):
        os.environ[var] = getpass.getpass(f"{var}: ")

_set_env("DEEPSEEK_API_KEY")
```

## 2. 创建聊天模型

```python
from langchain_openai import ChatOpenAI
import os

deepseek_chat = ChatOpenAI(
    model="deepseek-v4-flash",
    temperature=0,
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url="https://api.deepseek.com",
)
```

这里:

- `model` 为服务端模型名称
- `temperature` 的参数值越小, 模型就会返回越确定的一个结果. 如果调高该参数值, 大语言模型可能会返回更随机的结果, 也就是说这可能会带来更多样化或更具创造性的产出

## 3. 消息对象

```python
from langchain_core.messages import HumanMessage

# Create a message
msg = HumanMessage(content="Hello world", name="Lance")

# Message list
messages = [msg]

# 调用模型
deepseek_chat.invoke(messages)
```

`LangChain` 采用结构化消息:

- `HumanMessage` 为用户消息, 其中 `content` 为消息正文, `name` 为可选的发送者标识
- `AIMessage` 为模型回复
- `SystemMessage` 为系统指令
- `ToolMessage` 为工具执行结果

`invoke()` 为同步调用接口, 返回的 `AIMessage` 除了文本, 还包含 `token` 用量、模型名称、结束原因等元数据

`deepseek_chat.invoke([HumanMessage(content="hello world")])` 等价于
`deepseek_chat.invoke("hello world")`

## 4. Tavily 搜索工具

```python
_set_env("TAVILY_API_KEY")

from langchain_tavily import TavilySearch

tavily_search = TavilySearch(max_results=3) # 最多返回 3 条搜索结果

data = tavily_search.invoke({
    "query": "What is LangGraph?"
})
```

每条搜索结果通常包含:
```python
{
    "title": "...",
    "url": "...",
    "content": "...",
    "score": 0.95
}
```

`Tavily` 主要作用是 让模型获取互联网上的最新信息