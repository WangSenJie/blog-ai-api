---
title: Exercises for Section 3.5 Fundamental Isomorphism theorem of group
published: false
---

1. Let $G=\{(a,b)\mid a,b\in\mathbb R,~a\neq0\}$ with $(a,b)(c,d)=(ac,ad+b)$ be a group, $K=\{(1,b)\mid b\in\mathbb R\}$. Show that $G/K\cong\mathbb R^*$.
   **Proof:** Let
   $$
   \begin{aligned}
   \varphi:\quad G&\to\mathbb R^*\\
   (a,b)&\to a^2
   \end{aligned}
   $$
   be a map. For any $(a,b),~(c,d)\in G$, we have
   $$
   \varphi((a,b)(c,d))=\varphi((ac,ad+b))=(ac)^2=a^2c^2=\varphi((a,b))\varphi((c,d)),
   $$
   thus $\varphi$ is a homomorphism. For any $y\in\mathbb R^*$, there exist $(\sqrt y,c)\in G$, s.t. $\varphi((\sqrt{y},c))=y$. Thus, $\text{Im}\varphi=\mathbb R^*$. By the First Isomorphism Theorem, we have $G/\ker\varphi\cong\text{Im}\varphi=\mathbb R^*$.  #
   
1. Let $m\in\mathbb Z$ and $m>1$, $\begin{aligned}\varphi:\quad\mathbb Z&\to\mathbb Z_m\\a&\mapsto\bar a\end{aligned}$. Prove that $\mathbb Z/\lang m\rang\cong\mathbb Z_m$.
   **Proof:** For any $a,b\in\mathbb Z$, we have
   $$
   \varphi(a+b)=\overline{a+b}=\bar a+\bar b=\varphi(a)+\varphi(b),
   $$
   so $\varphi$ is a homomorphism. Let $x\in\ker\varphi$, i.e., $\varphi(x)=\bar 0$, then $x=km\in\lang m\rang,~k\in\mathbb Z\Rightarrow \ker\varphi\subseteq\lang m\rang$. For any $x\in\lang m\rang$, we have $x=km,~k\in\mathbb Z$, so $\varphi(x)=\overline{km}=\bar 0\Rightarrow \lang m\rang\subseteq \ker\varphi$. Thus, $\ker\varphi=\lang m\rang$. And $\text{Im}\varphi=\mathbb Z_m$. By the First Isomorphism Theorem, we have $\mathbb Z/\lang m\rang\cong\mathbb Z_m$.  #
   
1. Let $H,K\triangleleft G$, show that $G/HK\cong(G/H)/(HK/H)$.
   **Proof:** For any $hk\in HK$, where $h\in H,~k\in K$. For any $g\in G$, we have $g(hk)g^{-1}=(ghg^{-1})(gkg^{-1})$. Since $H\triangleleft G$ and $K\triangleleft G$, we have $ghg^{-1}\in H$ and $gkg^{-1}\in K$, thus $g(hk)g^{-1}\in HK$. Therefore, $HK\triangleleft G$. Since $H\triangleleft G$ , $HK\triangleleft G$ and $H\subseteq HK$, by the Third Isomorphism Theorem of groups, we have
   $$
   G/HK\cong(G/H)/(HK/H).\quad\#
   $$
   
   
