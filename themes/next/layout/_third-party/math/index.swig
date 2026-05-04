{%- if theme.math.mathjax.enable or theme.math.katex.enable %}
  {%- set list_has_math = false %}

  {%- if theme.math.per_page and page.posts %}
    {%- for post in page.posts.toArray() %}
      {%- if post.mathjax and not list_has_math %}
        {%- set list_has_math = true %}
      {%- endif %}
    {%- endfor %}
  {%- endif %}

  {%- if not theme.math.per_page or page.mathjax or list_has_math %}
    {%- if theme.math.mathjax.enable %}
      {% include '_third-party/math/mathjax.swig' %}
    {% elif theme.math.katex.enable %}
      {% include '_third-party/math/katex.swig' %}
    {%- endif %}
  {%- endif %}
{%- endif %}
