---
title: Exercises for Section 2.1
published: false
---

1. Let $G$ be a finite group. Then the order of an element $g$ is the smallest number $n$ such that $g^n=e$. Show that the order of  $g\in G$ is finite group.
   **Proof:** Since $G$ is a finite group, then $|G|<\infty$. Let
   $$
   S=\left\{g^k\mid k\in\mathbb N\right\}.
   $$
   We have $S\subseteq G$, so $S$ is finite. Thus there must exists $p,q\in\mathbb N,p<q$, such that $g^p=g^q\Rightarrow g^{q-p}=e$, where $e$ is the identity of $G$. Therefore, we have $n\le q-p$ by the definition of the order of an element $g$. Since $q-p$ is finite, the order of $g$ is finite.  #

2. Let $G$ be a group with order $|G|=n$. $S$ is a subset of $G$, with $|S|>\frac{n}{2}$. Show that for any $g\in G$, there exists $a,b\in S$ such that $g=ab$.
   **Proof:** For any $g\in G$, construct a map
   $$
   \begin{aligned}
   \mathscr l:~~&G\to G\\
   &h\mapsto h^{-1}g.
   \end{aligned}
   $$
   Note that for any $h_1,h_2\in G$, let $\mathscr l(h_1)=\mathscr l(h_2)$, we have
   $$
   h_1^{-1}g=h_2^{-1}g\Rightarrow h_1^{-1}=h_2^{-1}\Rightarrow h_1=h_2.
   $$
   Thus $\mathscr l$ is injective. On the other hand, for any $\mathscr h\in G$, $\exists g\mathscr h^{-1}$, such that $\mathscr l(g\mathscr h^{-1})=(g\mathscr h^{-1})^{-1}g=\mathscr hg^{-1}g=\mathscr h$. So $\mathscr l$ is surjective. Therefore, $\mathscr l$ is bijective.

   Suppose that $\mathscr l(S)\cap S^{-1}=\varnothing$, then $|\mathscr l(S)\cup S^{-1}|=|\mathscr l(S)|+|S^{-1}|=2|S|$. However, $\mathscr l(S)\cup S^{-1}\subseteq G$, it follows that $2|S|=|\mathscr l(S)\cup S^{-1}|\le |G|=n\Rightarrow |S|\le \frac{n}{2}$. $\to\leftarrow$.

   Therefore, $\mathscr l(S)\cap S^{-1}\neq\varnothing$. Let $b\in\mathscr l(S)\cap S^{-1}$. Clearly, $b\in S$. Then exists $a\in S$, such that $\mathscr l(a)=b\Rightarrow a^{-1}g=b$, i.e. $g=ab$.  #

3. Let $a,b$ be two elements of a group $G$, and $aba=ba^2b,~a^3=1,~b^{2n-1}$. Then $b=1$.
   **Proof:** $aba=ba^2b\Rightarrow aba^3=ba^2ba^2\Rightarrow ab=ba^2ba^2\Rightarrow ab^2=ba^2ba^2b=ba^2aba=b^2a$. i.e. The element $a$ commutes with $b^2$. Thus
   $$
   ab^{2n}=a \underbrace{b^2b^2\cdots b^2}_{n个}=b^2a\underbrace{b^2\cdots b^2}_{n-1个}=\cdots=\underbrace{b^2b^2\cdots b^2}_{n个}a=b^{2n}a.
   $$
   Therefore, $ab=ab^{2n-1}b=b^{2n-1}ba=ba\Rightarrow ba^2b=aba=ba^2\Rightarrow(ba^2)^{-1}(ba^2)b=(ba^2)^{-1}(ba^2)=1$, i.e. $b=1$.   #
