---
title: Exercises for Section 1.5
published: false
---


1. Let $a$ be a nonzero integer and $n\neq 0$ be a natural number. Then $\gcd(a,n)=1$ if and only if there exists a multiplication inverse $b$ such that $ab\equiv1 (\mod n)$.
   **Proof:** $(\Longrightarrow)$ Let $\gcd(a,b)=1$, then $\exists r,s\in \mathbb Z,~s.t.~ar+ns=1\Rightarrow ar=n(-s)+1$. Let $b=r$, then $ab=n(-s)+1\equiv 1(\mod n)$.
   $(\Longleftarrow)$ Suppose $\exists b\in\mathbb Z,~s.t.~ab\equiv1(\mod n)$. Then there exists $p\in\mathbb Z$, such that $ab=np+1$. Thus $ab+n(-p)=1$, that is $\gcd(a,n)=1$.  #
   
2. $a=165,~b=234$. Calculate $\gcd(a,b)$ and find integers $r$ and $s$ such that $\gcd(a,b)=ar+bs$.
   **Solution:** Using the Euclidean algorithm:
   $$
   \begin{cases}
   234=165\times1+69,\\
   165=69\times2+27,\\
   69=27\times2+15,\\
   27=15\times1+12,\\
   15=12\times1+3,\\
   12=3\times4+0
   \end{cases}
   \Rightarrow \gcd(a,b)=3
   $$
   Note that
   $$
   \begin{aligned}
   3&=15-12=15-(27-15)=-27+2\times15\\
   &=-27+2\times(69-2\times27)=2\times69+(-5)\times27\\
   &=2\times69+(-5)\times(165-2\times69)=(-5)\times165+12\times69\\
   &=(-5)\times165+12\times(234-165)=(-17)\times165+12\times234.	\quad\#
   \end{aligned}
   $$

3. Show that $\text{lcm}(a,b)=ab\Longleftrightarrow \gcd(a,b)=1$.
   **Proof:** $(\Longrightarrow)$ Let $\text{lcm}(a,b)=ab$, we want to show that $\gcd(a,b)=1$. Suppose that $\gcd(a,b)=d>1$, then $\exists k,l\in\mathbb Z,~s.t.~ a=dk,~b=dl$. It shows that $dkl$ is a common multiple of $a$ and $b$, and $dkl<d^2kl=ab$. It is contradicts the fact that $\text{lcm}(a,b)=ab$.
   $(\Longleftarrow)$ Let $\gcd(a,b)=1$, we want to show that $\text{lcm}(a,b)=ab$. Since $\gcd(a,b)=1$, $\exists r,s\in\mathbb Z$, such that $1=ar+bs$. Suppose that $m$ is a common multiple of  $a$ and $b$, we want to show that $ab\mid m$. Since $m$ is a common multiple of  $a$ and $b$, we have $m=ap=bq,~ p,q\in\mathbb Z$. Note that
   $$
   m=ap=ap\cdot1=ap(ar+bs)=(ap)(ar)+abps=(bq)(ar)+abps=ab(ps+qr),
   $$
   that is $ab\mid m$. Thus $\text{lcm}(a,b)=ab$.

4. If $d=\gcd(a,b)$ and $m=\text{lcm}(a,b)$. Prove that $dm=|ab|$.
   **Proof:** Without loss of generality, Let $a,b\in\mathbb Z_+$. Since $d=\gcd(a,b)$, $\exists r,s\in\mathbb Z$, such that $d=ar+bs$. Since $m=\text{lcm}(a,b)$, it follows that $\exists p,q\in\mathbb Z$, such that $m=ap=bq$. Therefore,
   $$
   dm=(ar+bs)(ap)=(ar)(ap)+absp=(ar)(bq)+absp=ab(ps+qr).
   $$
   We want to show that $ps+qr=1$, i.e. $\gcd(p,q)=1$. Suppose that $\gcd(p,q)=d'>1$. Then $\exists k,l\in\mathbb Z$, such that $p=kd',q=ld'$. Therefore, $ap=bq\Longleftrightarrow ak=bl:=m'$ and $m'<m$. It contradicts that $m=\text{lcm}(a,b)$.  #

5. If $p$ and $q$ are distinct primes, the $\sqrt{pq}$ is not a rational number.
   **Proof:** Suppose that $\sqrt{pq}=\frac{n}{m}$, $m,n\in\mathbb N_+$ and $\gcd(m,n)=1$. Then $pq=\frac{n^2}{m^2}\Rightarrow n^2=pqm^2\Rightarrow p\mid n^2\Rightarrow p\mid n$. Write $n=pr,~r\in\mathbb Z$. Then $p^2r^2=pqm^2\Rightarrow pr^2=qm^2$. So $p\mid qm^2$. Since $p$ and $q$ are distinct primes, we have $\gcd(p,q)=1$. Thus $p\mid m^2\Rightarrow p\mid m$. Since $p\mid m,~p\mid n$ and $p>1$, it follows that $\gcd(m,n)\ge p>1$. $\to\leftarrow$.   #

