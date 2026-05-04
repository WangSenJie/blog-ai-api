---
title: Exercises for Section 1.2
published: false
---

3. Show that a map is invertible if and only if it is both injective and surjective.
   **Proof:** $(\Longrightarrow)$ Assume that a map
   $$
   \begin{aligned}
   f:X&\to Y\\
   x&\mapsto y
   \end{aligned}
   $$
   is invertible, then exists a map $f^{-1}:Y\to X$, such that
   $$
   f\circ f^{-1}=1_{Y},\quad f^{-1}\circ f=1_X.
   $$
   We need to show that $f$ is both injective and surjective.

   - Let $x_1,x_2\in X$ and $x_1\neq x_2$. Since $f^{-1}\circ f=1_X$, we have
     $$
     f^{-1}\circ f(x_1)=x_1\neq x_2=f^{-1}\circ f(x_2),
     $$
     i.e. $f^{-1}(f(x_1))\neq f^{-1}(f(x_2))$. Thus $f(x_1)\neq f(x_2)$, $f$ is injective.

   - Let $y \in Y$, note that
     $$
     y=f\circ f^{-1}(y)=f(f^{-1}(y)).
     $$
     There we find $x:=f^{-1}(y)\in X$, such that $f(x)=y$. Thus $f$ is surjective.  &#9632;

   $(\Longleftarrow)$ If $f$ is both injective and surjective i.e. $f$ is bijective, then $f$ has a unique two-sided inverse $f^{-1}$ from **Corollary 1.2.20**, i.e. $f$ is invertible.

5. Let $X$ be a set, $A$ be a subset of $X$. Is $f:P(X)\to P(X),~A\to A'$ a bijection? Why?
   **Solution:** Obviously, $f$ is a map since for each $A\in P(X)$, there exists a unique $A'$ corresponding to it through the correspondence rule. Therefore, we only need to check if $f$ is both injective and surjective.

   - Let $A, B\in P(X)$ and $A\neq B$. Since $A\neq B$, there must $\exists ~x\in A$ and $x\notin B$ or $\exists ~y\in B$ and $y\notin A$. Without loss of generality, suppose that $\exists ~x\in A$ and $x\notin B$, i.e. $x\in A\text{\\}B$. Note that $A\text{\\}B\subseteq X\text{\\}B=B'$, so $x\in B'$. And it is also evident that $x\notin A'$ since $x\in A$. Thus $A'\neq B'$, i.e. $f$ is injective.
   - Let $A\in P(X)$, we have $A'=X\text{\\}A\in P(X)$ and $f(A')=(A')'=A$. Thus $f$ is surjective.

   In summary, $f$ is bijective.

**Reference**: 王艳华 《抽象代数基础》- Section 1.2
