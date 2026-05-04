---
title: Exercises for Section 1.6
published: false
---

1. Find the smallest positive solution $x$ of the system of congruences
   $$
   \begin{aligned}
   x&\equiv 4(\mod 3),\\
   x&\equiv5(\mod 7),\\
   x&\equiv6(\mod 11).
   \end{aligned}
   $$
   **Solution:** Using the Chinese Remainder Theorem. $m=3\times7\times11=231\Rightarrow \hat m_1=\frac{231}{3}=77,\hat m_1=\frac{231}{7}=33,\hat m_3=\frac{231}{11}=21$.

   - $77\equiv 2(\mod 3),~2\times 2\equiv1(\mod 3)\Rightarrow l_1=2$;
   - $33\equiv 5(\mod 7),~5\times3\equiv1(\mod7)\Rightarrow l_2=3$;
   - $21\equiv10(\mod 11),~10\times10\equiv1(\mod 11)\Rightarrow l_3=10$.

   Put $x=4\times77\times2+5\times33\times3+6\times21\times10(\mod231)=2371(\mod 231)=61(\mod 231)$. Thus the smallest positive solution $x=61$.  #
