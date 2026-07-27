---
title: 报告生成Agent——环境配置
date: 2026-05-17
slug: agent-2
description: 报告生成Agent的环境配置说明，包括开发环境、运行环境和依赖项。
categories:
  - 从零开始——AI应用开发
  - 报告生成Agent
tags:
comments: True
mathjax: false
---

# 报告生成Agent——环境配置

## 创建项目目录
```bash
mkdir -p report-demo/{backend,frontend,storage/{uploads,parsed,labels,schemas,outputs}}
```
## 初始化后端环境
- 创建 `Python3` 虚拟环境
  ```bash
    cd report-demo/backend
    python3 -m venv .venv # 基于当前终端的 `Python3` 版本创建名为 .venv 的虚拟环境
  ```
- 激活虚拟环境
  ```bash
    source .venv/bin/activate # 激活虚拟环境, 之后的 Python 包安装和运行都在这个环境中进行
  ```
- 安装依赖项
  ```bash
    pip install fastapi uvicorn python-multipart python-docx docxtpl
    ```
- 创建 `requirements.txt` 文件
  ```bash
    pip freeze > requirements.txt # 将当前虚拟环境中的所有安装的包及其版本信息写入 requirements.txt 文件
  ```

## 初始化前端环境
- 用 `Vite` 创建 `Vue` 项目
    ```bash
    cd ../frontend
    npm create vite@latest . -- --template vue
    ```
    - `npm` 是 `Node.js` 的包管理工具
    - `create vite@latest` 是使用 `Vite` 创建一个新的项目
    - `.` 表示在当前目录创建项目
    - `--template vue` 指定使用 `Vue` 模板
    - `npm create vite` 会生成一个 `package.json`，里面会写好 `Vue`、`Vite` 等基础依赖
- 安装 `package.json` 中记录的项目依赖和前端的常用库
    ```bash
    npm install # 安装 package.json 中记录的项目依赖
    npm install axios vue-router element-plus
    ```
    - `axios` 是一个基于 `Promise` 的 `HTTP` 客户端，用于发送网络请求
    - `vue-router` 是 `Vue.js` 的官方路由管理器，用于构建单页应用
    - `element-plus` 是一个基于 `Vue 3` 的组件库，提供丰富的 UI 组件和样式
- 启动前端开发服务器
    ```bash
    npm run dev # 启动前端开发服务器, 之后可以在浏览器访问 http://localhost:5173 来查看前端页面
    ``` 

## 运行后端最小服务
- 新开一个终端, 激活后端虚拟环境
    ```bash
    cd report-demo/backend
    source .venv/bin/activate # 激活后端虚拟环境
    ``` 
- 创建 `main.py` 文件, 先放最小版本
  ```bash
  mkdir -p app
  touch app/main.py
  ```
  在 `app.py` 中写入以下最小版本代码:
  ```python
  from fastapi import FastAPI

  app = FastAPI()

  @app.get("/ping")
  def ping():
    return {"message": "pong"} 
  ```
- 启动后端服务
  ```bash
  uvicorn app.main:app --reload # 启动后端服务, 之后可以在浏览器访问 http://localhost:8000/ping 来测试后端是否正常运行
  ```
