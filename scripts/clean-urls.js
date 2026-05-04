'use strict';

const { resolveSlug, formatDatePrefix, sourceWithoutExt} = require('./slug-utils');

// const crypto = require('crypto');
// const path = require('path');

// function toAsciiSlug(value) {
//   return String(value || '')
//     .normalize('NFKD')
//     .replace(/[\u0300-\u036f]/g, '')
//     .replace(/[^\x00-\x7F]+/g, ' ')
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')
//     .replace(/^-+|-+$/g, '')
//     .replace(/-{2,}/g, '-');
// }

// function shortHash(value) {
//   return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 6);
// }

// function pad(number) {
//   return String(number).padStart(2, '0');
// }

// function formatDatePrefix(date) {
//   const d = date instanceof Date ? date : new Date(date);
//   return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('/');
// }

// function sourceWithoutExt(source) {
//   return String(source || '')
//     .replace(/^_posts[\\/]/, '')
//     .replace(/\.[^.]+$/, '')
//     .replace(/\\/g, '/');
// }

const assignedSlugs = new Set();
// const manualSlugByTitle = new Map([
//   ['LeetCode Hot100 —— Hash', 'hash'],
//   ['LeetCode Hot100 —— 二叉树', 'leetcode-hot100'],
//   ['LeetCode Hot100 —— 双指针', 'leetcode-hot100-2'],
//   ['LeetCode Hot100 —— 图论', 'leetcode-hot100-3'],
//   ['LeetCode Hot100 —— 二分查找', 'leetcode-hot100-4'],
//   ['LeetCode Hot100 —— 子串', 'leetcode-hot100-5'],
//   ['LeetCode Hot100 —— 普通数组', 'leetcode-hot100-6'],
//   ['LeetCode Hot100 —— 滑动窗口', 'leetcode-hot100-7'],
//   ['LeetCode Hot100 —— 矩阵', 'leetcode-hot100-8'],
//   ['LeetCode Hot100 —— 链表', 'leetcode-hot100-9'],
//   ['LeetCode Hot100 —— 堆', 'leetcode-hot100-10'],
//   ['LeetCode Hot100 —— 回溯', 'leetcode-hot100-11'],
//   ['LeetCode Hot100 —— 动态规划', 'post-20260422-47fa06'],
//   ['Transformer 架构 —— Attention Is All You Need', 'transformer-architecture']
// ]);

hexo.extend.filter.register('before_post_render', data => {
  // const sourcePath = sourceWithoutExt(data.source);
  // const manualSlug = manualSlugByTitle.get(data.title);
  // if (manualSlug) {
  //   assignedSlugs.add(manualSlug);
  //   data.slug = manualSlug;
  //   return data;
  // }

  // if (data.slug && /^[a-z0-9-]+$/i.test(data.slug)) {
  //   assignedSlugs.add(data.slug.toLowerCase());
  //   return data;
  // }

  // const basename = path.posix.basename(sourcePath);
  // const dirname = path.posix.dirname(sourcePath);

  // const candidates = [
  //   basename,
  //   data.title,
  //   dirname,
  //   sourcePath
  // ];

  // let slug = '';
  // for (const candidate of candidates) {
  //   slug = toAsciiSlug(candidate);
  //   if (slug) break;
  // }

  // if (!slug) {
  //   const datePrefix = formatDatePrefix(data.date).replace(/\//g, '');
  //   slug = `post-${datePrefix}-${shortHash(sourcePath)}`;
  // }

  // const baseSlug = slug;
  // let counter = 2;
  // while (assignedSlugs.has(slug)) {
  //   slug = `${baseSlug}-${counter}`;
  //   counter += 1;
  // }

  // assignedSlugs.add(slug);
  // data.slug = slug;
  // return data;
  const slug = resolveSlug(
    {
      title: data.title,
      slug: data.slug,
      date: data.date,
      source: data.source
    },
    assignedSlugs
   );

   data.slug = slug;
   return data;
    
  });

hexo.extend.generator.register('legacy-post-redirects', function(locals) {
  return locals.posts.toArray().map(post => {
    const legacySource = sourceWithoutExt(post.source);
    const legacyPath = `${formatDatePrefix(post.date)}/${legacySource}/index.html`;
    const target = post.permalink;

    return {
      path: legacyPath,
      data: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${target}">
  <link rel="canonical" href="${target}">
  <title>Redirecting...</title>
  <script>location.replace(${JSON.stringify(target)});</script>
</head>
<body>
  <p>Redirecting to <a href="${target}">${target}</a></p>
</body>
</html>`,
      layout: false
    };
  });
});
