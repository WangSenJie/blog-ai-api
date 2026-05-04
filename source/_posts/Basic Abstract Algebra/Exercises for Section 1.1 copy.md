---
title: Exercises for Section 1.1 copy
published: false
---

1. Let $A,B$ and $C$ be sets. Show that
   - $(A\cap B)\text{\\} B=\empty$.
     **Proof:** Let $x\in(A\cap B)\text{\\} B$, that means $x\in A\cap B$ and $x\not\in B$. Thus, we have $x\in B$ and $x\not\in B$. Therefore  $(A\cap B)\text{\\} B$ must be the $\empty$.  #
   - $(A\cup B)\text{\\}B=A\text{\\}B$.
     **Proof:** On the one hand, let $x\in (A\cup B)\text{\\} B$, that means $x\in A\cup B$ and $x\not\in B$. This implies that $x\in A$ and $x\not\in B$, Thus, $x\in A\text{\\}B$, therefore $(A\cup B)\text{\\} B\subseteq A\text{\\}B$. On the other hand, let $x\in A\text{\\}B$, we have $x\in A$ and $x\not\in B$. Since $x\in A$, it is also in $A\cup B$. Thus, $x\in A\cup B$ and $x\not\in B$. That is $x\in (A\cup B)\text{\\}B$. Therefore $A\text{\\}B\subseteq (A\cup B)\text{\\}B$. In a Word, $(A\cup B)\text{\\}B=A\text{\\}B$.  #
   - $(B\cup C)\text{\\}A=(B\text{\\}A)\cup(C\text{\\}A)$.
     **Proof:** On the one hand, let $x\in (B\cup C)\text{\\} A$, that means $x\in B\cup C$ and $x\not\in A$. This implies that $x\in B$ or $x\in C$ and $x\not\in A$, i.e., $x\in(B\text{\\}A)$ or $x\in (C\text{\\}A)$. Thus, we have $x\in(B\text{\\}A)\cup(C\text{\\}A)$, Therefore $(B\cup C)\text{\\}A\subseteq(B\text{\\}A)\cup(C\text{\\}A)$. On the other hand, let $x\in(B\text{\\}A)\cup(C\text{\\}A)$, we have $x\in(B\text{\\}A)$ or $x\in (C\text{\\}A)$. That is $x\in B$ and $x\notin A$ or $x\in C$ and $x\notin A$. We have $x\in B\cup C$ and $x\notin A$, i.e. $x\in(B\cup C)\text{\\}A$. Therefore $(B\text{\\}A)\cup(C\text{\\}A)\subseteq(B\cup C)\text{\\}A$. In a Word, $(B\cup C)\text{\\}A=(B\text{\\}A)\cup(C\text{\\}A)$.  #
2. Let $A,B,C$ be sets. Prove that $A\text{\\}(B\text{\\}C)=(A\text{\\}B)\cup(A\cap C)$.
   **Proof:** Let $x\in A\text{\\}(B\text{\\}C)$, then $x\in A$ and $x\notin B\text{\\}C$. That means $x\in A$ and ($x\notin B$ or $x\in C$). Thus, $x\in (A\text{\\}B)\cup(A\cap C)$， therefore $A\text{\\}(B\text{\\}C)\subseteq(A\text{\\}B)\cup(A\cap C)$.
   On the other hand, let $x\in (A\text{\\}B)\cup(A\cap C)$, then we have $x\in A\text{\\}B$ or $x\in A\cap C$. That means $x\in A$ and $x\notin B$ or $x\in A$ and $x\in C$. Thus, $x\in A$ and ($x\notin B$ or $x\in C$), which means $x\in A\text{\\}(B\text{\\}C)$, therefore $(A\text{\\}B)\cup(A\cap C)\subseteq A\text{\\}(B\text{\\}C)$.
   In a word, $A\text{\\}(B\text{\\}C)=(A\text{\\}B)\cup(A\cap C)$.
3. Let $X,Y$ be finite sets. Prove that $|X\cup Y|+|X\cap Y|=|X|+|Y|$.
   **Proof:** Note that
   $$
   \begin{aligned}
   |X\cup Y|&=|[X\text{\\}(X\cap Y)]\cup[Y\text{\\}(X\cap Y)]\cup(X\cap Y)|\\
   &=|X\text{\\}(X\cap Y)|+|Y\text{\\}(X\cap Y)|+|X\cap Y|\\
   &=|X|-|X\cap Y|+|Y|-|X\cap Y|+|X\cap Y|\\
   &=|X|+|Y|-|X\cap Y|.
   \end{aligned}
   $$
   Therefore $|X\cup Y|+|X\cap Y|=|X|+|Y|$.	#
