<script>
document.addEventListener('click', async event => {
  const button = event.target.closest('.post-share-btn');
  if (!button) return;

  const shareBox = button.closest('.post-share');
  if (!shareBox) return;

  const url = shareBox.dataset.shareUrl;
  const title = shareBox.dataset.shareTitle;
  const status = shareBox.querySelector('.post-share-status');
  const action = button.dataset.shareAction;

  const setStatus = message => {
    if (status) status.textContent = message;
  };

  if (action === 'copy') {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement('textarea');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setStatus('链接已复制');
    } catch (error) {
      setStatus('复制失败，请手动复制地址');
    }
    return;
  }

  if (action === 'native') {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        setStatus('已打开系统分享');
      } catch (error) {
        if (error && error.name !== 'AbortError') {
          setStatus('系统分享失败，请改用复制链接');
        }
      }
    } else {
      setStatus('当前浏览器不支持系统分享，请使用复制链接');
    }
  }
});
</script>
<div id="blog-ai-agent-root"></div>
<script>
window.__BLOG_AI_CONFIG__ = window.__BLOG_AI_CONFIG__ || {
  apiBaseUrl: 'https://blog-ai-api.vercel.app',
  dataBasePath: '/ai-data'
};
</script>
<script src="/js/blog-ai-agent.js"></script>
<script src="/js/category-explorer.js"></script>
