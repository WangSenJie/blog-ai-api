---
title: Basic Abstract Algebra Exercises Notes
date: 2026-03-25 12:00:00
slug: basic-abstract-algebra-exercises-notes
description: Basic Abstract Algebra 习题笔记汇总，覆盖集合、映射、关系、同余、群、子群、正规子群、同态、商群与同构定理等基础内容。
categories:
  - 数学
  - 抽象代数
tags:
  - Abstract Algebra
mathjax: true
toc: true
---

这篇笔记把 `Basic Abstract Algebra` 目录下的习题解答集中整理到一篇文章中，方便统一查阅和后续维护。

说明：

- 原目录下的单篇 `.md` 已统一设为 `published: false`
- `Exercises for Section 1.1 copy.md` 是 `Section 1.1` 的重复副本，所以没有在这里重复收录

## Exercises for Section 1.1

1. Let $A,B$ and $C$ be sets. Show that
   - $(A\cap B)\setminus B=\varnothing$.
     
     **Proof:** Let $x\in(A\cap B)\setminus B$, that means $x\in A\cap B$ and $x\not\in B$. Thus, we have $x\in B$ and $x\not\in B$. Therefore  $(A\cap B)\setminus B$ must be the $\varnothing$.
   - $(A\cup B)\setminus B=A\setminus B$.
     
     **Proof:** On the one hand, let $x\in (A\cup B)\setminus B$, that means $x\in A\cup B$ and $x\not\in B$. This implies that $x\in A$ and $x\not\in B$, Thus, $x\in A\setminus B$, therefore $(A\cup B)\setminus B\subseteq A\setminus B$. On the other hand, let $x\in A\setminus B$, we have $x\in A$ and $x\not\in B$. Since $x\in A$, it is also in $A\cup B$. Thus, $x\in A\cup B$ and $x\not\in B$. That is $x\in (A\cup B)\setminus B$. Therefore $A\setminus B\subseteq (A\cup B)\setminus B$. In a Word, $(A\cup B)\setminus B=A\setminus B$.
   - $(B\cup C)\setminus A=(B\setminus A)\cup(C\setminus A)$.
     
     **Proof:** On the one hand, let $x\in (B\cup C)\setminus A$, that means $x\in B\cup C$ and $x\not\in A$. This implies that $x\in B$ or $x\in C$ and $x\not\in A$, i.e., $x\in(B\setminus A)$ or $x\in (C\setminus A)$. Thus, we have $x\in(B\setminus A)\cup(C\setminus A)$, Therefore $(B\cup C)\setminus A\subseteq(B\setminus A)\cup(C\setminus A)$. On the other hand, let $x\in(B\setminus A)\cup(C\setminus A)$, we have $x\in(B\setminus A)$ or $x\in (C\setminus A)$. That is $x\in B$ and $x\notin A$ or $x\in C$ and $x\notin A$. We have $x\in B\cup C$ and $x\notin A$, i.e. $x\in(B\cup C)\setminus A$. Therefore $(B\setminus A)\cup(C\setminus A)\subseteq(B\cup C)\setminus A$. In a Word, $(B\cup C)\setminus A=(B\setminus A)\cup(C\setminus A)$.
2. Let $A,B,C$ be sets. Prove that $A\setminus(B\setminus C)=(A\setminus B)\cup(A\cap C)$.
   
   **Proof:** Let $x\in A\setminus(B\setminus C)$, then $x\in A$ and $x\notin B\setminus C$. That means $x\in A$ and ($x\notin B$ or $x\in C$). Thus, $x\in (A\setminus B)\cup(A\cap C)$， therefore $A\setminus(B\setminus C)\subseteq(A\setminus B)\cup(A\cap C)$.
   On the other hand, let $x\in (A\setminus B)\cup(A\cap C)$, then we have $x\in A\setminus B$ or $x\in A\cap C$. That means $x\in A$ and $x\notin B$ or $x\in A$ and $x\in C$. Thus, $x\in A$ and ($x\notin B$ or $x\in C$), which means $x\in A\setminus(B\setminus C)$, therefore $(A\setminus B)\cup(A\cap C)\subseteq A\setminus(B\setminus C)$.
   In a word, $A\setminus(B\setminus C)=(A\setminus B)\cup(A\cap C)$.
3. Let $X,Y$ be finite sets. Prove that $|X\cup Y|+|X\cap Y|=|X|+|Y|$.
   
   **Proof:** Note that
   $$    \begin{aligned} |X\cup Y|&=|[X\setminus(X\cap Y)]\cup[Y\setminus(X\cap Y)]\cup(X\cap Y)|\\\\ &=|X\setminus(X\cap Y)|+|Y\setminus(X\cap Y)|+|X\cap Y|\\\\ &=|X|-|X\cap Y|+|Y|-|X\cap Y|+|X\cap Y|\\\\ &=|X|+|Y|-|X\cap Y|. \end{aligned} $$
   Therefore $|X\cup Y|+|X\cap Y|=|X|+|Y|$.

## Exercises for Section 1.2

3. Show that a map is invertible if and only if it is both injective and surjective.
   
   **Proof:** $(\Longrightarrow)$ Assume that a map
   $$    \begin{aligned} f:X&\to Y\\\\ x&\mapsto y \end{aligned} $$
   is invertible, then exists a map $f^{-1}:Y\to X$, such that
   $$    f\circ f^{-1}=1_{Y},\quad f^{-1}\circ f=1_X. $$
   We need to show that $f$ is both injective and surjective.

   - Let $x_1,x_2\in X$ and $x_1\neq x_2$. Since $f^{-1}\circ f=1_X$, we have
     $$      f^{-1}\circ f(x_1)=x_1\neq x_2=f^{-1}\circ f(x_2), $$
     i.e. $f^{-1}(f(x_1))\neq f^{-1}(f(x_2))$. Thus $f(x_1)\neq f(x_2)$, $f$ is injective.

   - Let $y \in Y$, note that
     $$      y=f\circ f^{-1}(y)=f(f^{-1}(y)). $$
     There we find $x:=f^{-1}(y)\in X$, such that $f(x)=y$. Thus $f$ is surjective.  &#9632;

   $(\Longleftarrow)$ If $f$ is both injective and surjective i.e. $f$ is bijective, then $f$ has a unique two-sided inverse $f^{-1}$ from **Corollary 1.2.20**, i.e. $f$ is invertible.

5. Let $X$ be a set, $A$ be a subset of $X$. Is $f:P(X)\to P(X),~A\to A'$ a bijection? Why?
   
   **Solution:** Obviously, $f$ is a map since for each $A\in P(X)$, there exists a unique $A'$ corresponding to it through the correspondence rule. Therefore, we only need to check if $f$ is both injective and surjective.

   - Let $A, B\in P(X)$ and $A\neq B$. Since $A\neq B$, there must $\exists ~x\in A$ and $x\notin B$ or $\exists ~y\in B$ and $y\notin A$. Without loss of generality, suppose that $\exists ~x\in A$ and $x\notin B$, i.e. $x\in A\setminus B$. Note that $A\setminus B\subseteq X\setminus B=B'$, so $x\in B'$. And it is also evident that $x\notin A'$ since $x\in A$. Thus $A'\neq B'$, i.e. $f$ is injective.
   - Let $A\in P(X)$, we have $A'=X\setminus A\in P(X)$ and $f(A')=(A')'=A$. Thus $f$ is surjective.

   In summary, $f$ is bijective.

**Reference**: 王艳华 《抽象代数基础》- Section 1.2

## Exercises for Section 1.3

2. Define a relation $R$ on $\mathbb R^2$ by stating that $(a,b)\sim(c,d)$ if and only if $a^2+b^2\le c^2+d^2$. Show that $\sim$ is reflexive and transitive, but itis not symmetric.
   
   **Solution:** (1) Obviously, $(a,b)\sim(a,b)$, so $\sim$ is reflexive.
   (2) If $(a,b)\sim(c,d),~(c,d)\sim(e,f)$, then we have $a^2+b^2\le c^2+d^2,~c^2+d^2\le e^2+f^2$. So $a^2+b^2\le e^2+f^2$. Thus $(a,b)\sim(e,f)$, so $\sim$ is transitive.
   (3) Suppose $(a,b),~(c,d)\in \mathbb R^2$ and $a^2+b^2< c^2+d^2$. Thus $(a,b)\sim (c,d)$. Since $c^2+d^2>a^2+b^2$, $(c,d)\not\sim(a,b)$. Therefore, $\sim$ is not symmetric.

## Exercises for Section 1.4

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

## Exercises for Section 1.5

1. Let $a$ be a nonzero integer and $n\neq 0$ be a natural number. Then $\gcd(a,n)=1$ if and only if there exists a multiplication inverse $b$ such that $ab\equiv1 (\mod n)$.
   
   **Proof:** $(\Longrightarrow)$ Let $\gcd(a,b)=1$, then $\exists r,s\in \mathbb Z,~s.t.~ar+ns=1\Rightarrow ar=n(-s)+1$. Let $b=r$, then $ab=n(-s)+1\equiv 1(\mod n)$.
   $(\Longleftarrow)$ Suppose $\exists b\in\mathbb Z,~s.t.~ab\equiv1(\mod n)$. Then there exists $p\in\mathbb Z$, such that $ab=np+1$. Thus $ab+n(-p)=1$, that is $\gcd(a,n)=1$.
   
2. $a=165,~b=234$. Calculate $\gcd(a,b)$ and find integers $r$ and $s$ such that $\gcd(a,b)=ar+bs$.
   
   **Solution:** Using the Euclidean algorithm:
   $$    \begin{cases} 234=165\times1+69,\\\\ 165=69\times2+27,\\\\ 69=27\times2+15,\\\\ 27=15\times1+12,\\\\ 15=12\times1+3,\\\\ 12=3\times4+0 \end{cases} \Rightarrow \gcd(a,b)=3 $$
   Note that
   $$    \begin{aligned} 3&=15-12=15-(27-15)=-27+2\times15\\\\ &=-27+2\times(69-2\times27)=2\times69+(-5)\times27\\\\ &=2\times69+(-5)\times(165-2\times69)=(-5)\times165+12\times69\\\\ &=(-5)\times165+12\times(234-165)=(-17)\times165+12\times234. \end{aligned} $$

3. Show that $\text{lcm}(a,b)=ab\Longleftrightarrow \gcd(a,b)=1$.
   
   **Proof:** $(\Longrightarrow)$ Let $\text{lcm}(a,b)=ab$, we want to show that $\gcd(a,b)=1$. Suppose that $\gcd(a,b)=d>1$, then $\exists k,l\in\mathbb Z,~s.t.~ a=dk,~b=dl$. It shows that $dkl$ is a common multiple of $a$ and $b$, and $dkl<d^2kl=ab$. It is contradicts the fact that $\text{lcm}(a,b)=ab$.
   $(\Longleftarrow)$ Let $\gcd(a,b)=1$, we want to show that $\text{lcm}(a,b)=ab$. Since $\gcd(a,b)=1$, $\exists r,s\in\mathbb Z$, such that $1=ar+bs$. Suppose that $m$ is a common multiple of  $a$ and $b$, we want to show that $ab\mid m$. Since $m$ is a common multiple of  $a$ and $b$, we have $m=ap=bq,~ p,q\in\mathbb Z$. Note that
   $$    m=ap=ap\cdot1=ap(ar+bs)=(ap)(ar)+abps=(bq)(ar)+abps=ab(ps+qr), $$
   that is $ab\mid m$. Thus $\text{lcm}(a,b)=ab$.

4. If $d=\gcd(a,b)$ and $m=\text{lcm}(a,b)$. Prove that $dm=|ab|$.
   
   **Proof:** Without loss of generality, Let $a,b\in\mathbb Z_+$. Since $d=\gcd(a,b)$, $\exists r,s\in\mathbb Z$, such that $d=ar+bs$. Since $m=\text{lcm}(a,b)$, it follows that $\exists p,q\in\mathbb Z$, such that $m=ap=bq$. Therefore,
   $$    dm=(ar+bs)(ap)=(ar)(ap)+absp=(ar)(bq)+absp=ab(ps+qr). $$
   We want to show that $ps+qr=1$, i.e. $\gcd(p,q)=1$. Suppose that $\gcd(p,q)=d'>1$. Then $\exists k,l\in\mathbb Z$, such that $p=kd',q=ld'$. Therefore, $ap=bq\Longleftrightarrow ak=bl:=m'$ and $m'<m$. It contradicts that $m=\text{lcm}(a,b)$.

5. If $p$ and $q$ are distinct primes, the $\sqrt{pq}$ is not a rational number.
   
   **Proof:** Suppose that $\sqrt{pq}=\frac{n}{m}$, $m,n\in\mathbb N_+$ and $\gcd(m,n)=1$. Then $pq=\frac{n^2}{m^2}\Rightarrow n^2=pqm^2\Rightarrow p\mid n^2\Rightarrow p\mid n$. Write $n=pr,~r\in\mathbb Z$. Then $p^2r^2=pqm^2\Rightarrow pr^2=qm^2$. So $p\mid qm^2$. Since $p$ and $q$ are distinct primes, we have $\gcd(p,q)=1$. Thus $p\mid m^2\Rightarrow p\mid m$. Since $p\mid m,~p\mid n$ and $p>1$, it follows that $\gcd(m,n)\ge p>1$. $\to\leftarrow$.

## Exercises for Section 1.6

1. Find the smallest positive solution $x$ of the system of congruences
   $$    \begin{aligned} x&\equiv 4(\mod 3),\\\\ x&\equiv5(\mod 7),\\\\ x&\equiv6(\mod 11). \end{aligned} $$
   
   **Solution:** Using the Chinese Remainder Theorem. $m=3\times7\times11=231\Rightarrow \hat m_1=\frac{231}{3}=77,\hat m_1=\frac{231}{7}=33,\hat m_3=\frac{231}{11}=21$.

   - $77\equiv 2(\mod 3),~2\times 2\equiv1(\mod 3)\Rightarrow l_1=2$;
   - $33\equiv 5(\mod 7),~5\times3\equiv1(\mod7)\Rightarrow l_2=3$;
   - $21\equiv10(\mod 11),~10\times10\equiv1(\mod 11)\Rightarrow l_3=10$.

   Put $x=4\times77\times2+5\times33\times3+6\times21\times10(\mod231)=2371(\mod 231)=61(\mod 231)$. Thus the smallest positive solution $x=61$.

## Exercises for Section 2.1

1. Let $G$ be a finite group. Then the order of an element $g$ is the smallest number $n$ such that $g^n=e$. Show that the order of  $g\in G$ is finite group.
   
   **Proof:** Since $G$ is a finite group, then $|G|<\infty$. Let
   $$    S=\lbrace g^k\mid k\in\mathbb N\rbrace. $$
   We have $S\subseteq G$, so $S$ is finite. Thus there must exists $p,q\in\mathbb N,p<q$, such that $g^p=g^q\Rightarrow g^{q-p}=e$, where $e$ is the identity of $G$. Therefore, we have $n\le q-p$ by the definition of the order of an element $g$. Since $q-p$ is finite, the order of $g$ is finite.

2. Let $G$ be a group with order $|G|=n$. $S$ is a subset of $G$, with $|S|>\frac{n}{2}$. Show that for any $g\in G$, there exists $a,b\in S$ such that $g=ab$.
   
   **Proof:** For any $g\in G$, construct a map
   $$    \begin{aligned} \mathscr l:~~&G\to G\\\\ &h\mapsto h^{-1}g. \end{aligned} $$
   Note that for any $h_1,h_2\in G$, let $\mathscr l(h_1)=\mathscr l(h_2)$, we have
   $$    h_1^{-1}g=h_2^{-1}g\Rightarrow h_1^{-1}=h_2^{-1}\Rightarrow h_1=h_2. $$
   Thus $\mathscr l$ is injective. On the other hand, for any $\mathscr h\in G$, $\exists g\mathscr h^{-1}$, such that $\mathscr l(g\mathscr h^{-1})=(g\mathscr h^{-1})^{-1}g=\mathscr hg^{-1}g=\mathscr h$. So $\mathscr l$ is surjective. Therefore, $\mathscr l$ is bijective.

   Suppose that $\mathscr l(S)\cap S^{-1}=\varnothing$, then $|\mathscr l(S)\cup S^{-1}|=|\mathscr l(S)|+|S^{-1}|=2|S|$. However, $\mathscr l(S)\cup S^{-1}\subseteq G$, it follows that $2|S|=|\mathscr l(S)\cup S^{-1}|\le |G|=n\Rightarrow |S|\le \frac{n}{2}$. $\to\leftarrow$.

   Therefore, $\mathscr l(S)\cap S^{-1}\neq\varnothing$. Let $b\in\mathscr l(S)\cap S^{-1}$. Clearly, $b\in S$. Then exists $a\in S$, such that $\mathscr l(a)=b\Rightarrow a^{-1}g=b$, i.e. $g=ab$.

3. Let $a,b$ be two elements of a group $G$, and $aba=ba^2b,~a^3=1,~b^{2n-1}$. Then $b=1$.
   
   **Proof:** $aba=ba^2b\Rightarrow aba^3=ba^2ba^2\Rightarrow ab=ba^2ba^2\Rightarrow ab^2=ba^2ba^2b=ba^2aba=b^2a$. i.e. The element $a$ commutes with $b^2$. Thus
   $$    ab^{2n}=a \underbrace{b^2b^2\cdots b^2}\_{n\text{ 个}}=b^2a\underbrace{b^2\cdots b^2}\_{(n-1)\text{ 个}}=\cdots=\underbrace{b^2b^2\cdots b^2}\_{n\text{ 个}}a=b^{2n}a. $$
   Therefore, $ab=ab^{2n-1}b=b^{2n-1}ba=ba\Rightarrow ba^2b=aba=ba^2\Rightarrow(ba^2)^{-1}(ba^2)b=(ba^2)^{-1}(ba^2)=1$, i.e. $b=1$.

## Exercises for Section 2.2

1. Let $H$ be a subgroup of $G$, if $g\in G$, show tha
   $$    gHg^{-1}=\{g^{-1}hg\mid h\in H\} $$
   is also a subgroup of $G$.
   
   **Proof:** Since $e~(\text{identity})\in gHg^{-1}\subseteq G$, $gHg^{-1}$ is nonempty. For any $g^{-1}h_1g,~g^{-1}h_2g\in gHg^{-1}$, note that
   $$    (g^{-1}h_1g)(g^{-1}h_2g)^{-1}=g^{-1}h_1gg^{-1}h_2^{-1}g=g^{-1}h_1h_2^{-1}g, $$
   and $h_1h_2^{-1}\in H$ by $h_1,h_2\in H\le G$. It follows that $(g^{-1}h_1g)(g^{-1}h_2g)^{-1}\in gHg^{-1}$. Thus $gHg^{-1}\le G$.
   
2. Let $G$ be a group and $g\in G$. Show that the center of $G$: $\mathcal Z(G)=\{x\in G\mid gx=xg,~g\in G\}$ is a subgroup of $G$. And compute the center of $GL_n(\mathbb R),SL_n(\mathbb R)$.
   
   **Proof:** Clearly, the identity $e\in\mathcal  Z(G)$, i.e. $\mathcal Z(G)$ is not empty. For any $x_1,x_2\in\mathcal Z(G)$, we have $gx_1=x_1g,~gx_2=x_2g$. Then
   $$    g(x_1x_2^{-1})=x_1gx_2^{-1}=x_1gx_2^{-1}g^{-1}g=x_1g(gx_2)^{-1}g=x_1g(x_2g)^{-1}g=x_1gg^{-1}x_2^{-1}g=(x_1x_2^{-1})g. $$
   So $x_1x_2^{-1}\in \mathcal Z(G)$. Thus $\mathcal Z(G)\le G$.

   (1) The center of $GL_n(\mathbb R):~\mathcal Z(GL_n(\mathbb R))=\{cE\mid c\in\mathbb R,E ~\text{is the identity matrix}\}$.

   - Let $P\in\mathcal Z(GL_n(\mathbb R))$, then for any $A\in GL_n(\mathbb R)$, we have $AP=PA$. Suppose that $A=\left(\begin{matrix} -1&0&\cdots&0 \\\\ 0&1&\cdots&0 \\\\ \vdots&\vdots&&\vdots \\\\ 0&0&\cdots&1\end{matrix}\right)\in GL_n(\mathbb R)$, then by $AP=PA$, we obtain that the first row and the first column of $P$ are all $0$ except the main diagonal element. Similarly, let $A=(e_1,-e_2,\cdots,e_n),\cdots,(e_1,e_2,\cdots,-e_n)$, we can obtain that $P$ is a diagonal matrix.
   - Moreover, let $A$ be a permutation elementary matrix. By simple calculation, we can obtain $P=cE$, where $E$ is the identity matrix and $c\in\mathbb R$.

   (2) The center of $SL_n(\mathbb R):~\mathcal Z(SL_n(\mathbb R))=E$.

   - $|cE|=1\Rightarrow c=1$.

## Exercises for Section 2.3

1. Let $G$ be a group, $a,b\in G$, and $ab=ba,~|a|=m,~|b|=n,~\gcd(m,n)=1$. Show that $|ab|=mn$.
   
   **Proof:** Since $|a|=m,~|b|=n$, we have $a^m=b^n=e$, where $e$ is the identity of $G$. Because $\gcd(m,n)=1$, so $\text{lcm}(m,n)=mn$. For any $k\in\mathbb Z$, we have $(ab)^k=a^kb^k$ since $ab=ba$. Note that $(ab)^{mn}=a^{mn}b^{mn}=(a^m)^n(b^n)^m=e$, then $|ab|\mid mn$, it follows that $|ab|=mn$, or ($|ab|\mid m$ and $|ab|\not\mid n$) or ($|ab|\not\mid m$ and $|ab|\mid n$) since $\gcd(m,n)=1$. Suppose that $|ab|\mid m$ and $|ab|\not\mid n$, then $(ab)^m=a^mb^m=b^m=1\Rightarrow |b|\mid m\Rightarrow n\mid m~\to\leftarrow$. Similarly, $|ab|\not\mid m$ and $|ab|\mid n\Rightarrow ~\to\leftarrow$. Thus, $|ab|=mn$.
2. Show that the group with prime order is a cyclic group.
   
   **Proof:** Let $G$ be a group, $p$ be a prime, and $|G|=p$, which means $G$ has $p$ elements. Let $g\in G$ and $g\neq e$ (identity). Since $|G|=p$, then $|g|\mid p$. Therefore, $|g|=1$ or $p$. If $|g|=1$, then $g=e~\to\leftarrow$. Thus, $|G|=p$, and $\langle g\rangle=\{e,g,g^2,\cdots,g^{p-1}\}$ has $p$ elements. Because $G$ has also $p$ elements and $\langle g\rangle\le G$, we have $\langle g\rangle=G$, i.e. $G$ is a cyclic group.
3. Let $G$ be a group, $g$ in $G$, $|g|=mn$, and $\gcd(m,n)=1$, then $g=ab$ where $|a|=m$, $|b|=n$, and $a,b\in G$.
   
   **Proof:** Since $\gcd(m,n)=1$, then $\exists ~u,v\in\mathbb Z,~s.t.~um+vn=1$. Let $a = g^{vn},~b=g^{um}$, then

   $$    ab=g^{vn}\cdot g^{um}=g^{vn+um}=g^1=g $$

   We want to show that $|a|=m,~|b|=n$. Since $|g|=mn$, then $g^{mn}=e$ (identity). Thus, $a^m={g^{vn}}^m=g^{mn\cdot v}=e^v=e$, so $|a|\mid m$. Let $0<k< m$, if $a^k=a^{kvn}=e$, then $mn\mid kvn\Rightarrow m\mid kv\Rightarrow m\mid v$. Then $\exists~x\in\mathbb Z,~s.t. ~v=xm$ $\Rightarrow m(u+xn)=1\Rightarrow m=1$, then we can not find a $0<k<m$, such that $a^k=e$. So $|a|=m$. Similarly, $|b|=n$.
4. Let $a,b$ be elements of group $G$ such that $a^3=b^2=e,~(ab)^2=e,~a^2\neq e,~b\neq e$. What is $\langle a,b\rangle$.
   
   **Solution:** Since $a^3=b^2=e,~a^2\neq e,~b\neq e$, we have $|a|=3,~|b|=2$. Then

   $$    \langle a\rangle=\{e,a,a^2\},\quad \langle b\rangle=\{e,b\} $$

   If $ab=e$, then $ab\cdot b=b\Rightarrow a=b\Rightarrow a^2=b^2=e$, it is contradicts to the fact that $a^2\neq e$. Therefore, $ab\neq e$. Thus, $|ab|=2$ since $(ab)^2=e$. Clearly, $a\neq b$. And $aba=(ab)^2b^{-1}=b^{-1}=b,~bab=a^{-1}(ab)^2=a^{-1}=a^2$. Therefore, $\langle a,b\rangle=\{e,a,b,a^2,ab,ba,a^2b\}$.
5. Let $a,b$ be elements of a group $G$ such that $a^3=b^2=e,~ab=ba,~a^2\neq e,~b\neq e$. What is $\langle a,b\rangle$.
   
   **Solution:** $|a|=3,~|b|=2$. Since $ab=ba$, we have $\langle a,b\rangle=\{e,a,b,ab,a^2,a^2b\}$.
6. Let $G$ be a finite abellian group. Prove that the product of all the elements of $G$ equals the product of all the elements of $G$ of order $2$.
   
   **Proof:** Let $g\in G$, and $|g|\neq2$. If $|g|=1$, then $g=e$ (identity). Suppose that $|g|>2$. Since $G$ is a group, we can find $g^{-1}\in G,~s.t.~ gg^{-1}=g^{-1}g=e$. We want to show that $|g^{-1}|>2$. Suppose that $|g^{-1}|=2$, i.e. $(g^{-1})^2=e$. Therefore,
   $$    g^{-1}=g^{-1}\cdot e=g^{-1}\cdot(gg^{-1})=(g^{-1}g)g=g. $$
   It follows that $|g|=2,~\to\leftarrow$. Thus, $|g^{-1}|>2$. Which means that for any $g\in G$ and $|g|>2$, we can find a $g^{-1}\in G,$ s.t. $gg^{-1}=g^{-1}g=e$ and $|g^{-1}|>2$. Thus,
   $$    \prod_{g\in G}g=e\cdot\left(\prod_{g\in G,~|g|=2}g\right)\cdot\left(\prod_{g\in G,~|g|>2}g\right)=\left(\prod_{g\in G,~|g|=2}g\right)\cdot e=\left(\prod_{g\in G,~|g|=2}g\right). $$

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
   $$    \bar 1\times \bar 2\times\cdots\times \overline{p-1}=\bar 1\times\overline{p-1}, $$
   i.e.
   $$    (p-1)!\equiv p-1~(\mod p)\Rightarrow (p-1)!\equiv -1(\mod p). $$

## Exercises for Section 2.4 Permutation groups

1. Compute the inverse of $(465312)$.
   
   **Solution:** Since $(465312)=(42)(41)(43)(45)(46)$, we have $(465312)^{-1}=(46)(45)(43)(41)(42)=(421356)$.

2. Let $G$ be a group and define a map $\lambda_g:G\to G$ by $\lambda_g(a)=ga$. Prove that $\lambda_g$ is a permutation of $G$.
   
   **Proof:** We just need to show that $\lambda_g$ is bijective.

   - $\lambda_g$ is injective.
     Suppose that $\lambda_g(a)=\lambda_g(b)$, then $ga=gb\Rightarrow g^{-1}ga=g^{-1}gb\Rightarrow a=b$. Thus $\lambda_g$ is injective.
   - $\lambda_g$ is surjective.
     For any $\alpha\in G$, then $g^{-1}\alpha\in G$ since $G$ is a group. Note that $\lambda_g(g^{-1}\alpha)=gg^{-1}\alpha=\alpha$. Thus $\lambda_g$ is surjective.

   Therefore, $\lambda_g$ is bijective.

## Exercises for Section 2.5

1. Write down the dihedral group $D_5$.
   
   **Solution:** $D_5=\langle r,s\mid s^2=r^5=1,~srs=r^{-1}\rangle$, where $r=(12345),~s=(15)(24)$, i.e. $D_5=\{\text{id},s,r,r^2,r^3,r^4,rs,r^2s,r^3s,r^4s\}$. We have
   $$    \begin{aligned} &r^2=(13524),~r^3=(14253),~r^4=(15432),\\\\ &rs=(25)(34),~r^2s=(12)(35),\\\\ &r^3s=(13)(45),~r^4s=(14)(23). \end{aligned} $$
   Thus
   $$    D_5=\{(1),(12)(35),(12345),(13524),(14253),(15432),(25)(34),(12)(35),(13)(45),(14)(23)\}. $$

2. Prove that $D_n$ is a proper subgroup of $S_n$ for $n>3$.
   
   **Proof:** By Thm2.5.2, we have $D_n\subseteq S_n$ and $| D_n |=2n,~|S_n|=n!~(n\ge 3)$. If $D_n$ is a proper subgroup of $S_n$, then $n!>2n\Rightarrow (n-1)!>2\Rightarrow n>3$.
3. Show that $r^ks=sr^{-k}$.
   
   **Proof:** mathematical induction.

## Exercises for Section 3.1

1. Let $G$ be a finite group and $H<G$. If $[G:H]=2$, then $gH=Hg$ for any $\in G$.
   
   **Proof:** If $[G:H]=2$, then there are only two cosets of $H$ in $G$, and one of the cosets is $H$ itself, i.e., 
   $$    G=H\cup g_0H=H\cup Hg_0, $$
   for some $g_0\in G$, where $H\cap g_0H=\varnothing,~H\cap Hg_0=\varnothing$. For any $g\in G$. If $g\in H$, it is obviously that $gH=H=Hg$. Else if $g\notin H$, then $gH\neq H,~Hg\neq H$. Since $[G:H]=2$, we have $G=H\cup gH=H\cup Hg$ and $H\cap gH=\varnothing,~H\cap Hg=\varnothing$. Thus $gH=Hg$.

2. Suppose that $[G:H]=2$. If $a,b\notin H$, show that $ab\in H$.
   
   **Proof:** If $[G:H]=2$, then $G=H\cup gH$ and $H\cap gH=\varnothing$. If $a,b\notin H$, then $a,b\in gH$, i.e., $\exists h_1,h_2\in H$, such that $a=gh_1,~b=gh_2$. Then $ab=gh_1gh_2\in G$. Assume that $ab\notin H$, then $ab\in gH$, i.e., $\exists h_3\in H$, s.t. $ab=gh_3$, i,e, $gh_1gh_2=gh_3$, then $h_1gh_2=h_3\Rightarrow g=h_1^{-1}h_3h_2^{-1}\in H\Rightarrow gH=H$. Since $H\cap gH=\varnothing$, we have $H=gH=\varnothing=G$, it contradicts to the fact that $[G:H]=2$. Thus, $ab\in H$.

3. Let $H,K<G$ and $|H|=12,|K|=35$. What is $H\cap K$.
   
   **Solution:** Since $H\cap K<H$ and $H\cap K<K$, we have $|H\cap K|\mid |H|$ and $|H\cap K|\mid |K|$ by the Lagrange's Theorem. Note that $\gcd(12,35)=1$, so $|H\cap K|=1\Rightarrow H\cap K=\{\text{Identity}\}$.

## Exercises for Section 3.2

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
     - factor group: $A_4/A_4=\{A_4\}$.

## Exercises for Section 3.3

1. Find out all possible homomorphism from $\mathbb Z_7\to\mathbb Z_{12}$.
  
   **Solution:** Let $\varphi$ be such a homomorphism. Since $\mathbb Z_7$ is a cyclic group, so $\varphi$ is specified by $\varphi(\bar1)$. Since $o(\bar 1)=7$, we have $o(\varphi(\bar 1))\mid 7$. And $o(\varphi(\bar1))\mid 12$ by Lagrange's Theorem. Thus, $o(\varphi(\bar 1))\mid\gcd(7,12)=1$, i.e., $o(\varphi(\bar 1))=1$, $\varphi(\bar1)=\bar0$. Therefore, $\varphi(\bar x)=\bar0$.
   
2. Let $A$ be $m\times n$ matrix. Show that map
   $$    \begin{aligned} \varphi:~\mathbb R^n&\to\mathbb R^m\\\\ a&\mapsto Aa \end{aligned} $$
   is a homomorphism.
   
   **Proof:** Clearly, the map is well defined since for any $a\in\mathbb R^n$, $\exists! Aa\in\mathbb R^m$, s.t. $\varphi(a)=Aa$. Note that
   $$    \varphi(a+b)=A(a+b)=Aa+Ab=\varphi(a)+\varphi(b). $$
   Thus, $\varphi$ is a homomorphism.

## Exercises for Section 3.4

1. Prove or disprove $U(8)\cong \mathbb Z_4$.
   
   **Sol:** Since $\mathbb Z_4$ is a cyclic group and $U(8)$ is not a cyclic, we have $U(8)\not\cong \mathbb Z_4$.

2. Prove or disprove $S_4/A_4\cong \mathbb Z_2$.
   
   **Sol:** By the Lagrange's  Theorem, $|S_4/A_4|=[S_4:A_4]=\frac{|S_4|}{|A_4|}=2$. Suppose $S_4/A_4=\{e,a\}$ and $a^2=e$. Let $\varphi$ be a map
   $$    \begin{aligned} \varphi:~S_4/A_4&\to \mathbb Z_2\\\\ e&\mapsto\bar 0\\\\ a&\mapsto\bar 1 \end{aligned} $$
   Then
   $$    \begin{aligned} &\varphi(e\cdot e)=\varphi(e)=\bar0=\bar0+\bar0=\varphi(e)+\varphi(e)\\\\ &\varphi(e\cdot a)=\varphi(a)=\bar1=\bar0+\bar1=\varphi(e)+\varphi(a)\\\\ &\varphi(a\cdot e)=\varphi(a)=\bar1=\bar1+\bar0=\varphi(a)+\varphi(e)\\\\ &\varphi(a\cdot a)=\varphi(e)=\bar0=\bar1+\bar1=\varphi(a)+\varphi(a)\\\\ \end{aligned} $$
   Thus, $\varphi$ is an isomorphism, $S_4/A_4\cong \mathbb Z_2$.
   
<!-- 3. Prove $S_4\not\cong D_{12}$.
   
   **Pf:**  -->

## Exercises for Section 3.5 Fundamental Isomorphism theorem of group

1. Let $G=\{(a,b)\mid a,b\in\mathbb R,~a\neq0\}$ with $(a,b)(c,d)=(ac,ad+b)$ be a group, $K=\{(1,b)\mid b\in\mathbb R\}$. Show that $G/K\cong\mathbb R^{\star}$.
   
   **Proof:** Let
   $$    \begin{aligned} \varphi:\quad G&\to\mathbb R^{\star}\\\\ (a,b)&\to a^2 \end{aligned} $$
   be a map. For any $(a,b),~(c,d)\in G$, we have
   $$    \varphi((a,b)(c,d))=\varphi((ac,ad+b))=(ac)^2=a^2c^2=\varphi((a,b))\varphi((c,d)), $$
   thus $\varphi$ is a homomorphism. For any $y\in\mathbb R^{\star}$, there exist $(\sqrt y,c)\in G$, s.t. $\varphi((\sqrt{y},c))=y$. Thus, $\text{Im}\varphi=\mathbb R^{\star}$. By the First Isomorphism Theorem, we have $G/\ker\varphi\cong\text{Im}\varphi=\mathbb R^{\star}$.
   
2. Let $m\in\mathbb Z$ and $m>1$, $\begin{aligned}\varphi:\quad\mathbb Z &\to\mathbb Z_m \\\\ a &\mapsto\bar a\end{aligned}$. Prove that $\mathbb Z/\langle m\rangle\cong\mathbb Z_m$.
   
   **Proof:** For any $a,b\in\mathbb Z$, we have
   $$    \varphi(a+b)=\overline{a+b}=\bar a+\bar b=\varphi(a)+\varphi(b), $$
   so $\varphi$ is a homomorphism. Let $x\in\ker\varphi$, i.e., $\varphi(x)=\bar 0$, then $x=km\in\langle m\rangle,~k\in\mathbb Z\Rightarrow \ker\varphi\subseteq\langle m\rangle$. For any $x\in\langle m\rangle$, we have $x=km,~k\in\mathbb Z$, so $\varphi(x)=\overline{km}=\bar 0\Rightarrow \langle m\rangle\subseteq \ker\varphi$. Thus, $\ker\varphi=\langle m\rangle$. And $\text{Im}\varphi=\mathbb Z_m$. By the First Isomorphism Theorem, we have $\mathbb Z/\langle m\rangle\cong\mathbb Z_m$.
   
3. Let $H,K\triangleleft G$, show that $G/HK\cong(G/H)/(HK/H)$.
   
   **Proof:** For any $hk\in HK$, where $h\in H,~k\in K$. For any $g\in G$, we have $g(hk)g^{-1}=(ghg^{-1})(gkg^{-1})$. Since $H\triangleleft G$ and $K\triangleleft G$, we have $ghg^{-1}\in H$ and $gkg^{-1}\in K$, thus $g(hk)g^{-1}\in HK$. Therefore, $HK\triangleleft G$. Since $H\triangleleft G$ , $HK\triangleleft G$ and $H\subseteq HK$, by the Third Isomorphism Theorem of groups, we have
   $$    G/HK\cong(G/H)/(HK/H). $$
