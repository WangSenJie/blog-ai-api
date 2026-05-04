---
title: ItemCF
date: 2026-03-29
description: 基于物品的协同过滤 (ItemCF) 的原理
# cover: /images/leetcode.png
categories:
  - 推荐算法
tags:
  -  召回
comments: True
mathjax: true
---
# ItemCF

> Q: 怎样判断我是否喜欢某物品?
> - 只需判断我是否喜欢与该物品相似的物品.

## ItemCF 的实现

目标: 预估用户 $\text{user}$ 对物品 $\text{item}$ 的兴趣.

已知: 
- 用户 $\text{user}$ 对物品 $\lbrace\text{item}_j\rbrace$ 的兴趣 $\text{like}\left(\text{user},\text{item}_j\right)$;
- 物品 $\text{item}_j$ 与 $\text{item}$ 的相似度 $\text{sim}\left(\text{item}_j,\text{item}\right)$.

则用户 $\text{user}$ 对物品 $\text{item}$ 的兴趣为
$$
\sum_{j=1}^n\text{like}\left(\text{user}, \text{item}_j\right)\times\text{sim}\left(\text{item}_j,\text{item}\right)
$$

> Q: 如何量化物品之间的相似度?
> - 采用余弦相似度


目标: 计算物品 $i_1$ 与 $i_2$ 之间的相似度.

已知:
- 喜欢物品 $i_1$ 的用户集合 $\mathcal W_1$;
- 喜欢物品 $i_2$ 的用户集合 $\mathcal W_2$.

则物品 $i_1, i_2$ 都喜欢的用户集合为 $\mathcal V=\mathcal W_1\cap\mathcal W_2$. 定义
$$
\text{sim}(i_1, i_2)=\frac{|\mathcal V|}{\sqrt{|\mathcal W_1|\cdot|\mathcal W_2|}}\in[0, 1].
$$

> RK: 上述公式未考虑喜欢的程度 $\text{like}(\text{user}, \text{item})$.

若考虑用户喜欢的程度, 则物品相似度公式修改为
$$
\text{sim}(i_1, i_2)=\frac{\sum_{v\in\mathcal V}\text{like}(v, i_1)\cdot\text{like}(v, i_2)}{\sqrt{\sum_{u_1\in\mathcal W_1}\text{like}^2(u_1,i_1)\cdot\sum_{u_2\in\mathcal W_2}\text{like}^2(u_2,i_2)}}\in[0, 1].
$$

## ItemCF 召回的完整流程

1. 事先做离线计算
    
    - 建立“用户 $\to$ 物品“索引, 即 $\lbrace\text{用户 ID}: (\text{物品 ID, 兴趣分数})\rbrace$.
      - 记录每个用户最近点击、交互过的物品 ID.
      - 给定任意用户 ID, 可找到他最近感兴趣的物品列表.
    
    - 建立“物品 $\to$ 物品“索引, 即 $\lbrace\text{物品 ID}: (\text{相似物品 ID, 相似度})\rbrace$.
      - 对于每个物品, 索引与它最相似的 $k$ 个物品.
      - 给定任意物品 ID, 可快速找到与它最相似的 $k$ 个物品.
2. 线上做召回
   - 给定用户 ID, 通过“用户 $\to$ 物品“索引, 找到用户最近感兴趣的物品列表 $last-n$.
   - 对于每个 $last-k$ 物品, 通过“物品 $\to$ 物品“索引, 找到 $top-k$ 相似物品.
   - 对于召回的 $nk$ 个物品, 用公式预估用户对每个物品的兴趣分数.
   - 返回分数最高的 $m$ 个物品作为召回结果.

## Swing 召回通道

> ItemCF 的不足之处: 小圈子的处理
> - 如果两物品的受众完全不同, 但他们被转发到了同一个微信群中, 使得很多用户同时交互过这两个物品, 导致程序错误计算了两物品之间的相似度.
> - 解决措施: 给用户设置权重, 重合度高的用户的权重要降低

**目标: 定义用户 $u_1, u_2$ 之间的重合度.**

已知:
- 用户 $u_1$ 喜欢的物品集合 $\mathcal J_1$;
- 用户 $u_2$ 喜欢的物品集合 $\mathcal J_2$.

则定义 $u_1, u_2$ 之间的重合度
$$
\text{overlap}(u_1, u_2)=\vert\mathcal J_1\cap\mathcal J_2\vert.
$$

**目标: 修正物品相似度公式, 减小小圈子问题带来的影响.**

已知:
- 喜欢物品 $i_1$ 的用户集合 $\mathcal W_1$;
- 喜欢物品 $i_2$ 的用户集合 $\mathcal W_2$.

则物品 $i_1, i_2$ 都喜欢的用户集合为 $\mathcal V=\mathcal W_1\cap\mathcal W_2$. 定义
$$
\text{sim}(i_1, i_2)=\sum_{u_1\in \mathcal V}\sum_{u_2\in\mathcal V}\frac{1}{\alpha+\text{overlap}(u_1, u_2)},
$$
其中 $\alpha$ 为人为设定的参数.

> 参考: 【推荐系统公开课——8小时完整版，讲解工业界真实的推荐系统】https://www.bilibili.com/video/BV1HZ421U77y?vd_source=54b296fb4038582045c08b7b00aa22a1