---
title: Exercises for Section 1.4
published: false
---

4. Let $X$ be a set and $R$ is a relation $X$. Define $xRy$ if $x|y$. Is $R$ an equivalence relation, partial ordering relation or totally ordering relation?
   **Solution:** 
   (1) equivalence?

   - **Reflexivity**:
     $x\mid x$ is true for any $x\in X$, so $R$ is reflexive.
   - **Symmetry**:
     If $x\mid y$, it does not necessarily imply $y \mid x$. For example, if  $x = 2$ and $y = 4$, $2 \mid 4$, but $4 \nmid 2$. Thus, $R$ is not symmetric.
   - **Transitivity**:
     If $x\mid y,~y\mid z\Rightarrow x\mid z$, so $R$ is transitive. 

   Since $R$ is not symmetric, it is not an equivalence relation.

   (2) partial ordering relation?

   - **Reflexivity**:

     As shown earlier, $R$ is reflexive.

   - **Antisymmetry**:
     If $x \mid y$ and $y \mid x$, then $x = y$ (since $x \mid y$ and $y \mid x$ imply $x$ and $y$ have the same absolute value). Thus, $R$ is antisymmetric.
   - **Transitivity**:
     As shown earlier, $R$ is transitive.

     Since $R$ satisfies reflexivity, antisymmetry, and transitivity, it is a partial ordering relation.

   (3) totally ordering relation?

   - For some $x, y \in X$, neither $x \mid y$ nor $y \mid x$ may hold. For example, if $x = 2$ and $y = 3$, $2 \nmid 3$ and $3 \nmid 2$. Thus, $R$ is not a total ordering relation.
