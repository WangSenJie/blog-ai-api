---
title: 状态与短期记忆
date: 2026-07-14
description: 状态与短期记忆 —— Reducer、消息管理与持久化
categories:
  - 从零开始——AI应用开发
  - LangChain
tags:
comments: True
mathjax: false
---

# State与短期记忆

再上一章, 我们已经构造了一个简单的 Agent, 实现了 `act` `observe` `reason` `memory`

> [LangGraph Foundations](langgraph-foundations.md)

在这一章, 我们将进一步去理解 `State` 和 `Memory`.

## 1. State Schema

> **Q: 为什么需要 State Schema ?**
>
> - 在 LangGraph 中, 节点不是靠普通函数参数一个个传递数据, 而是共享一个 `state`, 我们需要事先定义这个 `State` 长什么样, 即
>   - Graph 运行过程中, 会保存哪些字段 ?
>   - 每个字段是什么类型 ?
>   - 每个节点可以读写哪些字段 ?

State 的定义方式有:

- `TypedDict`
- `dataclass`
- `Pydantic`

### 1.1 用 `TypedDict` 定义 State

例:

```python
from typing_extensions import TypedDict

class TypedDictState(TypedDict):
  	name: str
    mood: str
```

如果你想要 `mood` 字段的取值只能是 `happy` 或者 `sad`, 那可以使用 `Literal` 方法:
```python
from typing_extensions import TypedDict
from typing import Literal

class TypedDictState(TypedDict):
  	name: str
    mood: Literal["happy", "sad"]
```

> 注: `TypedDict` 主要是类型提示, 不是运行时校验, 即用了错误的数据不会报错, 例:
> ```python
> {"name": 123, "mood": "angry"}
> ```

#### 构建 Graph

```python
import random
from IPython.display import Image, display
from langgraph.graph import StateGraph, START, END

def node_1(state):
    print("---Node 1---")
    return {"name": state['name'] + " is ... "}

def node_2(state):
    print("---Node 2---")
    return {"mood": "happy"}

def node_3(state):
    print("---Node 3---")
    return {"mood": "sad"}

def decide_mood(state) -> Literal["node_2", "node_3"]:
        
    # Here, let's just do a 50 / 50 split between nodes 2, 3
    if random.random() < 0.5:

        # 50% of the time, we return Node 2
        return "node_2"
    
    # 50% of the time, we return Node 3
    return "node_3"

# Build graph
builder = StateGraph(TypedDictState)
builder.add_node("node_1", node_1)
builder.add_node("node_2", node_2)
builder.add_node("node_3", node_3)

# Logic
builder.add_edge(START, "node_1")
builder.add_conditional_edges("node_1", decide_mood)
builder.add_edge("node_2", END)
builder.add_edge("node_3", END)

# Add
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

```text
START
  ↓
node_1
  ↓
根据 decide_mood 随机分支
  ↓              ↓
node_2          node_3
  ↓              ↓
END            END
```

调用:
```python
graph.invoke({"name":"Lance"})
```

```text
---Node 1---
---Node 2---
{'name': 'Lance is ... ', 'mood': 'happy'}
```

> 注: 因为 `TypedDict` 本质上是 `dict` 风格的 State, 所以这里直接使用 `dict` 也是一样的.

### 1.2 用 `dataclass` 定义 State

```python
from dataclasses import dataclass

@dataclass
class DataclassState:
    name: str
    mood: Literal["happy","sad"]
```

- 这里 `dataclass` 是一个装饰器函数.

-  `@dataclass` 为类装饰器, 可以为 `DataclassState` 自动生成 `__init__` `__repr__` `__eq__` 方法, 从而简化数据类的定义.

- 他不是字典, 而是对象, 因此读取字段时, 不是 `state["name"]`, 而是 `state.name`. 因此之前的 `node_1` 要改成:
  ```python
  def node_1(state):
      print("---Node 1---")
      return {"name": state.name + " is ... "}
  ```

 调用:

```python
graph.invoke(DataclassState(name="Lance",mood="sad"))
```

```text
---Node 1---
---Node 3---
{'name': 'Lance is ... ', 'mood': 'sad'}
```

### 1.3 用 `Pydantic` 定义 State

> **`TypedDict` 和 `dataclass` 的共同问题:**
>
> - 虽然它们都提供了类型提示, 但不严格做运行时校验. 例如 `DataclassState(name="lance", mood="mad")` 也不会触发报错
> - 基于此, 如果希望错误数据触发报错, 就要引入 `Pydantic`

```python
from pydantic import BaseModel, field_validator, ValidationError

class PydanticState(BaseModel):
    name: str
    mood: str

    @field_validator('mood')
    @classmethod
    def validate_mood(cls, value):
        if value not in ["happy", "sad"]:
            raise ValueError("Each mood must be either 'happy' or 'sad'")
        return value
```

- `@field_validator('mood')` 是一个装饰器, 意思是: 下面这个方法专门负责校验 `mood` 字段.

- `@classmethod` 是类方法

  ```python
  @classmethod
      def validate_mood(cls, value):
  ```

  - 这里 `cls` 就是当前类, 即 `PydanticState`
  - `value` 表示正在校验的 `mood` 值

此时运行:
```python
try:
    state = PydanticState(name="John Doe", mood="mad")
except ValidationError as e:
    print("Validation Error:", e)
```

将触发 `Validation Error`.

## 2. State Reducers

在 [LangGraph Foundations](langgraph-foundations.md) 中我们以及知道: 对于一个没有 `Reducer` 的 LanGraph, 默认新的 State 会覆盖旧的 State. 

事实上还有另一个问题: 多分支同时更新同一字段. 先构建一个分支图:

```python
class State(TypedDict):
    foo: int

def node_1(state):
    print("---Node 1---")
    return {"foo": state['foo'] + 1}

def node_2(state):
    print("---Node 2---")
    return {"foo": state['foo'] + 1}

def node_3(state):
    print("---Node 3---")
    return {"foo": state['foo'] + 1}

# Build graph
builder = StateGraph(State)
builder.add_node("node_1", node_1)
builder.add_node("node_2", node_2)
builder.add_node("node_3", node_3)

# Logic
builder.add_edge(START, "node_1")
builder.add_edge("node_1", "node_2")
builder.add_edge("node_1", "node_3")
builder.add_edge("node_2", END)
builder.add_edge("node_3", END)

# Add
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

```text
START
  ↓
node_1
  ↓
 ┌─────────┐
 ↓         ↓
node_2    node_3
 ↓         ↓
END       END
```

注意到 `node_2` 和 `node_3` 都会返回 `return {"foo": state['foo'] + 1}`, 它们在同一步并行发生, 此时 LangGraph 不知道应该保留谁, 就会触发 `InvalidUpdateError` 报错.

### 2.1 Reducer

Reducer 是一条 "合并规则", 面对多个节点更新同一个 state 字段, 不直接覆盖, 而是按照某种规则合并.

#### 用 Annotated 给字段指定 reducer

```python
from operator import add
from typing import Annotated

class State(TypedDict):
    foo: Annotated[list[int], add]
```

这里 `foo: Annotated[list[int], add]` 的意思是 `foo` 是 `list[int]` 类型的, 且有新值写入 `foo` 时, 用 `add` 函数合并. `operator.add` 对 `list` 的效果是列表拼接.

#### reducer 解决并行分支冲突

仍然考虑之前的并行分支的例子, 先修改 `node_1, node_2, node_3` 的定义:

```python
def node_1(state):
    print("---Node 1---")
    return {"foo": [state['foo'][-1] + 1]}

def node_2(state):
    print("---Node 2---")
    return {"foo": [state['foo'][-1] + 1]}

def node_3(state):
    print("---Node 3---")
    return {"foo": [state['foo'][-1] + 1]}
```

- 假设输入 `{"foo": [1]}`
- `node_1` 先执行, `1+1=2`, 此时按 `add` 规则追加: `[1] -> [1, 2]`
- 然后 `node_2` 和 `node_3` 并行执行, 它们都基于最后一个值 `2` 生成
  - `node_2` 返回 `{"foo": [3]}`
  - `node_3` 返回 `{"foo": [3]}`
  - 因为 `foo` 有 reducer, 所以会执行 `add` 合并, 得到 `{"foo": [1, 2, 3, 3]}` 而不会产生冲突报错.

### 2.2 Reducer 的问题与解决方式

```python
try:
    graph.invoke({"foo" : None})
except TypeError as e:
    print(f"TypeError occurred: {e}")
```

由于 reducer 是 `operator.add`, 它会尝试 `None + 2` (`node_1` 之后), 这是不合法的, 所以会产生 `TypeError` 报错.

为了解决以上问题, 可以写一个自定义 reducer:
```python
def reduce_list(left: list | None, right: list | None) -> list:
    """Safely combine two lists, handling cases where either or both inputs might be None.

    Args:
        left (list | None): The first list to combine, or None.
        right (list | None): The second list to combine, or None.

    Returns:
        list: A new list containing all elements from both input lists.
               If an input is None, it's treated as an empty list.
    """
    if not left:
        left = []
    if not right:
        right = []
    return left + right

class DefaultState(TypedDict):
    foo: Annotated[list[int], add]

class CustomReducerState(TypedDict):
    foo: Annotated[list[int], reduce_list]
```

可以发现在输入 `None` 这个例子下: 采用 `DefaultState` 会出现 `TypeError` 报错, 而采用 `CustomReducerState` 就能解决这个问题.

### 2.3 MessageState

有两种方式定义 Message Reducer

- 手动定义:
  ```python
  from typing import Annotated
  from langchain_core.messages import AnyMessage
  
  class CustomMessagesState(TypedDict):
      messages: Annotated[list[AnyMessage], add_messages]
      added_key_1: str
      added_key_2: str
  ```

- LangGraph 内置:
  ```python
  from langgraph.graph import MessagesState
  
  class ExtendedMessagesState(MessagesState):
      added_key_1: str
      added_key_2: str
  ```

- 这两种方法类似

#### `add_messages` 的作用

与普通的列表拼接不同, `add_messages` 更适合聊天消息, 支持:

- 追加新消息
  ```python
  initial_messages = [
      AIMessage(content="Hello!", id="1"),
      HumanMessage(content="I'm looking for information.", id="2")
  ]
  
  new_message = AIMessage(content="Sure, I can help.", id="3")
  ```

  执行
  ```python
  add_messages(initial_messages, new_message)
  ```

  就是追加新消息

- 根据消息 ID 覆盖旧消息
  ```python
  initial_messages = [
      AIMessage(content="Hello!", id="1"),
      HumanMessage(content="I'm looking for information on marine biology.", id="2")
  ]
  
  new_message = HumanMessage(
      content="I'm looking for information on whales, specifically",
      id="2"
  )
  ```

  执行：

  ```
  add_messages(initial_messages, new_message)
  ```

  结果不是追加，而是替换 `id="2"` 的旧消息。

- 删除指定消息
  ```python
  from langchain_core.messages import RemoveMessage
  ```

  假设原来有消息:
  ```python
  messages = [
      AIMessage("Hi.", id="1"),
      HumanMessage("Hi.", id="2"),
      AIMessage("So you said...", id="3"),
      HumanMessage("Yes...", id="4")
  ]
  ```

  删除前两条:
  ```python
  delete_messages = [RemoveMessage(id=m.id) for m in messages[:-2]]
  ```

  然后执行

  ```python
  add_messages(messages, delete_messages)
  ```

  结果就是删除 `id="1"` 和 `id="2"` 的消息.

## 3 Multiple Schemas

在 **State Schema** 这一节中, 我们整个 graph 只定义了一个 `State`, 输入、节点之间传递和最终输出都用这个 `State`.

但真实项目里经常不够用, 因为有些字段只用于中间计算, 不希望用户输入, 也不希望最终返回.

### 3.1 Private State

先定义 `OverallState` 和 `PrivateState`:

```python
class OverallState(TypedDict):
    foo: int

class PrivateState(TypedDict):
    baz: int
```

- `OverallState` 为整个 graph 的正式状态
- `PrivateState` 为节点之间临时传递的状态

```python
def node_1(state: OverallState) -> PrivateState:
    print("---Node 1---")
    return {"baz": state['foo'] + 1}

def node_2(state: PrivateState) -> OverallState:
    print("---Node 2---")
    return {"foo": state['baz'] + 1}
```

- `node_1` 读取正式状态里的 `foo`, 但返回的是临时状态 `baz`;
- `node_2` 读取临时状态 `baz`, 然后写回正式状态 `foo`.

```text
输入 {"foo": 1}
   ↓
node_1 读取 foo，生成 baz = 2
   ↓
node_2 读取 baz，生成 foo = 3
   ↓
输出 {"foo": 3}
```

最终输出里没有 `baz`, 因为 `baz` 只在 `PrivateState` 里, 不在 `OverallState` 里.

### 3.2 InputState 和 OutputState

先定义三个 `schema`:

```python
class InputState(TypedDict):
    question: str

class OutputState(TypedDict):
    answer: str

class OverallState(TypedDict):
    question: str
    answer: str
    notes: str
```

- `InputState` 限制用户输入什么
- `OverallState` 为 graph 内部完整状态
- `OutputState` 限制最终输出什么

构建图:
```python
def thinking_node(state: InputState):
    return {"answer": "bye", "notes": "... his is name is Lance"}

def answer_node(state: OverallState) -> OutputState:
    return {"answer": "bye Lance"}

graph = StateGraph(
  OverallState, 
  input_schema=InputState, 
  output_schema=OutputState
)

graph.add_node("answer_node", answer_node)
graph.add_node("thinking_node", thinking_node)
graph.add_edge(START, "thinking_node")
graph.add_edge("thinking_node", "answer_node")
graph.add_edge("answer_node", END)

graph = graph.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))

graph.invoke({"question":"hi"})
```

```text
{'answer': 'bye Lance'}
```

## 4 Filtering and trimming messages

在实际使用过程中, `messages` 会随着聊天轮数不断增长, 如果每次都把完整历史传给模型, 成本、延迟和上下文长度都会出现问题.

本节给出下面三种处理方式:

- 用 `RemoveMessage` 真正删除 `state` 里的旧消息
- 调用模型时只过滤一部分消息, 但不改 state
- 按 token 数量裁剪 messages

### 4.1 用 `RemoveMessage` 删除旧消息

```python
from langchain_core.messages import RemoveMessage

# Nodes
def filter_messages(state: MessagesState):
    # Delete all but the 2 most recent messages
    delete_messages = [RemoveMessage(id=m.id) for m in state["messages"][:-2]]
    return {"messages": delete_messages}
  
def chat_model_node(state: MessagesState):    
    return {"messages": [llm.invoke(state["messages"])]}

# Build graph
builder = StateGraph(MessagesState)
builder.add_node("filter", filter_messages)
builder.add_node("chat_model", chat_model_node)
builder.add_edge(START, "filter")
builder.add_edge("filter", "chat_model")
builder.add_edge("chat_model", END)
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

```text
START
  ↓
filter：删除旧消息，只保留最近 2 条
  ↓
chat_model：把剩下的消息传给模型
  ↓
END
```

此方法会真正修改 graph state.

### 4.2 过滤

```python
# Node
def chat_model_node(state: MessagesState):
    return {"messages": [llm.invoke(state["messages"][-1:])]}

# Build graph
builder = StateGraph(MessagesState)
builder.add_node("chat_model", chat_model_node)
builder.add_edge(START, "chat_model")
builder.add_edge("chat_model", END)
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

`llm.invoke(state["messages"][-1:]` 表示只取最后一条消息传给模型, 与 `RemoveMessage` 不同, 它不会修改 graph state.

但是, 只传最后一句消息是有风险的, 比如用户问 `它生活在哪?`, 此时模型只看到这一句从而不知道 `它` 指的是什么. 实际项目里通常不会只保留最后一条, 而是保留最近几轮消息.

### 4.3 Trim Messages

```python
from langchain_core.messages import trim_messages

# Node
def chat_model_node(state: MessagesState):
    messages = trim_messages(
            state["messages"],
            max_tokens=100,
            strategy="last",
            token_counter=len,
            allow_partial=False,
        )
    return {"messages": [llm.invoke(messages)]}

# Build graph
builder = StateGraph(MessagesState)
builder.add_node("chat_model", chat_model_node)
builder.add_edge(START, "chat_model")
builder.add_edge("chat_model", END)
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

其中

```python
 messages = trim_messages(
            state["messages"],
            max_tokens=100,
            strategy="last",
            token_counter=len,
            allow_partial=False,
        )
```

表示从 `messages` 里裁剪出一部分, 最多不超过 100 tokens, 优先保留最后的消息, 不允许保留半条消息.

> 注: 这里做了简化, 直接使用 `len` 来计算 `token` 数量, 实际上是不对的, `token` 有专门的计算方法.

### 4.4 三种方法比较

| 方式                     | 是否修改 state | 控制方式                | 适合场景        |
| ------------------------ | -------------- | ----------------------- | --------------- |
| `RemoveMessage`          | 是             | 删除指定消息            | 真正清理历史    |
| `state["messages"][-N:]` | 否             | 保留最近 N 条           | 简单过滤        |
| `trim_messages`          | 否             | 保留指定 token 内的消息 | 控制 token 成本 |

## 5 Chatbot with message summarization

再上一节, 我们学习了利用三种方法来处理上下文过长带来的问题. 但是这些方法的问题是: 旧信息可能会直接丢失. 在这一节我们将学习一种新的思路 — 压缩. 具体来讲:

- 不直接丢掉旧消息
- 先把旧消息总结成 summary
- 然后删除旧消息, 只保留 summary + 最近的消息

这样既减少了 token, 又能保留关键信息.

### 5.1 实现

**先定义 State 结构**

```python
from langgraph.graph import MessagesState

class State(MessagesState):
  	summary: str
```

`MessagesState` 默认有 `messages` 字段, 现在额外增加了 `summary` 字段.

**再定义调用聊天模型的节点 `call_model`**

```python
from langchain_core.messages import SystemMessage, HumanMessage, RemoveMessage

# Define the logic to call the model
def call_model(state: State):
    
    # Get summary if it exists
    summary = state.get("summary", "")

    # If there is summary, then we add it
    if summary:
        
        # Add summary to system message
        system_message = f"Summary of conversation earlier: {summary}"

        # Append summary to any newer messages
        messages = [SystemMessage(content=system_message)] + state["messages"]
    
    else:
        messages = state["messages"]
    
    response = model.invoke(messages)
    return {"messages": response}
```

它的逻辑是:

- 如果没有 `summary`
  - 直接把 `messages` 给模型
- 如果有 `summary`
  - 先构造一条 `SystemMessage`, 把 `summary` 放进去
  - 再拼接最近的 `messages`
  - 一起传给模型

**接着构造摘要生成节点 `summarize_conversation`**

```python
def summarize_conversation(state: State):
    
    # First, we get any existing summary
    summary = state.get("summary", "")

    # Create our summarization prompt 
    if summary:
        
        # A summary already exists
        summary_message = (
            f"This is summary of the conversation to date: {summary}\n\n"
            "Extend the summary by taking into account the new messages above:"
        )
        
    else:
        summary_message = "Create a summary of the conversation above:"

    # Add prompt to our history
    messages = state["messages"] + [HumanMessage(content=summary_message)]
    response = model.invoke(messages)
    
    # Delete all but the 2 most recent messages
    delete_messages = [RemoveMessage(id=m.id) for m in state["messages"][:-2]]
    return {"summary": response.content, "messages": delete_messages}
```

它主要完成以下步骤:

- 生成或更新 `summary`

  - 如果没有旧 `summary`, 即当前 `summary` 为空
    - 则让模型总结当前对话
  - 如果已经有 `summary`
    - 则让模型基于旧 `summary` 和新消息, 扩展 `summary`

- 删除旧消息
  ```python
  delete_messages = [RemoveMessage(id=m.id) for m in state["messages"][:-2]]
  ```

  即删除除了最近 2 条之外的所有消息

**接下来定义一个条件分支 `should_continue` 来判断什么时候总结**

```python
from langgraph.graph import END
from typing_extensions import Literal
# Determine whether to end or summarize the conversation
def should_continue(state: State) -> Literal ["summarize_conversation",END]:
    
    """Return the next node to execute."""
    
    messages = state["messages"]
    
    # If there are more than six messages, then we summarize the conversation
    if len(messages) > 6:
        return "summarize_conversation"
    
    # Otherwise we can just end
    return END
```

其逻辑为

- 如果 `messages` 超过 6 条
  - 则去 `summarize_conversation` 节点做摘要
- 反之, 直接结束

综上, 实现流程为:
```text
用户输入
  ↓
conversation 调用模型回答
  ↓
检查 messages 数量
  ↓
如果 <= 6：结束
如果 > 6：总结对话，然后结束
```

图结构可以理解为

```text
START
  ↓
conversation
  ↓
should_continue
  ├── END
  └── summarize_conversation
          ↓
         END
```

### 5.2 增加 `Memory`

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()
graph = workflow.compile(checkpointer=memory)
```

`MemorySaver` 是一个内存里的 checkpointer

作用是：

- 每次 graph 执行后, 把 state 保存下来
- 下一次同一个 thread_id 调用时, 可以接着上一次 state 继续

否则每次:

```
graph.invoke(...)
```

都是独立执行, 模型不会记得前一次对话.

`thread_id` 用来区分不同对话.

## 6  Chatbot with message summarization & external DB memory

根据上一节内容, 我们已经通过 `MemorySaver` 实现了简单的内存, 但是 `MemorySaver` 只能保存在当前的 `Python` 进程中. 一旦 `Python` 进程重启, 记忆就没了. 如果想让记忆长期保存, 就要用外部数据库 `checkpointer`, 例如 `SQLite`、`Postgres`.

### 6.1 SQLite

`SQLite` 是一个轻量级的关系型数据库, 它不需要像 `MySQL` 一样要开 `server`, 它通常只是一个本地文件 `state_db/example.db`.

### 创建 `SQLite` 连接

先利用 `":memory:"` 创建一个内存 `SQLite` 数据库
```python
import sqlite3
# In memory
conn = sqlite3.connect(":memory:", check_same_thread = False)
```
`check_same_thread = False` 是为了允许多线程访问同一个连接, 否则默认只允许同一个线程访问. 但这种方式和 `MemorySaver` 类似, 进程结束后数据也没了.

想要实现持久化, 可以指定一个文件路径, 例如 `state_db/example.db`:
```python
db_path = "state_db/example.db"
conn = sqlite3.connect(db_path, check_same_thread=False)
```
只要文件 `state_db/example.db` 还在, `checkpoint` 就能保留.

### 创建 `SqliteSaver`

```python
# Here is our checkpointer 
from langgraph.checkpoint.sqlite import SqliteSaver
memory = SqliteSaver(conn)
```
这里把 `SQLite` 连接包装成 LangGraph 的 `checkpointer`.

## 6.2 创建 Chatbot

同上一节的内容, 定义我们的 chatbot:

```python
from typing_extensions import Literal
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, RemoveMessage

from langgraph.graph import END
from langgraph.graph import MessagesState


# model = ChatOpenAI(model="gpt-4o",temperature=0)
model = ChatOpenAI(
  model="deepseek-v4-flash", 
  temperature=0, 
  api_key=os.environ["DEEPSEEK_API_KEY"], 
  base_url="https://api.deepseek.com"
)

class State(MessagesState):
    summary: str

# Define the logic to call the model
def call_model(state: State):
    
    # Get summary if it exists
    summary = state.get("summary", "")

    # If there is summary, then we add it
    if summary:
        
        # Add summary to system message
        system_message = f"Summary of conversation earlier: {summary}"

        # Append summary to any newer messages
        messages = [SystemMessage(content=system_message)] + state["messages"]
    
    else:
        messages = state["messages"]
    
    response = model.invoke(messages)
    return {"messages": response}

def summarize_conversation(state: State):
    
    # First, we get any existing summary
    summary = state.get("summary", "")

    # Create our summarization prompt 
    if summary:
        
        # A summary already exists
        summary_message = (
            f"This is summary of the conversation to date: {summary}\n\n"
            "Extend the summary by taking into account the new messages above:"
        )
        
    else:
        summary_message = "Create a summary of the conversation above:"

    # Add prompt to our history
    messages = state["messages"] + [HumanMessage(content=summary_message)]
    response = model.invoke(messages)
    
    # Delete all but the 2 most recent messages
    delete_messages = [RemoveMessage(id=m.id) for m in state["messages"][:-2]]
    return {"summary": response.content, "messages": delete_messages}

# Determine whether to end or summarize the conversation
def should_continue(state: State)-> Literal ["summarize_conversation",END]:
    
    """Return the next node to execute."""
    
    messages = state["messages"]
    
    # If there are more than six messages, then we summarize the conversation
    if len(messages) > 6:
        return "summarize_conversation"
    
    # Otherwise we can just end
    return END
```
编译:
```python
from IPython.display import Image, display
from langgraph.graph import StateGraph, START

# Define a new graph
workflow = StateGraph(State)
workflow.add_node("conversation", call_model)
workflow.add_node(summarize_conversation)

# Set the entrypoint as conversation
workflow.add_edge(START, "conversation")
workflow.add_conditional_edges("conversation", should_continue)
workflow.add_edge("summarize_conversation", END)

# Compile
graph = workflow.compile(checkpointer=memory)
display(Image(graph.get_graph().draw_mermaid_png()))
```
注: 这里的 `graph = workflow.compile(checkpointer=memory)` 中的 `memory` 已经跟上一节不一样了.