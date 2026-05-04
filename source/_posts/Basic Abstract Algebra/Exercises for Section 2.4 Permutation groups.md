---
title: Exercises for Section 2.4 Permutation groups
published: false
---

1. Compute the inverse of $(465312)$.
   **Solution:** Since $(465312)=(42)(41)(43)(45)(46)$, we have $(465312)^{-1}=(46)(45)(43)(41)(42)=(421356)$.  #

2. Let $G$ be a group and define a map $\lambda_g:G\to G$ by $\lambda_g(a)=ga$. Prove that $\lambda_g$ is a permutation of $G$.
   **Proof:** We just need to show that $\lambda_g$ is bijective.

   - $\lambda_g$ is injective.
     Suppose that $\lambda_g(a)=\lambda_g(b)$, then $ga=gb\Rightarrow g^{-1}ga=g^{-1}gb\Rightarrow a=b$. Thus $\lambda_g$ is injective.
   - $\lambda_g$ is surjective.
     For any $\alpha\in G$, then $g^{-1}\alpha\in G$ since $G$ is a group. Note that $\lambda_g(g^{-1}\alpha)=gg^{-1}\alpha=\alpha$. Thus $\lambda_g$ is surjective.

   Therefore, $\lambda_g$ is bijective.  #
