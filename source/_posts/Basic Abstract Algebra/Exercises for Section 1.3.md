---
title: Exercises for Section 1.3
published: false
---

2. Define a relation $R$ on $\mathbb R^2$ by stating that $(a,b)\sim(c,d)$ if and only if $a^2+b^2\le c^2+d^2$. Show that $\sim$ is reflexive and transitive, but itis not symmetric.
   **Solution:** (1) Obviously, $(a,b)\sim(a,b)$, so $\sim$ is reflexive.
   (2) If $(a,b)\sim(c,d),~(c,d)\sim(e,f)$, then we have $a^2+b^2\le c^2+d^2,~c^2+d^2\le e^2+f^2$. So $a^2+b^2\le e^2+f^2$. Thus $(a,b)\sim(e,f)$, so $\sim$ is transitive.
   (3) Suppose $(a,b),~(c,d)\in \mathbb R^2$ and $a^2+b^2< c^2+d^2$. Thus $(a,b)\sim (c,d)$. Since $c^2+d^2>a^2+b^2$, $(c,d)\not\sim(a,b)$. Therefore, $\sim$ is not symmetric.  #
