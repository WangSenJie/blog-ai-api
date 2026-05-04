---
title: Exercises for Section 2.2
published: false
---

1. Let $H$ be a subgroup of $G$, if $g\in G$, show tha
   $$
   gHg^{-1}=\{g^{-1}hg\mid h\in H\}
   $$
   is also a subgroup of $G$.
   **Proof:** Since $e~(\text{identity})\in gHg^{-1}\subseteq G$, $gHg^{-1}$ is nonempty. For any $g^{-1}h_1g,~g^{-1}h_2g\in gHg^{-1}$, note that
   $$
   (g^{-1}h_1g)(g^{-1}h_2g)^{-1}=g^{-1}h_1gg^{-1}h_2^{-1}g=g^{-1}h_1h_2^{-1}g,
   $$
   and $h_1h_2^{-1}\in H$ by $h_1,h_2\in H\le G$. It follows that $(g^{-1}h_1g)(g^{-1}h_2g)^{-1}\in gHg^{-1}$. Thus $gHg^{-1}\le G$.
   
2. Let $G$ be a group and $g\in G$. Show that the center of $G$: $\mathcal Z(G)=\{x\in G\mid gx=xg,~g\in G\}$ is a subgroup of $G$. And compute the center of $GL_n(\mathbb R),SL_n(\mathbb R)$.
   **Proof:** Clearly, the identity $e\in\mathcal  Z(G)$, i.e. $\mathcal Z(G)$ is not empty. For any $x_1,x_2\in\mathcal Z(G)$, we have $gx_1=x_1g,~gx_2=x_2g$. Then
   $$
   g(x_1x_2^{-1})=x_1gx_2^{-1}=x_1gx_2^{-1}g^{-1}g=x_1g(gx_2)^{-1}g=x_1g(x_2g)^{-1}g=x_1gg^{-1}x_2^{-1}g=(x_1x_2^{-1})g.
   $$
   So $x_1x_2^{-1}\in \mathcal Z(G)$. Thus $\mathcal Z(G)\le G$.

   (1) The center of $GL_n(\mathbb R):~\mathcal Z(GL_n(\mathbb R))=\{cE\mid c\in\mathbb R,E ~\text{is the identity matrix}\}$.

   - Let $P\in\mathcal Z(GL_n(\mathbb R))$, then for any $A\in GL_n(\mathbb R)$, we have $AP=PA$. Suppose that $A=\left(\begin{matrix} -1&0&\cdots&0\\0&1&\cdots&0\\\vdots&\vdots&&\vdots\\0&0&\cdots&1\end{matrix}\right)\in GL_n(\mathbb R)$, then by $AP=PA$, we obtain that the first row and the first column of $P$ are all $0$ except the main diagonal element. Similarly, let $A=(e_1,-e_2,\cdots,e_n),\cdots,(e_1,e_2,\cdots,-e_n)$, we can obtain that $P$ is a diagonal matrix.
   - Moreover, let $A$ be a permutation elementary matrix. By simple calculation, we can obtain $P=cE$, where $E$ is the identity matrix and $c\in\mathbb R$.

   (2) The center of $SL_n(\mathbb R):~\mathcal Z(SL_n(\mathbb R))=E$.

   - $|cE|=1\Rightarrow c=1$.

   
