---
title: Hexo 指令
date: 2025-09-05 02:41:39
description: 收录 Hexo 常用命令、分类标签页面创建、图片资源管理与 SSH 部署方法。
# cover: /images/tx.jpg
categories:
    - Hexo 教程
tags: 
    - Hexo 教程
---
## 最常用（发文三步走）
```bash
hexo new "文章标题"          # 1) 新建文章（自动带日期与 front-matter）
hexo s -o                   # 2) 本地预览（-o 自动打开浏览器）
hexo d -g                   # 3) 生成并部署（等价：hexo g && hexo d）
```
## 文章管理
```bash
hexo list post              # 列出文章
hexo new draft "草稿标题"    # 新建草稿（source/_drafts/）
hexo publish "草稿标题"      # 草稿发布为正式文章（移到 _posts/）
hexo clean                  # 清缓存（改配置/主题后建议先 clean 再 g/s）
```

**建议的 front-matter 模板**（放进 scaffolds/post.md）：

```bash
title: {{ title }}
date: {{ date }}
categories:
  - 未分类
tags:
  - 
# 若你在 NexT 里 math.per_page: true，可按需开启：
# mathjax: true   # 或 katex: true
```

---

## 分类 / 标签 / 页面
```bash
hexo new page categories
# 打开 source/categories/index.md，写入：
# ---
# title: 分类
# type: categories
# ---

hexo new page tags
# 打开 source/tags/index.md，写入：
# ---
# title: 标签
# type: tags
# ---
```

---

## 图片 / 附件（PDF）

**开启文章资源夹（一次设置）：编辑站点根 _config.yml：**
```bash
post_asset_folder: true
```

然后：
```bash
hexo new "有图的文章"
# 会得到：
# source/_posts/有图的文章.md
# source/_posts/有图的文章/   ← 把图片/PDF丢这里
```

在文中引用：
```bash
![](./有图的文章/figure1.png)
[下载讲义](./有图的文章/讲义.pdf)
```

---

## 部署（你用 SSH）

站点根 _config.yml 中（确认一次即可）：
```bash
deploy:
  type: git
  repo: git@github.com:WangSenJie/WangSenJie.github.io.git
  branch: main
```

手动排障推送（遇到 hexo d 报错时）：
```bash
cd ~/Sites/blog/.deploy_git
git remote -v
git push origin HEAD:main
```

---

## 域名 / CNAME（可选）
```bash
# 自定义域名（防止 GitHub Pages 设置被覆盖）
echo blog.wangsenjie.com > source/CNAME
hexo d -g
```

---

## 快速排错
```bash
hexo clean && hexo s          # 大多显示问题先清缓存再预览
ssh -T git@github.com         # 检查 SSH 连通（应显示 successfully authenticated）

# YAML 报错（重复键/缩进）常见：
# YAMLException: duplicated mapping key
# 打开提示行附近去重；一个 key 只能出现一次

# 端口占用（4000 起不来）
hexo s -p 4001

# 查找误触发标题的 '---'（导致上一行变大）
grep -nE '^[[:space:]]*[-=]{3,}[[:space:]]*$' source/_posts/*.md
```

---

## 便捷脚本（推荐）

在站点 package.json 加：
```bash
{
  "scripts": {
    "start": "hexo s -o",
    "build": "hexo g",
    "deploy": "hexo d -g",
    "clean": "hexo clean",
    "new": "hexo new"           // 用法：npm run new \"标题\"
  }
}
```

以后可用：
```bash
npm run start
npm run deploy
```
