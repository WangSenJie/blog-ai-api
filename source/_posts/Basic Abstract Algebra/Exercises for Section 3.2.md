---
title: Exercises for Section 3.2
published: false
---

1. If $H<G$ and $[G:H]=2$, show that $H\triangleleft G$.
   **Proof:** If $[G:H]=2$, then $gH=Hg$ for all $g\in G$, so $H\triangleleft G$. 
   
   > [【Basic Abstract Algebra】Exercises for Section 3.1 — Cosets and Lagrange's Theorem - 只会加减乘除 - 博客园 (cnblogs.com)](https://www.cnblogs.com/sufewsj/p/18622102)
   >  If $[G:H]=2$, then $gH=Hg$ for all $g\in G$.
   
2. Find out all normal subgroup of $A_4$, and give all factor groups of $A_4$ over its normal group.

   **Solution:** $A_4=\{(1),(123),(132),(124),(142),(134),(143),(234),(243),(12)(34),(13)(24),(14)(23)\}$, and $|A_4|=4!=24$. By the Lagrange's Theorem, the possible order of subgroup of $A_4$ are $1,2,3,4,6,12$.
   Find subgroups:

   - order $1$: $\{(1)\}$;
   - order $2$: $\{(1),(12)(34)\},~\{(1),(13)(24)\},~\{(1),(14)(23)\}$;
   - order $3$: $\{(1),(123),(132)\},~\{(1),(124),(142)\},~\{(1),(134),(143)\},~\{(1),(234),(243)\}$;
   - order $4$: $\{(1),(12)(34),(13)(24),(14)(23)\}$;
   - order $6$: Does not exist. Assume $H<A_4$ and $|H|=6$, then $[A_4:H]=2$. We will show that $(123)\in H$. Since $[A_4:H]=2$, we have $A_4=H\cup gH$ for some $g\in A_4$ and $H\triangleleft A_4$. If $(123)\notin H$, then $(132)=(123)^{-1}\notin H$ and $A_4=H\cup (123)H$ & $H\cap(123)H=\varnothing$. Then $\exists h\in H$, s.t. $(132)=(123)h\Rightarrow h=(123)$, it is contradict to $(123)\notin H$. Thus $(123)\in H$. Similarly, $(123),(132),(124),(142),(134),(143),(234),(243)\in H$, then $|H|\ge 9$, $\to\leftarrow$.
   - order $12$: $A_4$.

   Find normal subgroups:

   - order $1$: $\{(1)\}$;
     - factor group: $A_4/\{(1)\}\cong A_4$.
   - order $4$: $V_4=\{(1),(12)(34),(13)(24),(14)(23)\}$;
     - factor group: $A_4/V_4=\{V_4,(123)V_4,(132)V_4\}$.
   - order $12$: $A_4$.
     - factor group: $A_4/A_4=\{A_4\}$.  #
