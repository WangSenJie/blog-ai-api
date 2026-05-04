---
title: Exercises for Section 2.3
published: false
---

1. Let $G$ be a group, $a,b\in G$, and $ab=ba,~|a|=m,~|b|=n,~\gcd(m,n)=1$. Show that $|ab|=mn$.
   **Proof:** Since $|a|=m,~|b|=n$, we have $a^m=b^n=e$, where $e$ is the identity of $G$. Because $\gcd(m,n)=1$, so $\text{lcm}(m,n)=mn$. For any $k\in\mathbb Z$, we have $(ab)^k=a^kb^k$ since $ab=ba$. Note that $(ab)^{mn}=a^{mn}b^{mn}=(a^m)^n(b^n)^m=e$, then $|ab|\mid mn$, it follows that $|ab|=mn$, or ($|ab|\mid m$ and $|ab|\not\mid n$) or ($|ab|\not\mid m$ and $|ab|\mid n$) since $\gcd(m,n)=1$. Suppose that $|ab|\mid m$ and $|ab|\not\mid n$, then $(ab)^m=a^mb^m=b^m=1\Rightarrow |b|\mid m\Rightarrow n\mid m~\to\leftarrow$. Similarly, $|ab|\not\mid m$ and $|ab|\mid n\Rightarrow ~\to\leftarrow$. Thus, $|ab|=mn$.  #
2. Show that the group with prime order is a cyclic group.
   **Proof:** Let $G$ be a group, $p$ be a prime, and $|G|=p$, which means $G$ has $p$ elements. Let $g\in G$ and $g\neq e$ (identity). Since $|G|=p$, then $|g|\mid p$. Therefore, $|g|=1$ or $p$. If $|g|=1$, then $g=e~\to\leftarrow$. Thus, $|G|=p$, and $\langle g\rangle=\{e,g,g^2,\cdots,g^{p-1}\}$ has $p$ elements. Because $G$ has also $p$ elements and $\langle g\rang\le G$, we have $\lang g\rang=G$, i.e. $G$ is a cyclic group.  #
3. Let $G$ be a group, $g$ in $G$, $|g|=mn$, and $\gcd(m,n)=1$, then $g=ab$ where $|a|=m$, $|b|=n$, and $a,b\in G$.
   **Proof:** Since $\gcd(m,n)=1$, then $\exists ~u,v\in\mathbb Z,~s.t.~um+vn=1$. Let $a = g^{vn},~b=g^{um}$, then

   $$
   ab=g^{vn}\cdot g^{um}=g^{vn+um}=g^1=g
   $$

   We want to show that $|a|=m,~|b|=n$. Since $|g|=mn$, then $g^{mn}=e$ (identity). Thus, $a^m={g^{vn}}^m=g^{mn\cdot v}=e^v=e$, so $|a|\mid m$. Let $0<k< m$, if $a^k=a^{kvn}=e$, then $mn\mid kvn\Rightarrow m\mid kv\Rightarrow m\mid v$. Then $\exists~x\in\mathbb Z,~s.t. ~v=xm$ $\Rightarrow m(u+xn)=1\Rightarrow m=1$, then we can not find a $0<k<m$, such that $a^k=e$. So $|a|=m$. Similarly, $|b|=n$.  #
4. Let $a,b$ be elements of group $G$ such that $a^3=b^2=e,~(ab)^2=e,~a^2\neq e,~b\neq e$. What is $\lang a,b\rang$.
   **Solution:** Since $a^3=b^2=e,~a^2\neq e,~b\neq e$, we have $|a|=3,~|b|=2$. Then

   $$
   \lang a\rang=\{e,a,a^2\},\quad \lang b\rang=\{e,b\}
   $$

   If $ab=e$, then $ab\cdot b=b\Rightarrow a=b\Rightarrow a^2=b^2=e$, it is contradicts to the fact that $a^2\neq e$. Therefore, $ab\neq e$. Thus, $|ab|=2$ since $(ab)^2=e$. Clearly, $a\neq b$. And $aba=(ab)^2b^{-1}=b^{-1}=b,~bab=a^{-1}(ab)^2=a^{-1}=a^2$. Therefore, $\lang a,b\rang=\{e,a,b,a^2,ab,ba,a^2b\}$.
5. Let $a,b$ be elements of a group $G$ such that $a^3=b^2=e,~ab=ba,~a^2\neq e,~b\neq e$. What is $\lang a,b\rang$.
   **Solution:** $|a|=3,~|b|=2$. Since $ab=ba$, we have $\lang a,b\rang=\{e,a,b,ab,a^2,a^2b\}$.
6. Let $G$ be a finite abellian group. Prove that the product of all the elements of $G$ equals the product of all the elements of $G$ of order $2$.
   **Proof:** Let $g\in G$, and $|g|\neq2$. If $|g|=1$, then $g=e$ (identity). Suppose that $|g|>2$. Since $G$ is a group, we can find $g^{-1}\in G,~s.t.~ gg^{-1}=g^{-1}g=e$. We want to show that $|g^{-1}|>2$. Suppose that $|g^{-1}|=2$, i.e. $(g^{-1})^2=e$. Therefore,
   $$
   g^{-1}=g^{-1}\cdot e=g^{-1}\cdot(gg^{-1})=(g^{-1}g)g=g.
   $$
   It follows that $|g|=2,~\to\leftarrow$. Thus, $|g^{-1}|>2$. Which means that for any $g\in G$ and $|g|>2$, we can find a $g^{-1}\in G,$ s.t. $gg^{-1}=g^{-1}g=e$ and $|g^{-1}|>2$. Thus,
   $$
   \prod_{g\in G}g=e\cdot\left(\prod_{g\in G~\&~|g|=2}g\right)\cdot\left(\prod_{g\in G~\&~|g|>2}g\right)=\left(\prod_{g\in G~\&~|g|=2}g\right)\cdot e=\left(\prod_{g\in G~\&~|g|=2}g\right).
   $$

7. Use the conclusion of the previous question to show the Wilson's Theorem: If $p$ is a prime, then $(p-1)!=-1(\mod p)$.
   **Proof:** Consider the group $(\mathbb Z_p/\{\bar 0\},\times):=(G,\times)$, where $G$ consists of all nonzero integers modulo $p$, i.e., the set $\{ \bar 1, \bar 2, \cdots, \overline{p-1} \}$. We now show that $G$ is a abelian group.

   | $\times~(\mod p)$ |     $\bar 1$     |     $\bar2$      | $\cdots$ | $\overline{p-1}$ |
   | :---------------: | :--------------: | :--------------: | -------- | :--------------: |
   |     $\bar 1$      |     $\bar1$      |     $\bar2$      | $\cdots$ | $\overline{p-1}$ |
   |      $\bar2$      |     $\bar2$      |     $\bar4$      | $\cdots$ | $\overline{p-2}$ |
   |     $\vdots$      |     $\vdots$     |     $\vdots$     |          |     $\vdots$     |
   | $\overline{p-1}$  | $\overline{p-1}$ | $\overline{p-2}$ | $\cdots$ |     $\bar1$      |

   Clearly, for any $\bar a,\bar b\in G$, we have $\bar a\times \bar b \in G$.

   - For any $\bar a,\bar b,\bar c\in G$, since $(a\times b)\times c=a\times(b\times c)$, we have $(\bar a\times \bar b)\times \bar c= \bar a\times(\bar b\times \bar c)$.
   - The identity of $G$ is $\bar1$ since $\bar 1\times \bar a=\bar a\times \bar 1$ for any $\bar a\in G$.
   - By the Fermat Little Theorem, for any $\bar a\in G$, $\bar a^{p-1}=\bar 1$, hence $\bar a^{p-2}$ is the inverse of $\bar a$.

   Therefore, $G$ is a group. And $G$ is an abelian group since $\bar a\times \bar b=\bar b\times \bar a$ for any $\bar a,\bar b\in G$. For any $\bar x\in G$, let $\bar x^2=1$, then  there $\exists n\in\mathbb Z$, s.t. $x^2=np+1$. Note that $x\in\{1,2,\cdots,p-1\}$, then $0\le n\le p-2$. Let $n=p-k,~2\le k\le p$, then $np+1=p^2-kp+1$. $x^2=p^2-kp+1\Rightarrow k^2-4=0$ or $k=p$, i.e. $k=2$ or $k=p$. Thus $x=p-1$ or $x=1$. By the conclusion of the previous question, we have
   $$
   \bar 1\times \bar 2\times\cdots\times \overline{p-1}=\bar 1\times\overline{p-1},
   $$
   i.e.
   $$
   (p-1)!\equiv p-1~(\mod p)\Rightarrow (p-1)!\equiv -1(\mod p).\quad \#
   $$
