{# Custom head is intentionally left minimal.
   MathJax is now loaded by NexT on demand via source/_data/next.yml. #}
{% set default_share_image = '/images/tx.jpg' %}
{% set share_image = page.cover or default_share_image %}
{% if share_image and not share_image.startsWith('http') %}
  {% set share_image = config.url + share_image %}
{% endif %}
{% set share_description = page.description or config.description %}

{% if share_image %}
  <meta property="og:image" content="{{ share_image }}">
  <meta name="twitter:image" content="{{ share_image }}">
  <meta name="twitter:card" content="summary_large_image">
{% endif %}
{% if share_description %}
  <meta name="twitter:description" content="{{ share_description }}">
{% endif %}
<meta name="twitter:title" content="{{ page.title or config.title }}">
