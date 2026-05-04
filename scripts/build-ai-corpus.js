// search the blog from source/_posts —— findPostFiles()
// read the content and extract the text —— readPostFile()
// extract the title, date, tag and content —— parseFrontMatter()
// standardize the main text into a uniform format —— markdownToText()
// produce a corpus object —— buildPostObject()

// buildCorpus()


const fs = require('fs');
const path = require('path');
const SITE_URL = 'https://wangsenjie.github.io';
const { resolveSlug, formatDatePrefix } = require('./slug-utils');

function findPostFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
            files.push(...findPostFiles(fullPath));
            continue;
        }

        if (entry.isFile() && fullPath.endsWith('.md')) {
            files.push(fullPath);
        }
    }

    return files;
}

function readPostFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');

    let frontMatterText = '';
    let body = raw;

    if (raw.startsWith('---')) {
        const parts = raw.split('---');

        frontMatterText = parts[1].trim();
        body = parts.slice(2).join('---').trim();
    }

    return {
        filePath: filePath,
        raw: raw,
        frontMatterText: frontMatterText,
        body: body
    };
}

function parseFrontMatter(frontMatterText) {
    const result = {};
    const lines = frontMatterText.split('\n');
    let currentKey = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('- ')) {
            if (currentKey) {
                result[currentKey].push(trimmed.slice(2).trim());
            }
            continue;
        }

        const parts = trimmed.split(':');
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();

        if (value) {
            result[key] = value;
            currentKey = null;
        } else {
            result[key] = [];
            currentKey = key;
        }
    }

    return result;
}

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return [value];
}

function buildPostUrl(siteUrl, date, slug) {
    if (!siteUrl || !date || !slug) {
        return '';
    }

    let baseUrl = '';
    if (siteUrl.endsWith('/')) {
        baseUrl = siteUrl.slice(0, -1);
    } else {
        baseUrl = siteUrl;
    }

    const parts = formatDatePrefix(date).split('/');
    if (parts.length < 3) {
        return '';
    }
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];

    const url = `${baseUrl}/${year}/${month}/${day}/${slug}/`;

    return url;
}

// 清洗 markdown 文本
function markdownToText(markdown) {
    let text = String(markdown || '');

    // 移除 Hexo 标签
    text = text.replace(/{%[\s\S]*?%}/g, '');

    // 移除图片语法
    text = text.replace(/!\[.*?\]\(.*?\)/g, '');

    // 处理链接, 只保留文字
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // 除去行内代码
    text = text.replace(/`([^`]+)`/g, '$1');

    // 除去标题开头的 # 号
    text = text.replace(/^#+\s*/gm, '');

    // 除去引号开头的 >
    text = text.replace(/^\s*>\s*/gm, '');

    // 除去列表符号
    text = text.replace(/^\s*[-*+]\s+/gm, '');

    // 除去代码框
    text = text.replace(/^```.*$/gm, '');

    // 除去数学公式围栏
    text = text.replace(/^\$\$$/gm, '');

    // 除去加粗/斜体符号
    // text = text.replace(/[*_]{1,2}/g, '');

    // 压缩空白
    text = text.replace(/[ \t]+/g, ' '); //压缩横向空白
    text = text.replace(/\n{3,}/g, '\n\n'); //压缩纵向空白
    text = text.trim(); //去掉首尾空白


    return text;
}

function buildPostObject(filePath, assignedSlugs) {
    const postFile = readPostFile(filePath);
    const meta = parseFrontMatter(postFile.frontMatterText);
    const source = filePath.replace(/^.*source[\\/]/, '');
    const slug = resolveSlug(
        {
            title: meta.title,
            slug: meta.slug,
            date: meta.date,
            source: source
        },
        assignedSlugs
    )
    const url = buildPostUrl(SITE_URL, meta.date, slug);
    const contentText = markdownToText(postFile.body);

    return {
        id: meta.title || filePath,
        title: meta.title || '',
        date: meta.date || '',
        tags: toArray(meta.tags),
        categories: toArray(meta.categories),
        filePath: filePath,
        body: postFile.body || '',
        contentText,
        slug: slug || '',
        url: url
    };
}

function chunkPost(post) {
    const chunks = [];
    const text = post.contentText || '';
    const chunkSize = 500;
    const overlap = 100;
    const postUrl = post.url || '';

    let index = 0;

    for (let start = 0; start < text.length; start += (chunkSize - overlap)) {
        const content = text.slice(start, start + chunkSize).trim();

        if (!content) continue;

        chunks.push({
            id: `${post.id}#${index}`,
            postUrl,
            postId: post.id,
            postTitle: post.title,
            tags: post.tags || [],
            categories: post.categories || [],
            sectionTitle: '',
            content: content
        });

        index += 1;
    }

    return chunks;
}

function buildCorpus(postsDir) {
    const files = findPostFiles(postsDir);
    const posts = [];
    const chunks = [];
    const assignedSlugs = new Set();

    for (const filePath of files) {
        const post = buildPostObject(filePath, assignedSlugs);
        posts.push(post);

        const postChunks = chunkPost(post);
        chunks.push(...postChunks);
    }

    return {
        posts: posts,
        chunks: chunks
    };
}

module.exports = {
    findPostFiles,
    readPostFile,
    parseFrontMatter,
    buildPostObject,
    chunkPost,
    buildCorpus
};
