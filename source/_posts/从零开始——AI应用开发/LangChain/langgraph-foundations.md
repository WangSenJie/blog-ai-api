---
title: LangGraph 基础
date: 2026-07-03
description: LangGraph 入门 —— 状态、路由、Agent 与记忆
categories:
  - 从零开始——AI应用开发
  - LangChain
tags:
comments: True
mathjax: false
---

# LangGraph

## 1. Simple Graph

`LangGraph` 最基础的组成有:

- `State` : 图中传递的数据
- `Node` : 执行工作的 `Python` 函数
- `Edge` : 节点之间的连接
- `Conditional Edge` : 条件分支
- `START / END` : 图的 入口 / 出口
- `compile()` : 编译图
- `invoke()` : 执行图

**示例:** 构造如下流程图

```text
START
  ↓
node_1：追加 " I am"
  ↓
随机条件判断
  ├── node_2：追加 " happy!"
  └── node_3：追加 " sad!"
          ↓
         END
```

这样, 输入 `{"graph_state" : "Hi, this is Lance."}`, 可能会输出  `{"graph_state" : "Hi, this is Lance. I am happy!"}`, 也可能会输出  `{"graph_state" : "Hi, this is Lance. I am sad!"}`

### 1.1 构造图中的共享数据 `State`

```python
from typing_extensions import TypedDict

class State(TypedDict):
    graph_state: str
```

### 1.2 构造 `Node`: 处理数据的步骤

```python
def node_1(state):
    print("---Node 1---")
    return {"graph_state": state['graph_state'] +" I am"}

def node_2(state):
    print("---Node 2---")
    return {"graph_state": state['graph_state'] +" happy!"}

def node_3(state):
    print("---Node 3---")
    return {"graph_state": state['graph_state'] +" sad!"}
```

### 1.3 `Edge`: 规定节点如何连接

普通边表示无条件执行

```python
builder.add_edge(START, "node_1") # START -> node_1
builder.add_edge("node_2", END) # node_2 -> END
```

**条件分支**:

- 先定义一个条件判断函数 `decide_mood()`
  ```python
  import random
  from typing import Literal
  
  def decide_mood(state) -> Literal["node_2", "node_3"]:
      
      # Often, we will use state to decide on the next node to visit
      user_input = state['graph_state'] 
      
      # Here, let's just do a 50 / 50 split between nodes 2, 3
      if random.random() < 0.5:
  
          # 50% of the time, we return Node 2
          return "node_2"
      
      # 50% of the time, we return Node 3
      return "node_3"
  ```

  `Literal["node_2", "node_3"]` 表示函数的输出只能是 `node_2` 或者 `node_3`

- 连接
  ```python
  builder.add_conditional_edges(
      "node_1",
      decide_mood
  )
  ```

### 1.4 构建图

```python
from IPython.display import Image, display
from langgraph.graph import StateGraph, START, END

# Build graph
builder = StateGraph(State)
builder.add_node("node_1", node_1)
builder.add_node("node_2", node_2)
builder.add_node("node_3", node_3)

# Logic
builder.add_edge(START, "node_1")
builder.add_conditional_edges("node_1", decide_mood)
builder.add_edge("node_2", END)
builder.add_edge("node_3", END)

# Add
graph = builder.compile() # 编译生成可执行对象

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

### 1.5 调用图

```python
graph.invoke({
    "graph_state": "Hi, this is Lance."
})
```

执行过程:
```text
初始状态：
"Hi, this is Lance."

经过 node_1：
"Hi, this is Lance. I am"

经过 node_2：
"Hi, this is Lance. I am happy!"

到达 END，返回最终状态
```

## 2. Chain

把聊天模型引入到 `LangGraph`, 重点包括:

- `HumanMessage`, `AIMessage`, `ToolMessage`
- 使用模型处理消息列表
- `bind_tools()` 把 `Python` 函数描述给模型
- 模型生成 `tool_calls`
- 使用 `MessageState` 保存消息
- 使用 `add_message`  reducer 追加消息

**目标:** 构建一条简单的线性图

```text
START → tool_calling_llm → END
```

### 2.1 Messages

```python
from pprint import pprint
from langchain_core.messages import AIMessage, HumanMessage

messages = [AIMessage(content=f"So you said you were researching ocean mammals?", name="Model")]
messages.append(HumanMessage(content=f"Yes, that's right.",name="Lance"))
messages.append(AIMessage(content=f"Great, what would you like to learn about.", name="Model"))
messages.append(HumanMessage(content=f"I want to learn about the best place to see Orcas in the US.", name="Lance"))

for m in messages:
    m.pretty_print()
```

```text
================================== Ai Message ==================================
Name: Model

So you said you were researching ocean mammals?
================================ Human Message =================================
Name: Lance

Yes, that's right.
================================== Ai Message ==================================
Name: Model

Great, what would you like to learn about.
================================ Human Message =================================
Name: Lance

I want to learn about the best place to see Orcas in the US.
```

### 2.2 调用 Chat Models

```python
import os, getpass

def _set_env(var: str):
    if not os.environ.get(var):
        os.environ[var] = getpass.getpass(f"{var}: ")

_set_env("DEEPSEEK_API_KEY")
```

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(
  model="deepseek-v4-flash", 
  temperature=0, 
  api_key=os.environ["DEEPSEEK_API_KEY"], 
  base_url="https://api.deepseek.com"
)
result = llm.invoke(messages)
type(result)
```

`type(result)` 的返回为 `langchain_core.messages.ai.AIMessage`

- `result.content` 为 AI 模型返回的正文内容
- `result.content` 为模型元数据, 包含 模型名称、token数量、结束原因、服务商信息

### 2.3 定义工具并绑定

这里定义一个简单的示例工具 — 乘法函数

```python
def multiply(a: int, b: int) -> int:
    """Multiply a and b.

    Args:
        a: first int
        b: second int
    """
    return a * b

llm_with_tools = llm.bind_tools([multiply]) # 给模型绑定工具
```

调用:

```python
tool_call = llm_with_tools.invoke([
    HumanMessage(
        content="What is 2 multiplied by 3?"
    )
])
```

其中得到的 `tool_call.tool_calls` 为

```text
[
	{
		'name': 'multiply',
  	'args': {
  		'a': 2, 
  		'b': 3
  	},
  	'id': 'call_XXX',
  	'type': 'tool_call'
  }
]
```

### 2.4 使用消息作为 State

手动定义:

```python
from typing_extensions import TypedDict
from langchain_core.messages import AnyMessage

class MessagesState(TypedDict):
    messages: list[AnyMessage]
```

### 2.5 Reducers

> **Q: 为什么需要 `Reducer` ?**
>
> - 假设当前 State 为
>   ```python
>   {
>       "messages": [
>           HumanMessage(content="Hello")
>       ]
>   }
>   ```
>
> - 模型节点返回:
>   ```python
>   {
>       "messages": [
>           AIMessage(content="Hi")
>       ]
>   }
>   ```
>
> - 如果没有 reducer, 则新值会覆盖旧值, 最后只剩下
>   ```python
>   {
>       "messages": [
>           AIMessage(content="Hi")
>       ]
>   }
>   ```
>
> - 这样导致 `HumanMessage` 消失了, 但对话状态需要追加
>   ```python
>   [
>       HumanMessage(content="Hello"),
>       AIMessage(content="Hi"),
>   ]
>   ```
>
> - 因此需要 `add_messages`

**add_messages:**

```python
from typing import Annotated
from langgraph.graph.message import add_messages

class MessagesState(TypedDict):
    messages: Annotated[
        list[AnyMessage],
        add_messages
    ] # messages 是一个 list[AnyMessage] 类型的字段，并且这个字段更新时要使用 add_messages 这个规则。
```

### 2.6 内置 MessageState

由于消息状态非常常见, LangGraph 已经内置

```python
from langgraph.graph import MessagesState
```

等价于

```python
class MessagesState(TypedDict):
    messages: Annotated[
        list[AnyMessage],
        add_messages
    ]
```

如果要扩展内置状态, 例如添加自定义字段:
```python
class CustomState(MessagesState):
    user_id: str
    retry_count: int
```

### 2.7 构建图

```python
from IPython.display import Image, display
from langgraph.graph import StateGraph, START, END
    
# Node
def tool_calling_llm(state: MessagesState):
    return {"messages": [llm_with_tools.invoke(state["messages"])]}

# Build graph
builder = StateGraph(MessagesState)
builder.add_node("tool_calling_llm", tool_calling_llm)
builder.add_edge(START, "tool_calling_llm")
builder.add_edge("tool_calling_llm", END)
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

**示例1:**

```python
messages = graph.invoke({"messages": HumanMessage(content="Hello!")})
for m in messages['messages']:
    m.pretty_print()
```

```text
================================ Human Message =================================

Hello!
================================== Ai Message ==================================

Hello! How can I help you today?
```

**示例2:**

```python
messages = graph.invoke({"messages": HumanMessage(content="Multiply 2 and 3")})
for m in messages['messages']:
    m.pretty_print()
```

```text
================================ Human Message =================================

Multiply 2 and 3
================================== Ai Message ==================================
Tool Calls:
  multiply (call_00_1neDhYhULBgO7OdVbYjL1912)
 Call ID: call_00_1neDhYhULBgO7OdVbYjL1912
  Args:
    a: 2
    b: 3
```

## 3. Router

让大模型根据用户的问题, 决定直接回答, 还是调用某个工具

**整体流程:**

```text
                  ┌─ 没有工具调用 ─→ END
用户 → 大模型判断 ┤
                  └─ 产生工具调用 ─→ ToolNode → END
```

例如: 

- 用户问 “你好”: 模型就直接回答, 然后 END;
- 用户问 “2 乘 2 等于多少“: 模型决定调用 `multiply` 工具

### 3.1 定义工具

定义 `multiply` 工具, 并绑定给模型

```python
from lanchain_openai import ChatOpenAI

def multiply(a: int, b: int) -> int:
  	"""Multiply a and b.
  	
  	Args:
  			a: first int
  			b: second int
  	"""
    return a*b

# 绑定给模型
llm = ChatOpenAI(
		model = "deepseek-v4-flash",
  	temperature=0,
  	api_key=os.environ["DEEPSEEK_API_KEY"],
  	base_url="https://api.deepseek.com"
)
llm_with_tools = llm.bind_tools([multiply])
```

此时, 可以使用名为 `multiply` 的工具, 当用户问 "what is 2 multiplied by 2? ", 模型会返回一个**工具调用请求** (还没有真正执行 `Python` 函数):
```python
AIMessage(
    tool_calls=[
        {
            "name": "multiply",
            "args": {
                "a": 2,
                "b": 2
            }
        }
    ]
)
```

### 3.2 定义图

```python
from IPython.display import Image, display
from langgraph.graph import StateGraph, START, END
from langgraph.graph import MessagesState # 使用 LangGraph 内置的 MessagesState, 对 message 是用了消息 reducer
from langgraph.prebuilt import ToolNode
from langgraph.prebuilt import tools_condition # 本图的 router

# Node
def tool_calling_llm(state: MessagesState):
    return {"messages": [llm_with_tools.invoke(state["messages"])]}

# Build graph
builder = StateGraph(MessagesState)
builder.add_node("tool_calling_llm", tool_calling_llm)
builder.add_node("tools", ToolNode([multiply]))
builder.add_edge(START, "tool_calling_llm")
builder.add_conditional_edges(
    "tool_calling_llm",
    # If the latest message (result) from assistant is a tool call -> tools_condition routes to tools
    # If the latest message (result) from assistant is a not a tool call -> tools_condition routes to END
    tools_condition,
) # 检查最新的 AIMessage, 若存在 tool_calls, 则返回 "tools", 执行 ToolNode; 反之, 则返回 END.
builder.add_edge("tools", END)
graph = builder.compile()

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```

**调用:**

```python
from langchain_core.messages import HumanMessage
messages = [HumanMessage(content="Hello, what is 2 multiplied by 2?")]
messages = graph.invoke({"messages": messages})
for m in messages['messages']:
    m.pretty_print()
```

```text
================================[1m Human Message [0m=================================

Hello, what is 2 multiplied by 2?
==================================[1m Ai Message [0m==================================
Tool Calls:
  multiply (call_00_4gO4eoSW9OTspeFrBTPC5704)
 Call ID: call_00_4gO4eoSW9OTspeFrBTPC5704
  Args:
    a: 2
    b: 2
=================================[1m Tool Message [0m=================================
Name: multiply

4
```

## 4. Agent

在 `Router` 一节中, `ToolNode` 后面直接连 `END` 了, 这样最后输出的是 `ToolMessage(content="4")`, 而不是模型整理后的自然语言:

```text 
2 multipled by 2 is 4.
```

而一个完整的基础 Agent 会让 `ToolMessage` 重新回到模型, 再考虑调用工具还是得到最终回答, 其流程如下:
```text
用户
 ↓
模型
 ├── 直接回答 → END
 └── 调用工具
        ↓
      工具结果
        ↓
      返回模型
        ├── 再调用工具
        └── 最终回答 → END
```

### 4.1 ReAct

ReAct 全称 Reasoning+Acting

- Reason: 模型分析当前问题和已有结果
- Act: 模型选择并调用工具
- Observe: 把工具结果作为 ToolMessage 返回模型
- 重复以上过程, 直至模型直接回答

```text
用户提出问题
    ↓
Thought：分析当前需要做什么
    ↓
Action：调用某个工具
    ↓
Observation：获得工具返回结果
    ↓
Thought：根据结果继续判断
    ↓
Action：继续调用工具或生成答案
    ↓
Final Answer：输出最终结果
```

### 4.2 定义多个工具并绑定到模型

定义工具:

```python
def multiply(a: int, b: int) -> int:
    return a * b

def add(a: int, b: int) -> int:
    return a + b

def divide(a: int, b: int) -> float:
    return a / b

tools = [add, multiply, divide]
```

绑定模型:

```python
llm_with_tools = llm.bind_tools(
    tools,
    parallel_tool_calls=False
)
```

`parallel_tool_calls=False` 表示每次模型调用最多选择一个工具

### 4.3 SystemMessage

```python
sys_msg = SystemMessage(
    content=(
        "You are a helpful assistant tasked "
        "with performing arithmetic on a set of inputs."
    )
)
```

`SystemMessage` 规定 Agent 得总体职责为 执行算术任务.

模型节点:

```python
def assistant(state: MessagesState):
    return {
        "messages": [
            llm_with_tools.invoke(
                [sys_msg] + state["messages"]
            )
        ]
    }
```

每次调用模型, 输入由两部分组成 `SystemMessage+当前历史消息`

### 4.4 MessageState

```python
{
    "messages": [
        HumanMessage(...),
        AIMessage(tool_calls=[...]),
        ToolMessage(...),
        AIMessage(tool_calls=[...]),
        ToolMessage(...),
        AIMessage(content="最终答案")
    ]
}
```

### 4.5 构建图

```python
from langgraph.graph import START, StateGraph
from langgraph.prebuilt import tools_condition
from langgraph.prebuilt import ToolNode
from IPython.display import Image, display

# Graph
builder = StateGraph(MessagesState)

# Define nodes: these do the work
builder.add_node("assistant", assistant)
builder.add_node("tools", ToolNode(tools))

# Define edges: these determine how the control flow moves
builder.add_edge(START, "assistant")
builder.add_conditional_edges(
    "assistant",
    # If the latest message (result) from assistant is a tool call -> tools_condition routes to tools
    # If the latest message (result) from assistant is a not a tool call -> tools_condition routes to END
    tools_condition,
)
builder.add_edge("tools", "assistant")
react_graph = builder.compile()

# Show
display(Image(react_graph.get_graph(xray=True).draw_mermaid_png()))
```

![agent](/Users/wangsenjie/Sites/blog/source/_posts/从零开始——AI应用开发/LangChain/langgraph-foundations/Agent.png)

### 4.6 执行

```python
messages = [
  HumanMessage(
    content="Add 3 and 4. Multiply the output by 2. Divide the output by 5"
  )
]
messages = react_graph.invoke({"messages": messages})
```

```python
for m in messages['messages']:
    m.pretty_print()
```

```text
================================[1m Human Message [0m=================================

Add 3 and 4. Multiply the output by 2. Divide the output by 5
==================================[1m Ai Message [0m==================================
Tool Calls:
  add (call_00_hDatE3PUZjBEpoV0EKTx0453)
 Call ID: call_00_hDatE3PUZjBEpoV0EKTx0453
  Args:
    a: 3
    b: 4
=================================[1m Tool Message [0m=================================
Name: add

7
==================================[1m Ai Message [0m==================================
Tool Calls:
  multiply (call_00_mT9QDArQQsqWvpneF0kp5285)
 Call ID: call_00_mT9QDArQQsqWvpneF0kp5285
  Args:
    a: 7
    b: 2
=================================[1m Tool Message [0m=================================
Name: multiply

14
==================================[1m Ai Message [0m==================================
Tool Calls:
  divide (call_00_NzuDcoyKMNwOHs6kK7hQ1714)
 Call ID: call_00_NzuDcoyKMNwOHs6kK7hQ1714
  Args:
    a: 14
    b: 5
=================================[1m Tool Message [0m=================================
Name: divide

2.8
==================================[1m Ai Message [0m==================================

Here are the results:

1. **Add 3 and 4**: 3 + 4 = **7**
2. **Multiply by 2**: 7 × 2 = **14**
3. **Divide by 5**: 14 ÷ 5 = **2.8**

Final answer: **2.8**
```

## 5. Agent-Memory

> **Q: 为什么需要 Memory ?**
>
> - 上一节的 Agent 在一次 `invoke` 里面连续调用了多个工具;
>
> - 但是实际很多时候不会在一个 `invoke()` 里面说全;
>
> - 往往是分多个对话输入:
>
>   - 第一次调用:
>     ```python
>     react_graph.invoke({
>         "messages": [
>             HumanMessage(content="Add 3 and 4.")
>         ]
>     })
>     ```
>
>     模型得到 `3+4=7`
>
>   - 第二次调用:
>
>     ```python
>     react_graph.invoke({
>         "messages": [
>             HumanMessage(content="Multiply that by 2.")
>         ]
>     })
>     ```
>
>     此时模型看不到上一轮的 `7`, 不知道 `that` 指的是什么.
>
> - LLM 本身没有记忆
>
>   大模型本身不会记住上一次 API 请求. 所谓的 "对话记忆", 实际上是应用程序保存历史消息, 并在下一次请求时重新发送给模型.

### 5.1 MemorySaver

```python
from langgraph.checkpoint.memory import MemorySaver

memory = MemorySaver()

react_graph_memory = builder.compile(
    checkpointer=memory
)
```

- `MemorySaver` 是一个内存中的检查点存储
- `checkpointer` 会在图执行过程中保存 State (是某个时刻保存下来的 State 快照), 包括:
  - 消息历史
  - 当前节点位置
  - 节点执行结果
  - 工具调用和工具结果
- `Memory` 通过加载历史 `checkpoint` 实现跨调用记忆.

```text
StateGraph
   ↓ 每一步保存
Checkpointer
   ↓
某个 thread_id 对应的检查点
```

`thread_id` 是某段对话的唯一标识:

```python
config = {
    "configurable": {
        "thread_id": "1"
    }
}
```

可以理解成聊天会话的ID:
```text
thread_id="1" → 用户A的第一段对话
thread_id="2" → 用户A的另一段对话
```

不同 `thread_id` 状态相互隔离.

### 5.2 调用

#### 第一次调用

```python
messages = [
    HumanMessage(content="Add 3 and 4.")
]

result = react_graph_memory.invoke(
    {"messages": messages},
    config
)
```

这里的 `config` 包含 `thread_id= "1"`

执行流程如下:
```text
HumanMessage：3 + 4
    ↓
AIMessage：调用 add(3, 4)
    ↓
ToolMessage：7
    ↓
AIMessage：结果是 7
    ↓
保存到 thread_id="1"
```

保存的 State 为

```python
{
    "messages": [
        HumanMessage("Add 3 and 4."),
        AIMessage(tool_calls=[...]),
        ToolMessage("7"),
        AIMessage("The result is 7.")
    ]
}
```

#### 第二次调用

```python
messages = [
    HumanMessage(
        content="Multiply that by 2."
    )
]

result = react_graph_memory.invoke(
    {"messages": messages},
    config
)
```

因为仍然适用 `thread_id = "1"`, 所以 LangGraph 会加载上一次保存的 State, 并把新的 `HumanMessage` 追加到历史消息, 再继续执行 Agent, 最后保存更新后的 State.

如果换一个新的 `thread_id`, 那么模型仍然不知道 `that` 是什么.

