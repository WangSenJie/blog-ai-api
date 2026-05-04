---
title: AdaBoost
date: 2025-10-02
description: 梳理 AdaBoost 的核心思想、指数损失推导、参数估计过程与边际理论直觉。
# cover: /images/ada-f1.png
categories:
  - 机器学习与深度学习
  - 集成学习
tags:
  - 集成学习
  - boosting
mathjax: true
---

# Adaptive Boosting

## 1 背景介绍

AdaBoost (Adaptive Boosting) 是一个 Boosting 算法. Robert Schapire (1990) 在 *The Strength of Weak Learnability* 中提出了第一个 Boosting 算法, 证明弱学习器可以组合成强学习器. 随后 Freund & Schapire (1997) 在论文 *A Decision-Theoretic Generalization of On-Line Learning and an Application to Boosting* 中提出了 AdaBoost. 进一步地，Schapire 等人 (1998) 在 *Boosting the Margin* 中提出了"边际理论", 解释了 AdaBoost 在训练误差为零后仍能持续降低测试误差的现象，为理解其泛化性能提供了新的理论框架.

## 2 算法原理

### 2.1 研究目标与符号说明

设有训练集 $\lbrace(x_i,y_i)\rbrace_{i=1}^{n},~ y_i\in\lbrace-1,+1\rbrace$. 我们要构造一个二分类模型预测 $y$. 设第 $m$ 轮选练的弱学习器为 $h_m:~\mathcal X\to\lbrace-1,+1\rbrace$. 模型总共训练 $M$ 轮. 我们想要构造分类器:
$$
F_M(x)=\sum_{m=1}^M\alpha_mh_m(x),\quad \hat y(x)=\text{sign}(F_M(x)).
$$
采用最小化指数损失:
$$
J(F)=\sum_{i=1}^n\exp\left(-y_iF(x_i)\right).
$$

### 2.2 参数估计

假定已有上一轮模型 $F_{m-1}$, 下面要找 $(\alpha_m,h_m)$ 以降低 $J(F)$:
$$
\min\limits_{\alpha,h}\sum_{i=1}^n\exp\left(-y_i(F_{m-1}(x_i)+\alpha h(x_i))\right).
$$
记
$$
w_i^{(m)}:=\exp\left(-y_iF_{m-1}(x_i)\right),
$$
则目标转化为
$$
\min\sum_{i=1}^nw_i^{(m)}\exp(-\alpha y_ih(x_i))).
$$
注意到 $h(x_i)\in\lbrace-1,+1\rbrace$, 因此
$$
\exp(-\alpha y_ih(x_i))=\begin{cases}
\exp(-\alpha),&\text{样本分类正确},\\\\
\exp(\alpha),&\text{样本分类错误}.
\end{cases}
$$
再令加权误差
$$
\varepsilon_m:=\frac{\sum_{i:~h(x_i)\neq y_i}w_i^{(m)}}{\sum_iw_i^{(m)}},\quad 1-\varepsilon_m:=\frac{\sum_{i:~h(x_i)= y_i}w_i^{(m)}}{\sum_iw_i^{(m)}}.
$$
于是
$$
\begin{aligned}
J(F_m)&=\left(\sum_{i:~h(x_i)\neq y_i}+\sum_{i:~h(x_i)= y_i}\right)\left(w_i^{(m)}\exp(-\alpha y_ih(x_i)))\right)\\\\
&=\exp(\alpha)\sum_{i:~h(x_i)\neq y_i}w_i^{(m)}+\exp(-\alpha)\sum_{i:~h(x_i)= y_i}w_i^{(m)}\\\\
&=\exp(\alpha)\varepsilon_m\sum_iw_i^{(m)}+\exp(-\alpha)(1-\varepsilon_m)\sum_iw_i^{(m)}\\\\
&=\left(\sum_iw_i^{(m)}\right)\left(\varepsilon_me^{\alpha}+(1-\varepsilon_m)e^{-\alpha}\right).
\end{aligned}
$$
令
$$
\begin{aligned}
&\frac{\partial}{\partial\alpha}J(F_m)=\left(\sum_iw_i^{(m)}\right)\left(\varepsilon \alpha e^{\alpha}-(1-\varepsilon)\alpha e^{-\alpha}\right)=0.\\\\
\Rightarrow & \varepsilon \alpha e^{\alpha}-(1-\varepsilon)\alpha e^{-\alpha}=0.\\\\
\Rightarrow & \varepsilon\alpha e^{2\alpha}=1-\varepsilon
\end{aligned}
$$
解得
$$
\alpha_m=\frac12\ln\frac{1-\varepsilon}{\varepsilon}.
$$
由 $\varepsilon_m$ 的定义可知选择 $h_m$ 等价于最小化加权误差 $\varepsilon_m$:
$$
h_m=\arg\min\limits_{h}\varepsilon_m(h).
$$
最常见的方法是用决策桩: 遍历特征和切分点, 计算加权分类误差, 选误差最小的划分作为 $h_m$.

### 2.3 训练误差上界

令
$$
Z_m:=\frac{\sum_i w_i^{(m)}\exp(-\alpha_my_ih_m(x_i))}{\sum_iw_i^{(m)}},
$$
不难看出
$$
Z_m = \varepsilon_me^{\alpha_m}+(1-\varepsilon_m)e^{-\alpha_m}.
$$
代入 $\alpha_m$ 的最优值, 得
$$
Z_m=\varepsilon_m\sqrt{\frac{1-\varepsilon_m}{\varepsilon_m}}+(1-\varepsilon_m)\sqrt{\frac{\varepsilon_m}{1-\varepsilon_m}}=2\sqrt{\varepsilon_m(1-\varepsilon_m)}:=\sqrt{1-\gamma_m^2},
$$
其中 $\gamma_m=1-2\varepsilon_m$.

注意到 $1\lbrace y_i\neq\hat y_i\rbrace\le \exp(-y_i F_M(x_i))$, 可得训练误差的上界:
$$
\begin{aligned}
\frac{1}{n}\sum_{i=1}^n1\lbrace y_i\neq\hat y_i\rbrace&\le\frac1n\sum_{i=1}^n\exp(-y_i F_M(x_i))\\\\
&=\frac1n\sum_{i=1}^n\exp\left(-y_i \sum_{m=1}^M\alpha_mh_m(x_i)\right)\\\\
&=\frac1n\sum_{i=1}^n\prod_{m=1}^M\exp(-y_i\alpha_mh_m(x_i))
\end{aligned}
$$

注意到
$$
w_i^{(m)}=\exp\left(-y_iF_{m-1}(x_i)\right)=\exp\left(-y_i(F_{m-2}(x_i)+\alpha_{m-1}h_{m-1}(x_i))\right)=w_i^{(m-1)}\exp(\alpha_{m-1}y_ih_{m-1}(x_i))
$$

而 $w_i^{(1)}=1$, 故
$$
\prod_{m=1}^M\exp(-y_i\alpha_mh_m(x_i))=w_i^{(M+1)}.
$$

因此
$$
\frac{1}{n}\sum_{i=1}^n1\lbrace y_i\neq\hat y_i\rbrace\le\frac1n\sum_{i=1}^nw_i^{(M+1)}=\frac1n\sum_{i=1}^nw_i^{(M)}\exp(\alpha_My_ih_M(x_i))=\frac1nZ_M\sum_{i=1}^nw_i^{(M)},
$$

继续向前递推可得
$$
\frac1n\sum_{i=1}^nw_i^{(M+1)}=\frac1nZ_M\sum_{i=1}^nw_i^{(M)}=\frac1nZ_MZ_{M-1}\sum_{i=1}^nw_i^{(M-1)}=\cdots=\prod_{m=1}^MZ_m.
$$
故
$$
\begin{aligned}
\frac{1}{n}\sum_{i=1}^n1\lbrace y_i\neq\hat y_i\rbrace\le\prod_{m=1}^MZ_m&=\prod_{m=1}^M\sqrt{1-\gamma_m^2}\\\\
&=\exp\left(\ln\prod_{m=1}^M\sqrt{1-\gamma_m^2}\right)\\\\
&=\exp\left(\frac12\sum_{m=1}^M\ln(1-\gamma_m^2)\right)\\\\
&\le\exp\left(-\frac12\sum_{m=1}^M\gamma_m^2\right).
\end{aligned}
$$
因此训练误差随 $M$ 呈指数下降.

### 2.4 Margin 理论

#### 2.4.1 Margin 定义

对于样本 $(x_i,y_i)$, AdaBoost 的加法模型为
$$
F_M(x)=\sum_{m=1}^M\alpha_mh_m(x).
$$
定义样本 $i$ 的间隔 (Margin) 为:
$$
\rho_i:=\frac{y_iF_M(x_i)}{\sum_{m=1}^M\vert\alpha_m\vert}.
$$

> 【性质】$\rho_i\in[-1,1]$.

**证:** 
$$
\begin{aligned}
\rho_i&=\frac{y_iF_M(x_i)}{\sum_{m=1}^M\vert\alpha_m\vert}=\frac{y_i\sum_{m=1}^M\alpha_mh_m(x_i)}{\sum_{m=1}^M\vert\alpha_m\vert}\\\\
&=\frac{\sum_{m=1}^M\alpha_my_ih_m(x_i)}{\sum_{m=1}^M\vert\alpha_m\vert}
\end{aligned}
$$
 注意到 $y_ih_m(x_i)\in\lbrace-1,+1\rbrace$, 故
$$
\sum_{m=1}^M-|\alpha_m|\le\sum_{m=1}^M\alpha_my_ih_m(x_i)\le\sum_{m=1}^M|\alpha_m|,
$$
因此 $\rho_i\in[-1,1]$.



显然当$\rho_i>0$ 时, 说明样本被正确分类; $\rho<0$ 时样本被错误分类. 并且, $|\rho_i|$ 越大表明分类越"自信".

事实上, Margin 就是把函数值 $F_M(x_i)$ 做了一个归一化 (防止系数 $\alpha_m$ 规模影响), 然后和真实标签 $y_i$ 相乘, 看它们方向是否一致.



#### 2.4.2 泛化误差

> [定理] (Schapire, Freund, Bartlett, & Lee, 1998) 当基分类器 $\mathcal H$ 有限时, 对于 $\forall \theta>0$, 以至少 $1-\delta$ 的概率成立 
> $$
> \underset{(x,y)\sim\mathcal D}{\mathrm{P}}\left(yF_M(x)\le0\right)\le\underset{i=1,\cdots,n}{\mathrm{P}}(\rho_i\le\theta)+O\left(\sqrt{\frac{\log n\cdot\log|\mathcal H|+\log(1/\delta)}{n\theta^2}}\right),
> $$

**证:** (1) 令 $A:=\sum_{m=1}^M\vert\alpha_m\vert$, 定义分布 $\alpha$ 为
$$
P(h=h_m)=\frac{\alpha_m}{A}.
$$
于是
$$
\frac1AF_M(x)=\sum_{m=1}^M\frac{\alpha_m}{A}h_m(x)=\mathbb E_{h\sim\alpha}[h(x)].
$$
构造辅助函数集
$$
\mathcal C_N:=\left\lbrace g(x)=\frac1N\sum_{j=1}^Nh_j(x)~:~h_j\in\mathcal H\right\rbrace.
$$
在分布 $\alpha$ 上独立采样 $N$ 次, 得到 $h_1,\cdots,h_N$, 定义 $g(x)=\frac1N\sum_{j=1}^Nh_j(x)$, 不难得到
$$
\mathbb E_{g\sim\mathcal Q}[g(x)]=\frac1AF_M(x):=f(x).
$$
(2) 对任意 $\theta>0$, 有
$$
\begin{aligned}
P_{\mathcal D}(yF_M(x)\le0)&=P_{\mathcal D}(yf(x)\le0)\\\\
&\le P_{\mathcal D}(yg(x)\le\theta/2)+P_{\mathcal D}(yg(x)>\theta/2,~yf(x)\le 0),
\end{aligned}
$$
注意到
$$
\begin{aligned}
P_{\mathcal D}(yg(x)\le\theta/2) &=\mathbb E[1_{P_{\mathcal D}(yg(x)\le\theta/2)}]=\mathbb E\left[\mathbb E[1_{P_{\mathcal D}(yg(x)\le\theta/2)}]\mid \mathcal g\right]\\\\
&=\mathbb E\left[P_{\mathcal D}(yg(x)\le\theta/2)\right],\\\\
\\\\
P_{\mathcal D}(yg(x)>\theta/2,~yf(x)\le 0)&\overset{同上}{=}\mathbb E\left[P_{\mathcal D}(yg(x)>\theta/2,~yf(x)\le 0)\right].
\end{aligned}
$$
于是
$$
\begin{aligned}
P_{\mathcal D}(yF_M(x)\le0)&=\mathbb E\left[P_{\mathcal D}(yg(x)\le\theta/2)\right]+\mathbb E\left[P_{\mathcal D}(yg(x)>\theta/2,~yf(x)\le 0)\right]\\\\
&\le\mathbb E\left[P_{\mathcal D}(yg(x)\le\theta/2)\right]+\mathbb E\left[P_{\mathcal D}(yg(x)>\theta/2\mid yf(x)\le 0)\right].
\end{aligned}
$$
(3) 利用 Chernoff 界可知
$$
P_{\mathcal g\sim\mathcal Q}(yg(x)>\theta/2\mid yf(x)\le 0)\le\exp(-N\theta^2/8).
$$
下面使用并合界控制第一项, 注意到 $g$ 可以取 $\mathcal C_N$ 中的任何函数, 有 $|\mathcal H|^N$ 种情况; 且 $yg(x)$ 只可能取 $\lbrace-1,-1+\frac2N,\cdots,1\rbrace$ 这 $N+1$ 个值, 因此总共有 $(N+1)|\mathcal H|^N$ 种情况. 设
$$
\delta'=\frac{\delta_N}{(N+1)|\mathcal H|^N},
$$
其中 $\delta_N$ 与 $N$ 有关, 待定. 那么如果每个事件 "失败" 的概率 $\le\delta'$, 则所有事件都成立的概率至少有 $1-\delta_N$. 由 Hoeffding 不等式可知在大小为 $n$ 的训练集 $S$ 上, 以至少 $1-\delta_N$ 的概率, 对所有 $g\in\mathcal C_N$ 和阈值 $\theta$ 成立
$$
P_{\mathcal D}(yg(x)\le\theta/2)\le P_{S}(yg(x)\le\theta/2)+\epsilon_N,
$$
其中,
$$
\epsilon_N=\sqrt{\frac{1}{2n}\ln\left(\frac{(N+1)|\mathcal H|^N}{\delta_N}\right)}.
$$
再由 Chernoff 界可知
$$
\begin{aligned}
P_{S}(yg(x)\le\theta/2)&=P_{S}(yg(x)\le\theta/2\mid yF_M(x)\le\theta)+P_{S}(yg(x)\le\theta/2\mid yF_M(x)>\theta)\\\\
&\le P_{S}(yF_M(x)\le\theta)+P_{S}(yg(x)\le\theta/2\mid yF_M(x)>\theta)\\\\
&\le P_{S}(yF_M(x)\le\theta)+\exp(-N\theta^2/8).
\end{aligned}
$$
(4 ) 综上, 我们有
$$
P_{\mathcal D}(yF_M(x)\le0)\le P_{S}(yF_M(x)\le\theta)+2\exp(-N\theta^2/8)+\sqrt{\frac{1}{2n}\ln\left(\frac{(N+1)|\mathcal H|^N}{\delta_N}\right)}.
$$
其中, 选取 $\delta_N=\frac{\delta}{N(N+1)}$. 则
$$
P_{\mathcal D}(yF_M(x)\le0)\le P_{S}(yF_M(x)\le\theta)+2\exp(-N\theta^2/8)+\sqrt{\frac{1}{2n}\ln\left(\frac{N(N+1)^2|\mathcal H|^N}{\delta}\right)}.
$$
取
$$
N=\frac1{\theta^2}\ln\left(\frac{n}{\ln|\mathcal H|}\right),
$$
就有
$$
P_{\mathcal D}\left(yF_M(x)\le0\right)\le\underset{i=1,\cdots,n}{{P}}(\rho_i\le\theta)+O\left(\sqrt{\frac{\log n\cdot\log|\mathcal H|+\log(1/\delta)}{n\theta^2}}\right).
$$
证毕.



### 2.5 算法

根据以上内容，整理 AdaBoost 算法如下：

【输入】训练集 $S=\lbrace(x_i,y_i)\rbrace_{i=1}^n$, 其中 $x_i\in\mathcal X\subset\mathbb R^k,~y_i\in\lbrace-1,+1\rbrace$. 弱学习算法 $h$.

【输出】分类器 $H(x)$

- 初始化训练数据的权值分布

$$
D_1=(w_{1}^{(1)},w_{2}^{(1)},\cdots,w_{n}^{(1)}),~w_{i}^{(1)}=\frac1n,~i=1,2,\cdots,n
$$

- 对 $m=1,2,\cdots,M$

  - 使用具有权值分布 $D_m$ 的训练数据学习, 得到基本分类器
    $$
    h_m(x):~\mathcal X \to \lbrace-1,+1\rbrace.
    $$

  - 计算加权误差
    $$
    \varepsilon_m=\frac{\sum_{i:~h(x_i)\neq y_i}w_i^{(m)}}{\sum_iw_i^{(m)}}.
    $$

  - 计算 $h_m(x)$ 的系数 $\alpha_m$
    $$
    \alpha_m=\frac12\ln\frac{1-\varepsilon_m}{\varepsilon_m}.
    $$

  - 更新权值分布
    $$
    D_{m+1}=\left(w_1^{(m+1)},w_2^{(m+1)},\cdots,w_n^{(m+1)}\right),\\\\
    w_i^{(m+1)}=\exp\left(-y_iF_{m}(x_i)\right)=\exp\left(-y_i(F_{m-1}(x_i)+\alpha_mh_m(x_i))\right)=w_i^{(m)}\exp\left(-\alpha_my_ih_m(x_i)\right).
    $$

  - 构造基本分类器的线性组合
    $$
    F_M(x)=\sum_{m=1}^M\alpha_mh_m(x)
    $$
    得到最终分类器:
    $$
    H(x)=\text{sign}(F_M(x))=\text{sign}\left(\sum_{m=1}^M\alpha_mh_m(x)\right).
    $$



## 参考

[1] 李航, 机器学习方法

[2] Schapire, R. E., Freund, Y., Bartlett, P., & Lee, W. S. (1998). Boosting the margin: A new explanation for the effectiveness of voting methods. *The Annals of Statistics, 26*(5), 1651–1686. https://doi.org/10.1214/aos/1024691352


