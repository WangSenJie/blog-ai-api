const crypto = require('crypto');
const path = require('path');

function toAsciiSlug(value) {
    return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function shortHash(value) {
    return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 6);
}

function pad(number) {
    return String(number).padStart(2, '0');
}

function formatDatePrefix(date) {
    if (typeof date === 'string') {
        const calendarDate = date.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (calendarDate) {
            return [calendarDate[1], pad(calendarDate[2]), pad(calendarDate[3])].join('/');
        }
    }

    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('/');
}

function sourceWithoutExt(source) {
    return String(source || '')
    .replace(/^_posts[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/\\/g, '/');
}

const manualSlugByTitle = new Map([
    ['Pandas数据分析题解汇总', 'pandas'],
    ['LeetCode Hot100 —— Hash', 'hash'],
    ['LeetCode Hot100 —— 二叉树', 'leetcode-hot100'],
    ['LeetCode Hot100 —— 双指针', 'leetcode-hot100-2'],
    ['LeetCode Hot100 —— 图论', 'leetcode-hot100-3'],
    ['LeetCode Hot100 —— 二分查找', 'leetcode-hot100-4'],
    ['LeetCode Hot100 —— 子串', 'leetcode-hot100-5'],
    ['LeetCode Hot100 —— 普通数组', 'leetcode-hot100-6'],
    ['LeetCode Hot100 —— 滑动窗口', 'leetcode-hot100-7'],
    ['LeetCode Hot100 —— 矩阵', 'leetcode-hot100-8'],
    ['LeetCode Hot100 —— 链表', 'leetcode-hot100-9'],
    ['LeetCode Hot100 —— 堆', 'leetcode-hot100-10'],
    ['LeetCode Hot100 —— 回溯', 'leetcode-hot100-11'],
    ['LeetCode Hot100 —— 动态规划', 'post-20260422-47fa06'],
    ['Transformer 架构 —— Attention Is All You Need', 'transformer-architecture']
]);

function resolveSlug(post, assignedSlugs) {
    const sourcePath = sourceWithoutExt(post.source);
    let slug = '';

    const manualSlug = manualSlugByTitle.get(post.title);
    if (manualSlug) {
        slug = manualSlug;
    }

    if (!slug && post.slug && /^[a-z0-9-]+$/i.test(post.slug)) {
        slug = post.slug.toLowerCase();
    }

    const basename = path.posix.basename(sourcePath);
    const dirname = path.posix.dirname(sourcePath);

    const candidates = [
        basename,
        post.title,
        dirname,
        sourcePath
    ];

    if (!slug) {
        for (const candidate of candidates) {
            const candidateSlug = toAsciiSlug(candidate);
            if (candidateSlug) {
                slug = candidateSlug;
                break;
            }
        }
    }

    // 改用日期+hash
    if (!slug) {
        const datePrefix = formatDatePrefix(post.date).replace(/\//g, '');
        slug = `post-${datePrefix}-${shortHash(sourcePath)}`;
    }

    const baseSlug = slug;
    let counter = 2;
    while (assignedSlugs.has(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
    }

    assignedSlugs.add(slug);
    return slug;
}

module.exports = {
    toAsciiSlug,
    shortHash,
    formatDatePrefix,
    sourceWithoutExt,
    manualSlugByTitle,
    resolveSlug
};
