---
title: GBDT
date: 2025-10-15
description: 从函数空间梯度下降的角度讲清 GBDT，包括平方损失、逻辑损失和多分类 softmax 的推导。
# cover: /images/GBDT-f1.png
categories:
  - 机器学习与深度学习
  - 集成学习
tags:
  - 集成学习
  - boosting
mathjax: true
---

# Gradient Boosting Decision Trees

## 背景

Gradient Boosting Decision Tree (GBDT) 是 Boosting 算法的一种, 早期理论 (Schapire, 1990) 证明: 只要有一个稍微优于随机猜测的弱分类器 (准确率 > 0.5), 就可以通过 Boosting 组合成强分类器. Freund 和 Schapire (1997) 的 AdaBoost 将这一思想转化为实际算法. 在 AdaBoost 提出之后, 人们逐渐认识到 Boosting 的本质是一种加性模型, 其核心思想是在每一步逐渐叠加弱学习器以最小化某个总体损失函数. Friedman 等人在此基础上提出了更为一般的理论框架, 将 Boosting 视为在函数空间中的梯度下降 (gradient descent) 过程. Friedman (2000) 在论文 *Greedy Function Approximation: A Gradient Boosting Machine* 中首次系统地提出了 Gradient Boosting 的概念，并指出 AdaBoost 实质上是以指数损失为目标函数的特殊情形. 他进一步推广了这一思想, 允许使用任意可微损失函数, 通过迭代地拟合当前损失的负梯度方向, 构建出更强的预测模型. GBDT 正是这一框架的典型实现: 它以决策树作为基学习器, 在每一轮中利用回归树来拟合损失函数对模型预测值的负梯度, 从而逐步优化整体模型性能.  由于其能够灵活适配不同损失函数 (如平方误差、逻辑损失、Huber 损失等), GBDT 既可用于回归问题, 也可用于分类乃至排序任务. 相比 AdaBoost, GBDT 在理论上更为一般、在实践中更为稳定, 对噪声数据的鲁棒性也更强, 因此成为现代机器学习中最重要的集成学习方法之一, 并衍生出了多种高效实现, 如 XGBoost、LightGBM 与 CatBoost 等.

## 问题目标和符号设定

给定训练 $\lbrace(x_i,y_i)\rbrace_{i=1}^n$, 我们想要找到一个函数 $F:~\mathcal X\to\mathbb R^K$ (回归问题 $K=1$, 二分类问题常用 $K=1$ 的对数几率分数) 以最小化经验风险
$$
\min\limits_{F\in\mathcal F}\mathcal L(F)=\min\limits_{F\in\mathcal F}\sum_{i=1}^nL(y_i,F(x_i)),
$$
其中 $L$ 为损失函数. GBDT 把可行函数集 $\mathcal F$ 限制为 "加性模型" 的闭包:
$$
F_M(x)=F_0(x)+\sum_{m=1}^M\nu f_m(x),
$$
其中每个学习器 $f_m$ 是回归树, $\nu\in(0,1]$ 为学习率.

## 函数空间的梯度下降

考虑第 $m$ 轮.

将 $\lbrace F(x_i)\rbrace_{i=1}^n$ 看成 $\mathbb R^n$ 上的向量, 对 $\mathcal L(F)$ 在这些分量求梯度:
$$
g_i:=\frac{\partial L(y_i,F(x_i))}{\partial F(x_i)}\bigg\vert_{F=F_{m-1}}
$$
 则负梯度 $-g_i$ 方向指向最速下降方向.

用一棵回归树 $f_m(x)$ 去拟合负梯度
$$
f_m\approx\arg\min\limits_{f}\sum_{i=1}^n\left(-g_i-f(x_i)\right)^2,
$$
在得到的树划分 $\lbrace R_{jm}\rbrace_{j=1}^{J_m}$ (叶结点区域) 上, 求每个叶子的最佳增量
$$
\gamma_{jm}\approx\arg\min\limits_{\gamma}\sum_{x_i\in R_{jm}}L(y_i,F_{m-1}(x_i)+\gamma).
$$
更新
$$
F_m(x)=F_{m-1}(x)+\nu\sum_{j=1}^{J_m}\gamma_{jm}1\lbrace x\in R_{jm}\rbrace.
$$

## 不同损失下的具体形式

### 平方损失 (回归)

$$
L(y,F)=\frac12(y-F)^2.
$$

此时

- 梯度 $g_i=F(x_i)-y_i$, 负梯度即为残差 $y_i-F(x_i)$.
- 叶值闭式解 $\gamma_{jm}=\mathrm{mean}\lbrace y_i-F_{m-1}(x_i)~:~x_i\in R_{jm}\rbrace$.
- 初始值 $F_0=\mathrm{mean}(y)$.

### 绝对损失 / 分位数损失 (稳健回归)

- $L_1$ 损失: 叶值取中位数.
- 分位数损失 $\tau\in(0,1)$: 叶值取 $\tau-$ 分位数.
  对异常值更稳健.

### 二分类的 Logistic 损失

此时 $y_i\in\lbrace0,1\rbrace$, 令模型输出为对数几率
$$
F(x)=\log\frac{p(x)}{1-p(x)},\quad p(x)=\sigma(F(x))=\frac{1}{1+e^{-F(x)}}.
$$

- 损失: 交叉熵 $L(y,F)=-\left[y\log p+(1-y)\log(1-p)\right]$.

- 梯度: $g_i=-\left[y_i\frac{p_i(1-p_i)}{p_i}+(1-y_i)\frac{p_i(p_i-1)}{1-p_i}\right]=p_i-y_i$, 负梯度: $r_i=y_i-p_i$.

- 叶值: 在叶 $R_{jm}$ 
  $$
  \gamma_{jm}\approx\frac{\sum_{x_i\in R_{jm}}(y_i-p_i)}{\sum_{x_i\in R_{jm}}p_i(1-p_i)}.
  $$

  > 注意到 $\frac{\partial L}{\partial F}=p_i-y_i,~\frac{\partial^2 L}{\partial F^2}=p_i(1-p_i)$, 于是由 Taylor 定理
  > $$
  > L(y_i,F_{m-1}(x_i)+\gamma)\approx L(y_i,F_{m-1}(x_i))+g_i\gamma+\frac12h_i\gamma^2,
  > $$
  > 其中 $g_i,h_i$ 分别为一阶导和二阶导. 因此
  > $$
  > \sum_{x_i\in R_{jm}}L(y_i,F_{m-1}(x_i)+\gamma)\approx \sum_{x_i\in R_{jm}}L(y_i,F_{m-1}(x_i))+G_{jm}\gamma+\frac12 H_{jm}\gamma^2,
  > $$
  > 其中 $G_{jm}=\sum_{x_i\in R_{jm}}g_i=\sum_{x_i\in R_{jm}}(p_i-y_i),~H_{jm}=\sum_{x_i\in R_{jm}}h_i=\sum_{x_i\in R_{jm}}p_i(1-p_i)$. 故
  > $$
  > \gamma_{jm}=\arg\min\limits_{\gamma}\sum_{x_i\in R_{jm}}L(y_i,F_{m-1}(x_i)+\gamma)=\arg\min\limits_{\gamma}\left(G_{jm}\gamma+\frac12 H_{jm}\gamma^2\right)=-\frac{G_{jm}}{H_{jm}}.
  > $$

- 初始值: $F_0=\log\frac{\bar y}{1-\bar y}$, 其中 $\bar y$ 是样本中正类比例.

### 多分类 softmax

输出向量 $F(x)\in\mathbb R^c,~p_k(x)=\frac{\exp(F_k(x))}{\sum_{l}\exp(F_l(x))}$. 此时损失函数为
$$
L=\sum_{i=1}^nl_i,\quad l_i=-\sum_{k=1}^cy_{ik}\log(p_{ik}),~y_{ik}=1\lbrace y_i=k\rbrace,
$$
在第 $m$ 轮通常训练 $c$ 棵树, 分别拟合每一类的负梯度
$$
r_{ik}=y_{ik}-p_{ik},\quad 
$$
在叶 $R_{jmk}$ 上, 我们只更新该类的分数 $F_k\to F_k+\gamma$. 用一维二阶近似:
$$
\gamma_{jmk}\approx-\frac{G_{jmk}}{H_{jmk}},\quad G_{jmk}=\sum_{x_i\in R_{jmk}}(p_{ik}-y_{ik}),\quad H_{jmk}=\sum_{x_i\in R_{jmk}}p_{ik}(1-p_{ik})+\lambda
$$
因此
$$
\gamma_{jmk}\approx-\frac{\sum_{x_i\in R_{jmk}}(p_{ik}-y_{ik})}{\sum_{x_i\in R_{jmk}}p_{ik}(1-p_{ik})+\lambda}.
$$
其中 $\lambda$ 为正则项. 更新模型:
$$
F_k^{(m)}(x)=F_k^{(m-1)}(x)+\nu\sum_{j=1}^{J_{mk}}\gamma_{jmk}1\lbrace x\in R_{jmk}\rbrace,\quad k=1,2,\cdots,c.
$$
最后用 softmax 函数得到概率.
