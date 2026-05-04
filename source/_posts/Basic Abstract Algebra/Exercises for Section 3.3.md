---
title: Exercises for Section 3.3
published: false
---

1. Find out all possible homomorphism from $\mathbb Z_7\to\mathbb Z_{12}$.
   **Solution:** Let $\varphi$ be such a homomorphism. Since $\mathbb Z_7$ is a cyclic group, so $\varphi$ is specified by $\varphi(\bar1)$. Since $o(\bar 1)=7$, we have $o(\varphi(\bar 1))\mid 7$. And $o(\varphi(\bar1))\mid 12$ by Lagrange's Theorem. Thus, $o(\varphi(\bar 1))\mid\gcd(7,12)=1$, i.e., $o(\varphi(\bar 1))=1$, $\varphi(\bar1)=\bar0$. Therefore, $\varphi(\bar x)=\bar0$.  #
   
2. Let $A$ be $m\times n$ matrix. Show that map
   $$
   \begin{aligned}
   \varphi:~\mathbb R^n&\to\mathbb R^m\\
   a&\mapsto Aa
   \end{aligned}
   $$
   is a homomorphism.
   **Proof:** Clearly, the map is well defined since for any $a\in\mathbb R^n$, $\exists! Aa\in\mathbb R^m$, s.t. $\varphi(a)=Aa$. Note that
   $$
   \varphi(a+b)=A(a+b)=Aa+Ab=\varphi(a)+\varphi(b).
   $$
   Thus, $\varphi$ is a homomorphism.  #
