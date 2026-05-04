---
title: UserCF
date: 2026-03-29
description: 基于用户的协同过滤 (UserCF) 的原理
# cover: /images/leetcode.png
categories:
  - 推荐算法
tags:
  -  召回
comments: True
mathjax: true
---

# UserCF

> Q: 怎样评判我对某物品的兴趣?
> - 只需判断与我兴趣相投的用户对该物品的兴趣即可.

## UserCF 的实现

目标: 预估用户 $\text{user}$ 对物品 $\text{item}$ 的兴趣.

已知: 
- 用户 $\text{user}$ 与用户队列 $\lbrace\text{user}_j\rbrace$ 之间的相似度 $\text{sim}\left(\text{user},\text{user}_j\right)$;
- 用户 $\text{user}_j$ 对物品 $\text{item}$ 的兴趣 $\text{like}\left(\text{user}_j,\text{item}\right)$.

则用户 $\text{user}$ 对物品 $\text{item}$ 的兴趣为
$$
\sum_{j=1}^n\text{sim}\left(\text{user}, \text{user}_j\right)\times\text{like}\left(\text{user}_j,\text{item}\right)
$$

> Q: 如何计算两用户之间的相似度?
> - 余弦相似度

目标: 计算用户 $u_1$ 与 $u_2$ 之间的相似度.

已知:
- 用户 $u_1$ 喜欢的物品集合 $\mathcal J_1$;
- 用户 $u_2$ 喜欢的物品集合 $\mathcal J_2$.

则 $u_1, u_2$ 都喜欢的物品集合为 $\mathcal I=\mathcal J_1\cap\mathcal J_2$. 定义
$$
\text{sim}(u_1, u_2)=\frac{|\mathcal I|}{\sqrt{|\mathcal J_1|\cdot|\mathcal J_2|}}\in[0, 1].
$$

> Q: 如果 $u_1, u_2$ 喜欢的恰好都是热门物品, 这里的喜欢通过用户“点击”、“点赞”、“转发”...反应, 那能说这两个用户兴趣相同吗?
> - 答案是否定的, 热门物品往往会被大部分人点击、转发, 两个不同领域不同兴趣的人很有可能都喜欢看《西游记》，但不代表他们兴趣一样. 因此需要降低热门物品权重, 物品越热门, 权重越低.

事实上, 用户相似度公式可以写成
$$
\text{sim}(u_1, u_2)=\frac{\sum_{i\in\mathcal I}1}{\sqrt{|\mathcal J_1|\cdot|\mathcal J_2|}}.
$$
不难看出 $\mathcal I$ 中物品的权重都是 $1$, 将其修正为:
$$
\text{sim}(u_1, u_2)=\frac{\sum_{i\in\mathcal I}\frac{1}{\log(1+n_i)}}{\sqrt{|\mathcal J_1|\cdot|\mathcal J_2|}},
$$
其中 $n_i$ 为喜欢物品 $i$ 的用户数量, 反应该物品的热门程度.

## UserCF 召回的完整流程

1. 事先做离线计算
    
    - 建立“用户 $\to$ 物品“索引, 即 $\lbrace\text{用户 ID}: (\text{物品 ID, 兴趣分数})\rbrace$.
      - 记录每个用户最近点击、交互过的物品 ID.
      - 给定任意用户 ID, 可找到他最近感兴趣的物品列表.
    
    - 建立“用户 $\to$ 用户“索引
      - 对于每个用户, 索引与他最相似的 $k$ 个用户.
      - 给定任意用户 ID, 可快速找到与他最相似的 $k$ 个用户.
2. 线上做召回
   - 给定用户 ID, 通过“用户 $\to$ 用户“索引, 找到 $top-k$ 相似用户.
   - 对于每个 $top-k$ 用户, 通过“用户 $\to$ 物品“索引, 找到用户近期感兴趣的物品列表 $list-n$.
   - 对于召回的 $nk$ 个物品, 用公式预估用户对每个物品的兴趣分数.
   - 返回分数最高的 $m$ 个物品作为召回结果.

> 参考: 【推荐系统公开课——8小时完整版，讲解工业界真实的推荐系统】https://www.bilibili.com/video/BV1HZ421U77y?vd_source=54b296fb4038582045c08b7b00aa22a1