---
title: Exercises for Section 3.1
published: false
---

1. Let $G$ be a finite group and $H<G$. If $[G:H]=2$, then $gH=Hg$ for any $\in G$.
   **Proof:** If $[G:H]=2$, then there are only two cosets of $H$ in $G$, and one of the cosets is $H$ itself, i.e., 
   $$
   G=H\cup g_0H=H\cup Hg_0,
   $$
   for some $g_0\in G$, where $H\cap g_0H=\varnothing,~H\cap Hg_0=\varnothing$. For any $g\in G$. If $g\in H$, it is obviously that $gH=H=Hg$. Else if $g\notin H$, then $gH\neq H,~Hg\neq H$. Since $[G:H]=2$, we have $G=H\cup gH=H\cup Hg$ and $H\cap gH=\varnothing,~H\cap Hg=\varnothing$. Thus $gH=Hg$.  #

2. Suppose that $[G:H]=2$. If $a,b\notin H$, show that $ab\in H$.
   **Proof:** If $[G:H]=2$, then $G=H\cup gH$ and $H\cap gH=\varnothing$. If $a,b\notin H$, then $a,b\in gH$, i.e., $\exists h_1,h_2\in H$, such that $a=gh_1,~b=gh_2$. Then $ab=gh_1gh_2\in G$. Assume that $ab\notin H$, then $ab\in gH$, i.e., $\exists h_3\in H$, s.t. $ab=gh_3$, i,e, $gh_1gh_2=gh_3$, then $h_1gh_2=h_3\Rightarrow g=h_1^{-1}h_3h_2^{-1}\in H\Rightarrow gH=H$. Since $H\cap gH=\varnothing$, we have $H=gH=\varnothing=G$, it contradicts to the fact that $[G:H]=2$. Thus, $ab\in H$.  #

3. Let $H,K<G$ and $|H|=12,|K|=35$. What is $H\cap K$.
   **Solution:** Since $H\cap K<H$ and $H\cap K<K$, we have $|H\cap K|\mid |H|$ and $|H\cap K|\mid |K|$ by the Lagrange's Theorem. Note that $\gcd(12,35)=1$, so $|H\cap K|=1\Rightarrow H\cap K=\{\text{Identity}\}$.  #
