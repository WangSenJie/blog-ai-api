---
title: FRONTEND-BASIC
date: 2026-05-09
description: HTML、CSS 和 JS 是什么？解决什么问题？怎么用？
categories:
    - 前端
tags:
  - HTML
  - CSS
  - JavaScript
comments: True
mathjax: true
---

# `HTML`、`CSS` 和 `JavaScript` 的分工

前端最核心的三件套就是 `HTML`、`CSS` 和 `JavaScript`.

> - `HTML`: 页面里有什么
> - `CSS`: 页面长什么样
> - `JavaScript`: 页面会发生什么

例如做一个简单的登录页面:

- `HTML` 负责写出标题、输入框、按钮这些页面结构
- `CSS` 负责控制颜色、间距、边框、对齐方式这些外观样式
- `JavaScript` 负责处理点击按钮、校验输入、发送请求这些交互逻辑

也可以把它们理解成:

- `HTML` = 骨架
- `CSS` = 外观
- `JavaScript` = 行为
<!-- 
所以当你和 AI 一起写前端代码时, 最重要的不是立刻去写复杂语法, 而是先把需求拆清楚:

- 哪些内容属于页面结构
- 哪些内容属于样式表现
- 哪些内容属于交互逻辑

比如你可以这样给 AI 描述需求:

- `HTML`: 我要一个标题、一个输入框和一个提交按钮
- `CSS`: 整体居中, 按钮是蓝色, 卡片有圆角和阴影
- `JavaScript`: 点击按钮后校验输入内容, 然后弹出提示 -->

这就是最基础但最实用的前端思维方式.

# `HTML` 简介

## `HTML` 是什么

> `HTML` 是什么?
> - `HTML` 是用来定义网页内容和结构的标记语言, 英文全称是 `HyperText Markup Language`, 中文一般叫"超文本标记语言".
> - 可以理解成: 它告诉浏览器, 这个页面里有什么.

## `HTML` 页面基本结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>我的第一个页面</title>
</head>
<body>
  <h1>Hello HTML</h1>
  <p>这是一个简单的网页。</p>
</body>
</html>
```
其中:
- `<!DOCTYPE html>` 声明这是一个 `HTML5` 页面.
- `<html lang="zh-CN">` 是整个 `HTML` 页面的根标签, 并且告诉浏览器和搜索引擎这个页面的语言是 "简体中文".
- `<head>` 放页面的“配置信息”, 这些内容通常不给用户直接看. 比如字符编码、页面标题、移动端适配、引入 `CSS`/`JS`.
- `<meta charset="UTF-8" />` 指定字符编码是 `UTF-8`, 避免中文乱码.
- `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` 让页面在手机上正常缩放和显示. 页面的宽度应该跟设备宽度一致, 并且初始缩放比例是 `1`
- `<title>` 浏览器标签页上显示的标题
- `<body>` 放页面真正显示给用户看的内容. 比如标题、段落、图片、按钮、表单这些.

> `HTML` 页面本质上就是: 用 `<head>` 描述页面, 用 `<body>` 承载内容.

### 常见的 `HTML` 标签:
- `<h1>` 到 `<h6>`: 标题. 例: `<h1>HTML</h1>`
- `<p>`: 段落. 例: `<p>hello world</p>`
- `<a>`: 链接. 例: `<a href="https://example.com">打开网站</a>`
- `<img>`: 图片. 例: `<img src="cover.jpg" alt="封面图" />`
- `<div>`: 块级容器标签, 用来把一组内容包起来.
- `<span>`: 行内容器标签, 通常用来包住一小段文字或局部内容
- `<ul>`: 无序列表.
- `<ol>`: 有序列表.
- `<li>`: 列表项.
  ```html
      <ul>
          <li>HTML</li>
          <li>CSS</li>
          <li>JavaScript</li>
      </ul>
  ```
- `input`: 输入框.
- `button`: 按钮
  ```html
      <form>
          <label>用户名</label>
          <input type="text" />
          <button type="submit">提交</button>
      </form>
   ```

## `HTML` 标签的常见属性

`HTML` 标签的属性, 是写在开始标签里的补充信息, 用来说明这个元素的更多细节.

> - 标签决定“这是什么”
> - 属性决定“它怎么表现、指向哪里、有什么标识”

属性的基本写法通常是:

```html
<标签名 属性名="属性值">内容</标签名>
```

### 常见的 `HTML` 标签属性
- `href`: 用于 `<a>` 标签, 指定链接地址. 例: `<a href="https://example.com">打开网站</a>`
- `src`: 用于 `<img>` 标签, 指定图片地址. 例: `<img src="cover.jpg" alt="封面图" />`
- `alt`: 用于 `<img>` 标签, 图片无法显示时的替代文本. 例: `<img src="cover.jpg" alt="封面图" />`
- `class`: 用于给元素指定一个或多个类名, 方便 `CSS` 和 `JS` 选择和操作. 例: `<div class="card">这是一张卡片</div>`
- `id`: 用于给元素指定一个唯一的标识符, 方便 `CSS` 和 `JS` 选择和操作. 例: `<h1 id="main-title">欢迎来到我的网站</h1>`
- `title`: 用于给元素添加一个提示文本, 当用户鼠标悬停在元素上时显示. 例: `<p title="这是一个段落">这是一个段落</p>`
- `target`: 用于 `<a>` 标签, 指定链接的打开方式. 例: `<a href="https://example.com" target="_blank">在新标签页打开</a>`
- `type`: 用于 `<input>` 和 `<button>` 标签, 指定输入框或按钮的类型. 例: `<input type="text" />`, `<button type="submit">提交</button>`
- `placeholder`: 用于 `<input>` 标签, 指定输入框的占位文本. 例: `<input type="text" placeholder="请输入用户名" />`

## 语义化标签
语义化标签, 指的是标签本身就带有明确含义, 能让人一眼看出这部分内容是做什么的.

比如:

- `<header>`: 页头
- `<nav>`: 导航
- `<main>`: 页面主要内容
- `<section>`: 一个内容区块
- `<article>`: 一篇独立的文章或内容
- `<footer>`: 页脚

相比只使用 `<div>`, 语义化标签能让页面结构更清楚.

例如下面两种写法都能实现页面结构:

```html
<div>
  <div>网站标题</div>
  <div>导航菜单</div>
  <div>文章内容</div>
  <div>页脚</div>
</div>
```
```html
<header>网站标题</header>
<nav>导航菜单</nav>
<main>
  <article>文章内容</article>
</main>
<footer>页脚</footer>
```

第二种写法更容易读懂, 因为标签本身已经说明了这块区域的用途.

### 为什么要用语义化标签

语义化标签的好处主要有这些:

- 代码结构更清晰, 自己以后回头看也更容易懂
- 更利于搜索引擎理解页面内容
- 更利于屏幕阅读器等辅助工具识别页面结构
- 与 `CSS`、`JavaScript` 配合时, 语义上更自然

## 表单基础

表单是网页中用于接收用户输入信息的区域.

比如登录、注册、搜索、留言、提交评论, 本质上都离不开表单.

一个最简单的表单例子如下:

```html
<form>
  <label for="username">用户名</label>
  <input id="username" type="text" placeholder="请输入用户名" />

  <label for="password">密码</label>
  <input id="password" type="password" placeholder="请输入密码" />

  <button type="submit">提交</button>
</form>
```

这个表单里最常见的几个标签有:

- `<form>`: 表单整体
- `<label>`: 输入项的说明文字
- `<input>`: 输入框
- `<button>`: 按钮

### 常见表单标签

- `<form>`: 表示一个表单区域, 用来包裹所有需要提交的数据.
- `<input>`: 最常见的输入标签, 不同的 `type` 表示不同类型的输入框, 比如 `text`、`password`、`email`.
- `<label>`: 用来描述输入框的含义, 让用户知道这里该填什么.
- `<button>`: 表示按钮, 在表单中最常见的是提交按钮.
- `<textarea>`: 用于多行文本输入, 比如留言、评论.
- `<select>`: 用于下拉选择.

例如:

```html
<textarea placeholder="请输入留言内容"></textarea>

<select>
  <option>北京</option>
  <option>上海</option>
  <option>广州</option>
</select>
```

# `CSS` 简介

## `CSS` 是什么

`CSS`(`Cascading Style Sheets`) 是用来控制网页样式的语言.

> - `HTML` 决定页面里有什么
> - `CSS` 决定这些内容长什么样

比如文字颜色、字体大小、边距、边框、背景颜色、页面布局这些, 都主要由 `CSS` 控制.

例如:

```css
h1 {
  color: blue;
  font-size: 32px;
}
```

这段 `CSS` 的意思是:

- 把页面中的 `h1` 标题文字设置成蓝色
- 把字体大小设置成 `32px`

## `CSS` 怎么写到页面里

常见的写法有三种:

### 行内样式

直接写在标签的 `style` 属性里:

```html
<p style="color: red;">这是一段红色文字</p>
```

这种方式简单直接, 但不适合写太多样式.

### 内部样式

写在页面的 `<style>` 标签里:

```html
<head>
  <style>
    p {
      color: red;
    }
  </style>
</head>
```

<!-- 这种方式适合小型页面或练习时使用. -->

### 外部样式表

把样式写到单独的 `.css` 文件中, 再在 `HTML` 中引入:

```html
<head>
  <link rel="stylesheet" href="style.css" />
</head>
```

这是实际开发中最常见的方式.

## 常见选择器

选择器的作用, 就是告诉 `CSS`: 你要给谁加样式.

### 标签选择器

直接选中某种标签:

```css
p {
  color: green;
}
```

表示所有 `<p>` 标签都变成绿色.

### 类选择器

用 `.类名` 选中带有某个 `class` 的元素:

```html
<div class="card">这是一张卡片</div>
```

```css
.card {
  border: 1px solid #ddd;
}
```

### `id` 选择器

用 `#id名` 选中带有某个 `id` 的元素:

```html
<h1 id="title">我的博客</h1>
```

```css
#title {
  color: purple;
}
```

<!-- 对于初学者来说, 先掌握这三种选择器就够用了. -->

## 常见样式属性

下面这些是最常见、最实用的 `CSS` 属性:

- `color`: 文字颜色
- `font-size`: 字体大小
- `background`: 背景颜色
- `width`: 宽度
- `height`: 高度
- `margin`: 外边距
- `padding`: 内边距
- `border`: 边框
- `border-radius`: 圆角
- `text-align`: 文本对齐方式

例如:

```css
.card {
  width: 300px;
  padding: 20px;
  margin: 20px auto;
  border: 1px solid #ddd;
  border-radius: 12px;
  background: #f8f8f8;
}
```

这段样式可以把一个普通的 `div` 变成一个简单的卡片区域.

## 布局基础: `flex`

<!-- 前端布局里最值得先学的是 `flex`. -->

它适合用来做:

- 水平排列
- 垂直居中
- 元素之间均匀分布

一个最简单的例子:

```css
.container {
  display: flex;
  justify-content: center;
  align-items: center;
}
```

这里:

- `display: flex` 开启弹性布局
- `justify-content: center` 让内容水平居中
- `align-items: center` 让内容垂直居中

<!-- 如果你只是想先看懂大多数简单页面, 那掌握 `flex` 就已经很够用了. -->

## `CSS` 负责什么, 不负责什么

`CSS` 主要负责:

- 颜色
- 字体
- 间距
- 边框
- 阴影
- 布局

`CSS` 不负责:

- 页面内容本身
- 点击后的业务逻辑
- 数据请求

可以简单记成:

- `HTML` 负责结构
- `CSS` 负责外观
- `JavaScript` 负责交互

# `JavaScript` 简介

## `JavaScript` 是什么

`JavaScript` 是让网页“动起来”的语言.

如果说:

- `HTML` 是页面骨架
- `CSS` 是页面外观

那么 `JavaScript` 就是页面的行为和交互.

比如:

- 点击按钮后弹出提示
- 输入内容后实时校验
- 请求后端接口获取数据
- 修改页面上的文字和内容

这些通常都由 `JavaScript` 完成.

## `JavaScript` 能做什么

对初学者来说, 最常见的用途有三类:

- 处理用户操作, 比如点击、输入、提交
- 修改页面内容
- 与后端接口通信

例如点击按钮后修改文字:

```html
<p id="text">还没有点击按钮</p>
<button id="btn">点我</button>
```

```html
<script>
  const btn = document.getElementById("btn");
  const text = document.getElementById("text");

  btn.addEventListener("click", function () {
    text.textContent = "你点击了按钮";
  });
</script>
```

## 常见语法: 变量、条件、函数

### 变量

变量用来保存数据, 常见写法有 `let` 和 `const`.

```js
let name = "Tom";
const age = 20;
```

- `let`: 之后可能会变(变量)
- `const`: 定义后通常不再改(常量)

### 条件判断

```js
const score = 85;

if (score >= 60) {
  console.log("及格");
} else {
  console.log("不及格");
}
```

### 函数

```js
function sayHello() {
  console.log("Hello");
}

sayHello();
```

## `DOM` 操作: 选元素、改内容、绑事件

前端里最常见的 `JavaScript` 操作之一, 就是操作页面元素, 也就是操作 `DOM`.

常见动作有:

- 选中元素
- 修改内容
- 监听事件

例如:

```html
<h1 id="title">原始标题</h1>
<button id="changeBtn">修改标题</button>
```

```html
<script>
  const title = document.getElementById("title");
  const changeBtn = document.getElementById("changeBtn");

  changeBtn.addEventListener("click", function () {
    title.textContent = "标题已修改";
  });
</script>
```

这里:

- `document.getElementById` 用来选中元素
- `addEventListener` 用来监听事件
- `textContent` 用来修改文字内容

## 与后端通信: `fetch`

前端经常需要请求后端接口, 最常见的方法之一就是 `fetch`.

例如:

```js
fetch("/api/user")
  .then(response => response.json())
  .then(data => {
    console.log(data);
  });
```

它的意思是:

- 向 `/api/user` 发请求
- 把返回结果转成 `JSON`
- 再处理返回的数据

<!-- 你现阶段不需要把异步原理学得很深, 只要知道前端可以通过 `fetch` 获取数据就够了. -->

<!-- ## `JavaScript` 负责什么, 不负责什么

`JavaScript` 主要负责:

- 事件响应
- 页面内容更新
- 表单校验
- 网络请求
- 交互逻辑

`JavaScript` 不负责:

- 页面基础结构
- 主要视觉样式

所以:

- 结构问题看 `HTML`
- 样式问题看 `CSS`
- 交互问题看 `JavaScript` -->

<!-- ## 如何用 `HTML`、`CSS` 和 `JavaScript` 指挥 `AI`

如果你打算让 `AI` 帮你写前端代码, 最重要的不是把三种语言学得很深, 而是先学会拆需求.

你可以按下面这套思路给 `AI` 提要求:

- `HTML`: 页面里要有什么
- `CSS`: 页面要长什么样
- `JavaScript`: 页面要怎么交互

例如你想做一个登录框, 可以这样描述:

- `HTML`: 一个标题、两个输入框、一个登录按钮
- `CSS`: 整个卡片居中, 白底, 圆角, 阴影, 按钮蓝色
- `JavaScript`: 点击登录按钮时检查输入是否为空, 如果为空就提示, 不为空就发请求

这种表达方式会让 `AI` 写出来的代码更清楚, 也更容易修改. -->

## 小结

这篇文章里最重要的不是记住所有标签、属性和语法细节, 而是先建立一个最小认知框架:

- `HTML` 决定页面结构
- `CSS` 决定页面样式
- `JavaScript` 决定页面交互

能把一个需求拆成这三部分时, 就具备和 `AI` 配合完成大多数简单前端页面的基础能力了.