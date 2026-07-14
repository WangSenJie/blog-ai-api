---
title: 报告生成Agent——Word解析
date: 2026-05-17
description: 报告生成Agent的word读取技术验证，包括使用python-docx库解析Word文档内容。
categories:
  - 从零开始——AI应用开发
  - 报告生成Agent
tags:
comments: True
mathjax: false
published: false
---
# 报告生成Agent——Word解析

## 技术验证目标

- 读取 `Word` 文档
- 将文档内容拆分成块, 用于后续打标
- 接到 FastAPI 上传接口

## Word 解析技术验证

- 利用 `docx` 库读取 `Word` 文档内容
  ```python
  from docx import Document

  doc = Document(file_path) 
  ```
- 将文档内容拆分拆块
  - 第一版只考虑段落和表格
  - 先拆分段落
    ```python
    blocks = []
    paragraph_index = 0
    
    for para in doc.paragraphs:
        text = para.text.strip() # 除去字符串首尾空格
        if not text:
            continue

        paragraph_index += 1
        blocks.append({
            "block_id": f"p_{paragraph_index:03d}",
            "block_type": "paragraph",
            "text": text,
        })
    ```
  - 再拆分表格
    ```python
    table_index = 0

    for table in doc.tables:
        table_index += 1
        for row_index, row in enumerate(table.rows):
            for col_index, cell in enumerate(row.cells):
                text = cell.text.strip()
                if not text:
                    continue

                blocks.append({
                    "block_id": f"t_{table_index:03d}_r{row_index}_c{col_index}",
                    "block_type": "table_cell",
                    "text": text,
                })

    ```
- 问题/后续优化方向
  - 当前分块逻辑比较简单, 先对段落分块, 再对表格分块, 这与阅读顺序不一致
  - 没有处理图片等其他类型的内容

## 接入 FastAPI 上传接口
假设 `Word` 解析脚本为 `parse_docx.py`, 里面定义了一个 `parse_docx(file_path)` 函数, 返回解析后的内容块列表. 在 `main.py` 中创建一个上传接口, 接收前端上传的 `Word` 文件, 调用 `parse_docx` 函数解析文件, 并返回解析结果.
```python
from fastapi import FastAPI, File, UploadFile
from parse_docx import parse_docx

app = FastAPI()

@app.post("/upload/")
async def upload(file: UploadFile = File(...)):
    file_location = f"temp/{file.filename}"
    with open(file_location, "wb") as f:
        f.write(await file.read())

    blocks = parse_docx(file_location)
    return {"blocks": blocks}
```

## 做前端最小上传页
封装一个上传 `.docx` 模板文件的前端请求函数, 用 `axios` 把文件发送到 `FastAPI` 后端接口.
- 新建一个 `template.js` 文件
- 创建 `axios` 实例
```javascript
import axios from 'axios';

const request = axios.create({
    baseURL: 'http://127.0.0.1:8000', // FastAPI 后端地址
    timeout: 3000, // 请求超时时间
})
```
- 创建上传函数
    ```javascript
    export function uploadTemplate(file) {
        const formData = new FormData();
        formData.append('file', file);

        return request.post('/api/templates/upload', formData, {
            headers: {
                'Content-type': 'multipart/form-data',
            },
        });
    }
    ```
    - `request.post(url, data, config)` 是发送 `POST` 请求的方法

修改 `App.vue` 文件, 把整个首页变成上传页
- `<script setup>`: 逻辑区
    ```javascript
    <script setup>
    import { ref } from "vue"; # ref 是 Vue 3 里用来创建响应式变量的, 这样变量变化后页面会自动更新
    import { uploadTemplate } from "./api/template"; # 之前的 axios 请求函数
    ```
- 状态变量区
  ```javascript
  const selectedFile = ref(null); # 当前用户选择的文件
  const loading = ref(false); # 当前是否正在上传
  const result = ref(null); # 保存后端返回的解析结果
  const errorMessage = ref(""); # 保存错误信息
  ```
- 文件选择函数: `handleFileChange`
  ```javascript
  function handleFileChange(event) {
    const file = event.target.files?.[0];
    selectedFile.value = file || null;
    result.value = null;
    errorMessage.value = "";
  }
  ```
- 文件上传函数: `handleUpload`
  ```javascript
  async function handleUpload() {
    if (!selectedFile.value) {
        errorMessage.value = "请先选择一个 docx 文件";
        return;
    }

    loading.value = true;
    errorMessage.value = "";

    try {
        const response = await uploadTemplate(selectedFile.value);
        result.value = response.data;
    } catch (error) {
        errorMessage.value =
        error.response?.data?.error || error.message || "上传失败";
    } finally {
        loading.value = false;
    }
  }
  ```
  - `async/await` 用于处理异步请求, 让异步代码写起来像同步代码一样清晰, 主要用于处理 "需要等待结果" 的操作, 比如网络请求、读写文件、数据库查询、定时器等.
- 写 `HTML` 模板
  ```vue
  <template>
    <div class="upload-page">
      <h1>上传 Word 模板</h1>

      <!-- 文件选择: 只允许选 .docx -->
      <input
        type="file"
        accept=".docx"
        @change="handleFileChange"
      />

      <!-- 上传按钮: 没选文件或正在上传时禁用 -->
      <button
        :disabled="!selectedFile || loading"
        @click="handleUpload"
      >
        {{ loading ? "上传中..." : "上传并解析" }}
      </button>

      <!-- 错误提示: v-if 控制只在有错误时显示 -->
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

      <!-- 解析结果: v-for 循环渲染每个内容块 -->
      <div v-if="result" class="result">
        <h2>解析到 {{ result.blocks.length }} 个内容块</h2>
        <ul>
          <li v-for="block in result.blocks" :key="block.block_id">
            <span class="block-type">[{{ block.block_type }}]</span>
            {{ block.text }}
          </li>
        </ul>
      </div>
    </div>
  </template>
  ```
  - `v-if` / `v-for` 是 `Vue` 的指令: `v-if` 控制元素是否渲染, `v-for` 根据数组循环生成元素
  - `:key` 给循环出的每个元素一个唯一标识, 帮助 `Vue` 高效更新 `DOM` (这里用后端返回的 `block_id`)
  - `:disabled` 是 `v-bind:disabled` 的简写, 把按钮的禁用状态绑定到表达式上: 没选文件 (`!selectedFile`) 或正在上传 (`loading`) 时按钮不可点
  - `{{ }}` 是插值语法, 用来把变量值渲染到标签内

## 小结
这一篇打通了**前端上传 Word -> 后端解析 -> 前端展示内容块**的最小链路:
- 后端用 `python-docx` 把 `Word` 拆成段落块和表格块, 通过 `FastAPI` 的 `/upload/` 接口返回
- 前端用 `axios` 发送 `FormData` 上传文件, 拿到 `blocks` 后用 `v-for` 渲染

遗留问题在下一篇逐步解决:
- 当前分块顺序与阅读顺序不一致 (先段落再表格), 需要优化 `parse_docx` 的遍历逻辑
- 还没处理图片等内容类型
- 下一篇进入**打标模块**: 让用户在内容块上标记关键信息, 作为后续生成新报告的模板