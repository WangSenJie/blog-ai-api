---
title: Exercises for Section 2.5
published: false
---

1. Write down the dihedral group $D_5$.
   **Solution:** $D_5=\lang r,s\mid s^2=r^5=1,~srs=r^{-1}\rang$, where $r=(12345),~s=(15)(24)$, i.e. $D_5=\{\text{id},s,r,r^2,r^3,r^4,rs,r^2s,r^3s,r^4s\}$. We have
   $$
   \begin{aligned}
   &r^2=(13524),~r^3=(14253),~r^4=(15432),\\
   &rs=(25)(34),~r^2s=(12)(35),\\
   &r^3s=(13)(45),~r^4s=(14)(23).
   \end{aligned}
   $$
   Thus
   $$
   D_5=\{(1),(12)(35),(12345),(13524),(14253),(15432),(25)(34),(12)(35),(13)(45),(14)(23)\}.  \quad \#
   $$

2. Prove that $D_n$ is a proper subgroup of $S_n$ for $n>3$.
   **Proof:** By Thm2.5.2, we have $D_n\subseteq S_n$ and $| D_n |=2n,~|S_n|=n!~(n\ge 3)$. If $D_n$ is a proper subgroup of $S_n$, then $n!>2n\Rightarrow (n-1)!>2\Rightarrow n>3$.  #
3. Show that $r^ks=sr^{-k}$.
   **Proof:** mathematical induction.  #
