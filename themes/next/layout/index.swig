{% extends '_layout.swig' %}
{% import '_macro/sidebar.swig' as sidebar_template with context %}

{% block title %}{{ title }}{%- if theme.index_with_subtitle and subtitle %} - {{ subtitle }}{%- endif %}{% endblock %}

{% block class %}index posts-expand{% endblock %}

{% block content %}

  <section class="home-hero" aria-labelledby="home-hero-title">
    <div class="home-hero__content">
      <p class="home-hero__kicker">Knowledge Base / AI Notes</p>
      <h2 id="home-hero-title" class="home-hero__title">DMH's Blog</h2>
      <p class="home-hero__summary">用数学推导、机器学习实验和编程实践，把零散知识整理成可以反复检索的笔记库。</p>

      <div class="home-hero__topics" aria-label="博客主题">
        <a href="{{ url_for('categories/数学/') }}">
          <span>Mathematics</span>
          <strong>数学体系</strong>
        </a>
        <a href="{{ url_for('categories/机器学习与深度学习/') }}">
          <span>Machine Learning</span>
          <strong>机器学习</strong>
        </a>
        <a href="{{ url_for('categories/算法题/') }}">
          <span>Programming</span>
          <strong>算法与编程</strong>
        </a>
      </div>

      <div class="home-hero__actions">
        <a class="home-hero__action home-hero__action--primary" href="{{ url_for('archives/') }}">最新归档</a>
        <a class="home-hero__action" href="{{ url_for('categories/') }}">分类地图</a>
        <a class="home-hero__action popup-trigger" role="button">站内搜索</a>
      </div>
    </div>
    <div class="home-hero__visual" aria-hidden="true">
      <span class="home-hero__matrix"></span>
      <span class="home-hero__beam"></span>
      <span class="home-hero__scanline"></span>
    </div>
  </section>

  <div class="home-section-label">
    <span>Latest Notes</span>
    <strong>最新笔记</strong>
  </div>

  {%- for post in page.posts.toArray() %}
    {{ partial('_macro/post.swig', {post: post, is_index: true}) }}
  {%- endfor %}

  {% include '_partials/pagination.swig' %}

{% endblock %}

{% block sidebar %}
  {{ sidebar_template.render(false) }}
{% endblock %}
