---
title: Exercises for Section 3.4
published: false
---

1. Prove or disprove $U(8)\cong \mathbb Z_4$.
   **Sol:** Since $\mathbb Z_4$ is a cyclic group and $U(8)$ is not a cyclic, we have $U(8)\not\cong \mathbb Z_4$.  #

2. Prove or disprove $S_4/A_4\cong \mathbb Z_2$.
   **Sol:** By the Lagrange's  Theorem, $|S_4/A_4|=[S_4:A_4]=\frac{|S_4|}{|A_4|}=2$. Suppose $S_4/A_4=\{e,a\}$ and $a^2=e$. Let $\varphi$ be a map
   $$
   \begin{aligned}
   \varphi:~S_4/A_4&\to \mathbb Z_2\\
   e&\mapsto\bar 0\\
   a&\mapsto\bar 1
   \end{aligned}
   $$
   Then
   $$
   \begin{aligned}
   &\varphi(e\cdot e)=\varphi(e)=\bar0=\bar0+\bar0=\varphi(e)+\varphi(e)\\
   &\varphi(e\cdot a)=\varphi(a)=\bar1=\bar0+\bar1=\varphi(e)+\varphi(a)\\
   &\varphi(a\cdot e)=\varphi(a)=\bar1=\bar1+\bar0=\varphi(a)+\varphi(e)\\
   &\varphi(a\cdot a)=\varphi(e)=\bar0=\bar1+\bar1=\varphi(a)+\varphi(a)\\
   \end{aligned}
   $$
   Thus, $\varphi$ is an isomorphism, $S_4/A_4\cong \mathbb Z_2$.  #
   
3. Prove $S_4\not\cong D_{12}$.
   **Pf:** 
