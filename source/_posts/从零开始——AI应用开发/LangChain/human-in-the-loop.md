---
title: 人机协作与执行控制
date: 2026-07-15
description: 人机协作与执行控制：断点、中断、状态编辑和时间旅行
categories:
  - 从零开始——AI应用开发
  - LangChain
tags:
comments: True
mathjax: false
---

这一章节将介绍 LangGraph 的人机协作调试能力: 暂停 graph、人工审批、修改状态、流式观察执行过程, 以及从历史 checkpoint 回放或分叉.

# 1. 静态断点

这一节讲的是如何在 LangGraph 执行到某个节点前暂停, 让人类审批后再继续执行.

> 实际场景中 Agent 调用工具可能存在风险, 所以希望先暂停, 让用户确认是否允许执行.
> - 例如真是项目里的工具可能是:
>   - 发邮件
>   - 转账
>   - 删除文件
>   - 提交订单
>   - 修改数据库
>   这种情况下不能让模型直接执行, 最好先暂停:
>   ```text
>   模型准备调用工具
>     ↓
>   暂停
>     ↓
>   人类检查工具名称和参数
>     ↓
>   批准后继续执行
>   ```

## 1.1 先定义一个 Agent
### 定义工具并绑定到模型
```python
from langchain_openai import ChatOpenAI

def multiply(a: int, b: int) -> int:
    """Multiply a and b.

    Args:
        a: first int
        b: second int
    """
    return a * b

# This will be a tool
def add(a: int, b: int) -> int:
    """Adds a and b.

    Args:
        a: first int
        b: second int
    """
    return a + b

def divide(a: int, b: int) -> float:
    """Divide a by b.

    Args:
        a: first int
        b: second int
    """
    return a / b

tools = [add, multiply, divide]
# llm = ChatOpenAI(model="gpt-4o")
llm = ChatOpenAI(
    model="deepseek-v4-flash",
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    temperature=0.0,
    base_url="https://api.deepseek.com"
)
llm_with_tools = llm.bind_tools(tools)
```

### 定义 Graph
```python
from IPython.display import Image, display

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState
from langgraph.graph import START, StateGraph
from langgraph.prebuilt import tools_condition, ToolNode

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

# System message
sys_msg = SystemMessage(content="You are a helpful assistant tasked with performing arithmetic on a set of inputs.")

# Node
def assistant(state: MessagesState):
   return {"messages": [llm_with_tools.invoke([sys_msg] + state["messages"])]}

# Graph
builder = StateGraph(MessagesState)

# Define nodes: these do the work
builder.add_node("assistant", assistant)
builder.add_node("tools", ToolNode(tools))

# Define edges: these determine the control flow
builder.add_edge(START, "assistant")
builder.add_conditional_edges(
    "assistant",
    # If the latest message (result) from assistant is a tool call -> tools_condition routes to tools
    # If the latest message (result) from assistant is a not a tool call -> tools_condition routes to END
    tools_condition,
)
builder.add_edge("tools", "assistant")
```

流程如下:
```text
START
  ↓
assistant
  ↓
如果 assistant 生成 tool call
  ↓
tools
  ↓
assistant
  ↓
最终回答
```

## 1.2 breakpoint 设置
关键代码:
```python
memory = MemorySaver()
graph = builder.compile(interrupt_before=["tools"], checkpointer=memory)
```
其中 `interrupt_before=["tools"]` 表示在执行 `tools` 节点之前暂停 (不是模型生成 `tool call` 之前).

于是流程变为了:
```text
用户输入：Multiply 2 and 3
  ↓
assistant 运行
  ↓
assistant 生成 tool call: multiply(2, 3)
  ↓
准备进入 tools 节点
  ↓
因为 interrupt_before=["tools"]，暂停
```

断点暂停后, LangGraph 要保存当前状态, 否则它不知道下次应该从哪里继续. 因此 `breakpoint` 通常配合 `checkpointer` 使用.

执行:
```python
# Input
initial_input = {"messages": HumanMessage(content="Multiply 2 and 3")}

# Thread
thread = {"configurable": {"thread_id": "1"}}

# Run the graph until the first interruption
for event in graph.stream(initial_input, thread, stream_mode="values"):
    event['messages'][-1].pretty_print()
```
```text
================================ Human Message =================================

Multiply 2 and 3
================================== Ai Message ==================================
Tool Calls:
  multiply (call_00_LrVr9rLzm5VmgLI7SQup7576)
 Call ID: call_00_LrVr9rLzm5VmgLI7SQup7576
  Args:
    a: 2
    b: 3
```
可以发现 graph 不会完整跑完, 它会在执行到 `tools` 节点之前暂停.

> **Q: 如何确认 Graph 暂停了 ?**
> ```python
> state = graph.get_state(thread)
> state.next
> ```
> 输出 `("tools",)`, 这表示 graph 当前停在 `tools` 节点之前.

> **Q: 如何继续执行 Graph ?**
> ```python
> for event in graph.stream(None, thread, stream_mode="values"):
>     event['messages'][-1].pretty_print()
> ```
> ```text
> ================================== Ai Message ==================================
> Tool Calls:
>   multiply (call_00_DANIdZu14KVIknUkLxNV5847)
>  Call ID: call_00_DANIdZu14KVIknUkLxNV5847
>   Args:
>     a: 2
>     b: 3
> ================================= Tool Message =================================
> Name: multiply
> 
> 6
> ================================== Ai Message ==================================
> 
> The result of multiplying 2 and 3 is **6**.
> ```
> 注意输入是 `None`, 即不需要新的用户输入, 模型会从上一次 `checkpoint` 停下来的地方继续执行.

## 1.3 人工审批

使用最简单的 `input()` 来实现审批
```python
# Input
initial_input = {"messages": HumanMessage(content="Multiply 2 and 3")}

# Thread
thread = {"configurable": {"thread_id": "2"}}

# Run the graph until the first interruption
for event in graph.stream(initial_input, thread, stream_mode="values"):
    event['messages'][-1].pretty_print()

# Get user feedback
user_approval = input("Do you want to call the tool? (yes/no): ")

# Check approval
if user_approval.lower() == "yes":
    
    # If approved, continue the graph execution
    for event in graph.stream(None, thread, stream_mode="values"):
        event['messages'][-1].pretty_print()
        
else:
    print("Operation cancelled by user.")
```
逻辑为
```text
运行到断点
  ↓
问用户是否批准
  ↓
如果 yes：继续执行 graph.stream(None, thread)
  ↓
如果 no：停止，不执行工具
```

## 1.4 LangGraph API 调用

```text
langgraph dev
  ↓
读取 langgraph.json
  ↓
发现 "agent": "./agent.py:graph"
  ↓
加载 agent.py
  ↓
找到 graph 对象
  ↓
启动 API 服务 http://127.0.0.1:2024
  ↓
notebook 通过 get_client 连接 API
  ↓
client.runs.stream(... assistant_id="agent" ...)
  ↓
API 服务运行 agent.py 里的 graph
```

### 启动服务

```bash
langgraph dev
```
启动之后会得到:
```text
API: http://127.0.0.1:2024
Studio UI: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
API Docs: http://127.0.0.1:2024/docs
```

### 使用 SDK 调用
```python
from langgraph_sdk import get_client

client = get_client(url="http://127.0.0.1:2024")
```

### 创建 thread 并运行 graph
```python
initial_input = {"messages": HumanMessage(content="Multiply 2 and 3")}
thread = await client.threads.create()
async for chunk in client.runs.stream(
    thread["thread_id"],
    assistant_id="agent",
    input=initial_input,
    stream_mode="values",
    interrupt_before=["tools"],
):
    print(f"Receiving new event of type: {chunk.event}...")
    messages = chunk.data.get('messages', [])
    if messages:
        print(messages[-1])
    print("-" * 50)
```

# 2. 动态断点

上一节我们实现了静态断点, 它需要开发者提前指定在哪个节点暂停. 
这一节讲的是让 graph 在运行过程中根据条件自己暂停.

## 2.1 定义一个简单的 Graph

这一小节我们定义一个简单的 graph, 它会根据输入字符串的长度来判断是否暂停.

```python
from IPython.display import Image, display

from typing_extensions import TypedDict
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import NodeInterrupt
from langgraph.graph import START, END, StateGraph

class State(TypedDict):
    input: str

def step_1(state: State) -> State:
    print("---Step 1---")
    return state

def step_2(state: State) -> State:
    # Let's optionally raise a NodeInterrupt if the length of the input is longer than 5 characters
    if len(state['input']) > 5:
        raise NodeInterrupt(f"Received input that is longer than 5 characters: {state['input']}")
    
    print("---Step 2---")
    return state

def step_3(state: State) -> State:
    print("---Step 3---")
    return state

builder = StateGraph(State)
builder.add_node("step_1", step_1)
builder.add_node("step_2", step_2)
builder.add_node("step_3", step_3)
builder.add_edge(START, "step_1")
builder.add_edge("step_1", "step_2")
builder.add_edge("step_2", "step_3")
builder.add_edge("step_3", END)

# Set up memory
memory = MemorySaver()

# Compile the graph with memory
graph = builder.compile(checkpointer=memory)

# View
display(Image(graph.get_graph().draw_mermaid_png()))
```
结构图为:
```text
START
  ↓
step_1
  ↓
step_2
  ↓
step_3
  ↓
END
```
执行流程为:
```text
START
  ↓
step_1
  ↓
step_2 检查 input 长度
  ↓
如果 input 长度 > 5：暂停
如果 input 长度 <= 5：继续 step_3
```

# 3. 编辑 Graph State
之前我们介绍了断点, 并让人类审批是否继续. 而本节我们的重点是暂停 graph 后, 让人类修改 state, 再继续.

> **Q: 为什么要修改 state ?**
> - Agent 在运行过程中, 模型可能会理解错用户的问题、生成错误的 tool call、填错参数、漏掉用户补充信息.
> - 这个时候希望可以直接修改当前 thread 的 state.

## 3.1 先搭建一个简单的带工具的 Agent
```python
from IPython.display import Image, display

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import MessagesState
from langgraph.graph import START, StateGraph
from langgraph.prebuilt import tools_condition, ToolNode

from langchain_core.messages import HumanMessage, SystemMessage

# System message
sys_msg = SystemMessage(content="You are a helpful assistant tasked with performing arithmetic on a set of inputs.")

# Node
def assistant(state: MessagesState):
   return {"messages": [llm_with_tools.invoke([sys_msg] + state["messages"])]}

# Graph
builder = StateGraph(MessagesState)

# Define nodes: these do the work
builder.add_node("assistant", assistant)
builder.add_node("tools", ToolNode(tools))

# Define edges: these determine the control flow
builder.add_edge(START, "assistant")
builder.add_conditional_edges(
    "assistant",
    # If the latest message (result) from assistant is a tool call -> tools_condition routes to tools
    # If the latest message (result) from assistant is a not a tool call -> tools_condition routes to END
    tools_condition,
)
builder.add_edge("tools", "assistant")

memory = MemorySaver()
graph = builder.compile(interrupt_before=["assistant"], checkpointer=memory) # 每次执行 assistant 节点之前暂停

# Show
display(Image(graph.get_graph(xray=True).draw_mermaid_png()))
```
这个 Graph 结构为
```text
START
  ↓
assistant
  ↓
如果有 tool call → tools
  ↓
assistant
  ↓
END
```

## 3.2 运行
```python
# Input
initial_input = {"messages": "Multiply 2 and 3"}

# Thread
thread = {"configurable": {"thread_id": "1"}}

# Run the graph until the first interruption
for event in graph.stream(initial_input, thread, stream_mode="values"):
    event['messages'][-1].pretty_print()
```
```text
================================ Human Message =================================

Multiply 2 and 3
```

查看当前 state:
```python
state = graph.get_state(thread)
state
```
从中可以看到当前 `thread` 状态, 包括
- 当前 `message`
- 下一步要执行的节点
- `checkpoint` 信息

### 使用 `update_state` 修改 `state`
```python
graph.update_state(
    thread,
    {"messages": [HumanMessage(content="No, actually multiply 3 and 3!")]},
)
```
即向当前 state 的 `messages` 中添加一条新的用户消息 (`MessagesState` 的 `messages` 字段默认使用 `add_messages` reducer).

继续执行:
```python
new_state = graph.get_state(thread).values
for m in new_state['messages']:
    m.pretty_print()
```
```text
================================ Human Message =================================

Multiply 2 and 3
================================ Human Message =================================

No, actually multiply 3 and 3!
```

继续执行:
```python
for event in graph.stream(None, thread, stream_mode="values"):
    event['messages'][-1].pretty_print()
```


# 4. 流式输出与中断

# 5. Time Travel
