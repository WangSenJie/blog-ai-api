---
title: Carathéodory扩张
date: 2025-09-02
description: Carathéodory扩张定理的证明
categories:
  - 数学
  - 测度论
tags:
  - 测度论
mathjax: true
---
**[T241107]** **(Carathéodory 扩张)** 设 $\mu$ 是代数 $\mathscr F_0$ 上的预测度, 则其外测度 $\mu^{\ast}$ 是 $\mu$ 的一个扩张, 称为 $\mu$ 的 Carathéodory 扩张. (即 $\mu^{\ast}$ 是 $(\Omega,\sigma(\mathscr F_0))$ 上的测度且在 $\mathscr F_0$ 上与 $\mu$ 一致)
**Proof:** 只需证明 $\mu^{\ast}$ 是 $\mathscr F=\mathscr \sigma(F_0)$ 上的测度且在 $\mathscr F_0$ 上与 $\mu$ 一致.
**(Step1.)** 先证明 $\mu^{\ast}$ 在 $\mathscr F_0$ 上与 $\mu$ 一致, 即证 $\forall A\in\mathscr F_0$, 满足 $\mu^{\ast}(A)=\mu(A)$. 注意到

$$
\mu^{\ast}(A) = \inf\Bigl\lbrace\sum_n\mu(A_n): A_n\in\mathscr{F}_0,~ \bigcup_n A_n\supset A \Bigr\rbrace.
$$

而 $A\cup\varnothing\cup\varnothing\cup\cdots\supset A$, 因此
$$
\mu^{\ast}(A)\le \mu(A)+\mu(\varnothing)+\mu(\varnothing)+\cdots=\mu(A).
$$
另一方面, 若 $\mu^{\ast}(A)<+\infty$, 则对 $\forall\varepsilon>0, ~\exists~A_n\in\mathscr F_0$, 使得 $\bigcup\limits_nA_n\supset A$, 且
$$
\sum_n\mu(A_n)<\mu^{\ast}(A)+\varepsilon.
$$
由 $\mu$ 的可列可加性和单调性知
$$
% \begin{aligned}
% \mu(A) &\le \mu\left(\bigcup_{n} A_n\right) \\
%        &= \mu\left(A_1 \cup (A_2\cap A_1^{c}) \cup (A_3\cap (A_1\cup A_2)^{c}) \cup \cdots \right) \\
%        &= \mu(A_1) + \mu(A_2\cap A_1^{c}) + \mu\bigl(A_3\cap (A_1\cup A_2)^{c}\bigr) + \cdots \\
%        &\le \sum_{n}\mu(A_n) < \mu^{\ast}(A) + \varepsilon .
% \end{aligned}
\begin{array}{rcl}
\mu(A) &\le& \mu\left(\bigcup_{n} A_n\right) \\\\
      &=& \mu\left(A_1 \cup (A_2\cap A_1^{c}) \cup (A_3\cap (A_1\cup A_2)^{c}) \cup \cdots \right) \\\\
      &=& \mu(A_1) + \mu(A_2\cap A_1^{c}) + \mu\bigl(A_3\cap (A_1\cup A_2)^{c}\bigr) + \cdots \\\\
      &\le& \sum_{n}\mu(A_n) < \mu^{\ast}(A) + \varepsilon .
\end{array}
$$
再由 $\varepsilon$ 的任意性可知 $\mu(A)\le\mu^{\ast}(A)$. 综上, $\mu(A)=\mu^{\ast}(A)$.
**(Step2.)** 再证明 $\mu^{\ast}$ 是 $\mathscr F=\mathscr \sigma(F_0)$ 上的测度, 只需证明 $\mathscr F=\sigma(\mathscr F_0)\subset\mathscr M$, 其中 $\mathscr M$ 是 $\mu^{\ast}$ 可测子集全体构成的 $\sigma$ 代数.

> 见“$(\Omega,\mathscr M,\mu^{\ast})$ 是完备测度空间”

对 $\forall A\in\mathscr F_0$, 要证明 $A\in\mathscr M$. 对 $\forall E\subset\Omega$, 不妨设 $\mu^{\ast}(E)<\infty$, 则对 $\forall \varepsilon>0$, 存在子集列 $\{A_n\}\subset\mathscr F_0$ 满足 $\cup_nA_n\supset E$ 且 $\sum\limits_n\mu(A_n)<\mu^{\ast}(E)+\varepsilon$, 因而
$$
\begin{aligned}
\mu^{\ast}(E\cap A)+\mu^{\ast}(E\cap A^c)&\le\mu^{\ast}\left(\bigcup_n(A_n\cap A)\right)+\mu^{\ast}\left(\bigcup_n(A_n\cap A^c)\right)\\\\
(\text{外测度的次可列可加性})~&\le\sum_n\left[\mu^{\ast}(A_n\cap A)+\mu^{\ast}(A_n\cap A^c)\right]\\\\
(\text{Step1.})~&=\sum_n\left[\mu(A_n\cap A)+\mu(A_n\cap A^c)\right]\\\\
(\text{预测度的可列可加性})~&=\sum_n\mu(A_n)\\\\
&<\mu^{\ast}(E)+\varepsilon
\end{aligned}
$$
由 $\varepsilon$ 的任意性可知 $\mu^{\ast}(E)\ge\mu^{\ast}(E\cap A)+\mu^{\ast}(E\cap A^c)$, 即 $A$ 满足 Carathéodory 条件, 从而 $A\in\mathscr M$. 由 $A$ 在 $\mathscr F_0$ 中的任意性可知 $\mathscr F_0\subset\mathscr M$, 从而 $\mathscr F=\sigma(\mathscr F_0)\subset\sigma(\mathscr M)=\mathscr M$, 故 $\mu^{\ast}$ 是 $\mathscr F=\sigma(\mathscr F_0)$ 上的测度.
综上,  $\mu^{\ast}$ 限制在 $\mathscr F$ 上是 $\mu$ 的一个扩张.	#