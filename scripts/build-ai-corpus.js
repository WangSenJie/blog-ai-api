// search the blog from source/_posts —— findPostFiles()
// read the content and extract the text —— readPostFile()
// extract the title, date, tag and content —— parseFrontMatter()
// standardize the main text into a uniform format —— markdownToText()
// produce a corpus object —— buildPostObject()

// buildCorpus()


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MarkdownIt = require('markdown-it');
const SITE_URL = 'https://wangsenjie.github.io';
const { resolveSlug, formatDatePrefix } = require('./slug-utils');
const { LEARNING_TRACKS } = require('./learning-graph-config');

const markdownParser = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false
});

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

    return files.sort();
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

function isPublished(value) {
    if (value === undefined || value === null || value === '') return true;
    const normalized = String(value)
        .trim()
        .replace(/\s+#.*$/, '')
        .replace(/^(['"])(.*)\1$/, '$2')
        .trim();
    return !/^(false|no|off|0)$/i.test(normalized);
}

function isDraft(value) {
    if (value === undefined || value === null || value === '') return false;
    const normalized = String(value)
        .trim()
        .replace(/\s+#.*$/, '')
        .replace(/^(['"])(.*)\1$/, '$2')
        .trim();
    return /^(true|yes|on|1)$/i.test(normalized);
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

function extractResourceLinks(markdown) {
    const links = new Set();
    const source = String(markdown || '');
    const add = value => {
        const link = String(value || '').trim().replace(/^['"]|['"]$/g, '');
        if (link) links.add(link);
    };

    for (const match of source.matchAll(/\{%-?\s*(?:pdf|asset_link)\s+([^\s%}]+)/gi)) {
        add(match[1]);
    }
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        add(match[1]);
    }

    return [...links];
}

function buildPostObject(filePath, assignedSlugs) {
    const postFile = readPostFile(filePath);
    const meta = parseFrontMatter(postFile.frontMatterText);
    const source = filePath.replace(/^.*source[\\/]/, '');
    const published = isPublished(meta.published) && !isDraft(meta.draft);
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
        description: meta.description || '',
        tags: toArray(meta.tags),
        categories: toArray(meta.categories),
        filePath: filePath,
        body: postFile.body || '',
        contentText,
        resourceLinks: extractResourceLinks(postFile.body),
        slug: slug || '',
        url: url,
        published
    };
}

function splitMarkdownSections(markdown) {
    const sections = [];
    let sectionTitle = '';
    let headingPath = [];
    const headingStack = [];
    let lines = [];

    function flush() {
        const content = markdownToText(lines.join('\n'));
        if (content) {
            sections.push({
                sectionTitle,
                headingPath: headingPath.slice(),
                content
            });
        }
        lines = [];
    }

    for (const line of String(markdown || '').split('\n')) {
        const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        if (heading) {
            flush();
            const level = heading[1].length;
            sectionTitle = markdownToText(heading[2]);
            headingStack.length = level - 1;
            headingStack[level - 1] = sectionTitle;
            headingPath = headingStack.filter(Boolean);
            continue;
        }
        lines.push(line);
    }

    flush();
    return sections;
}

function splitLongText(text, maxLength) {
    const parts = [];
    let remaining = String(text || '').trim();

    while (remaining.length > maxLength) {
        const candidate = remaining.slice(0, maxLength + 1);
        const boundaryMatches = [...candidate.matchAll(/[。！？；.!?;]\s*/g)];
        const lastBoundary = boundaryMatches[boundaryMatches.length - 1];
        const whitespaceIndex = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'));
        const minimumBreak = Math.floor(maxLength * 0.55);
        let breakAt = maxLength;

        if (lastBoundary && lastBoundary.index >= minimumBreak) {
            breakAt = lastBoundary.index + lastBoundary[0].length;
        } else if (whitespaceIndex >= minimumBreak) {
            breakAt = whitespaceIndex + 1;
        }

        parts.push(remaining.slice(0, breakAt).trim());
        remaining = remaining.slice(breakAt).trim();
    }

    if (remaining) parts.push(remaining);
    return parts;
}

function chunkSection(text, chunkSize, overlap) {
    const paragraphs = String(text || '')
        .split(/\n\s*\n/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean)
        .flatMap(paragraph => splitLongText(paragraph, chunkSize));
    const chunks = [];
    let current = '';

    function flush() {
        const content = current.trim();
        if (!content) return;
        chunks.push(content);
        current = content.slice(-overlap).trim();
    }

    for (const paragraph of paragraphs) {
        const separator = current ? '\n\n' : '';
        if (current && current.length + separator.length + paragraph.length > chunkSize) {
            flush();
        }

        // A maximum-size paragraph cannot coexist with an overlap tail.
        if (current && current.length + 2 + paragraph.length > chunkSize) {
            current = paragraph;
        } else {
            current += `${current ? '\n\n' : ''}${paragraph}`;
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function stableChunkId(post, headingPath, sectionChunkIndex, sectionOccurrence) {
    const stableLocation = [
        String(post.url || '').trim().toLowerCase(),
        (headingPath || []).map(value => String(value || '').trim()).join(' > '),
        String(sectionOccurrence || 0),
        String(sectionChunkIndex)
    ].join('\u0000');
    const digest = crypto
        .createHash('sha256')
        .update(stableLocation)
        .digest('hex');
    return `chunk_${digest.slice(0, 24)}`;
}

function contentHashForChunk(chunk) {
    const fingerprint = {
        postTitle: String(chunk.postTitle || '').trim(),
        postUrl: String(chunk.postUrl || '').trim(),
        tags: (chunk.tags || []).map(value => String(value || '').trim()),
        categories: (chunk.categories || []).map(value => String(value || '').trim()),
        headingPath: (chunk.headingPath || []).map(value => String(value || '').trim()),
        content: String(chunk.content || '')
            .replace(/\r\n/g, '\n')
            .replace(/\s+/g, ' ')
            .trim(),
        resourceLinks: (chunk.resourceLinks || []).map(value => String(value || '').trim())
    };
    return `sha256:${crypto
        .createHash('sha256')
        .update(JSON.stringify(fingerprint))
        .digest('hex')}`;
}

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(value)
        .digest('hex');
}

function headingKey(headingPath) {
    return (headingPath || [])
        .map(value => String(value || '').trim())
        .join('\u0000');
}

function stableCodeBlockId(post, headingPath, ordinal) {
    const stableLocation = [
        String(post && post.url || '').trim().toLowerCase(),
        headingKey(headingPath),
        String(ordinal)
    ].join('\u0000');
    return `code_${sha256(stableLocation).slice(0, 24)}`;
}

function contentHashForCodeBlock(block) {
    const fingerprint = {
        postId: String(block.postId || '').trim(),
        postTitle: String(block.postTitle || '').trim(),
        postUrl: String(block.postUrl || '').trim(),
        headingPath: (block.headingPath || []).map(value => String(value || '').trim()),
        ordinal: Number(block.ordinal) || 0,
        language: String(block.language || '').trim(),
        code: String(block.code || '').replace(/\r\n/g, '\n')
    };
    return `sha256:${sha256(JSON.stringify(fingerprint))}`;
}

function normalizeCodeLanguage(value) {
    const language = String(value || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase()
        .replace(/[^a-z0-9_+-]/g, '');
    return language.slice(0, 40) || 'text';
}

function extractCodeBlocksForPost(post, postChunks) {
    if (!post || !post.url || !post.body) return [];

    const tokens = markdownParser.parse(String(post.body), {});
    const blocks = [];
    const headingStack = [];
    const occurrences = new Map();

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type === 'heading_open') {
            const inline = tokens[index + 1];
            const level = Number(String(token.tag || '').slice(1));
            const title = markdownToText(inline && inline.content || '');
            if (Number.isSafeInteger(level) && level >= 1 && title) {
                headingStack.length = level - 1;
                headingStack[level - 1] = title;
            }
            continue;
        }
        if (token.type !== 'fence') continue;

        const headingPath = headingStack.filter(Boolean);
        const sectionTitle = headingPath[headingPath.length - 1] || '';
        const key = headingKey(headingPath);
        const ordinal = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, ordinal);
        const exactContext = (postChunks || []).filter(chunk => (
            headingKey(chunk && chunk.headingPath) === key
        ));
        const fallbackContext = exactContext.length
            ? exactContext
            : (postChunks || []).filter(chunk => (
                String(chunk && chunk.sectionTitle || '') === sectionTitle
            ));
        const id = stableCodeBlockId(post, headingPath, ordinal);
        const lineMap = Array.isArray(token.map) ? token.map : [0, 0];
        const block = {
            id,
            anchor: `blog-ai-code-${id.slice('code_'.length)}`,
            postId: post.id,
            postTitle: post.title,
            postUrl: post.url,
            sectionTitle,
            headingPath,
            ordinal,
            language: normalizeCodeLanguage(token.info),
            code: String(token.content || '').replace(/\r\n/g, '\n'),
            sourceLineStart: Math.max(1, Number(lineMap[0]) + 1),
            sourceLineEnd: Math.max(1, Number(lineMap[1])),
            contextChunkIds: fallbackContext
                .map(chunk => String(chunk && chunk.id || '').trim())
                .filter(Boolean)
                .slice(0, 6)
        };
        block.contentHash = contentHashForCodeBlock(block);
        blocks.push(block);
    }

    return blocks;
}

function extractCodeBlocks(posts, chunks) {
    const chunksByUrl = new Map();
    for (const chunk of chunks || []) {
        const url = String(chunk && chunk.postUrl || '').trim();
        if (!url) continue;
        if (!chunksByUrl.has(url)) chunksByUrl.set(url, []);
        chunksByUrl.get(url).push(chunk);
    }
    return (posts || []).flatMap(post => (
        extractCodeBlocksForPost(post, chunksByUrl.get(post.url) || [])
    ));
}

function buildLearningGraph(posts, tracks) {
    const postsBySlug = new Map();
    for (const post of posts || []) {
        const slug = String(post && post.slug || '').trim();
        if (slug && !postsBySlug.has(slug)) postsBySlug.set(slug, post);
    }

    const graphTracks = [];
    const graphNodes = [];
    const graphEdges = [];
    const seenNodes = new Set();
    for (const track of tracks || LEARNING_TRACKS) {
        const trackId = String(track && track.id || '').trim();
        if (!trackId) throw new Error('Learning graph track is missing an id');
        const nodes = [];
        for (const [index, step] of (track.steps || []).entries()) {
            const post = postsBySlug.get(String(step && step.slug || '').trim());
            if (!post) {
                throw new Error(
                    `Learning graph references a missing published slug: ${step && step.slug || ''}`
                );
            }
            const id = String(step && step.id || '').trim();
            if (!id || seenNodes.has(id)) {
                throw new Error(`Learning graph node id is missing or duplicated: ${id || '(empty)'}`);
            }
            seenNodes.add(id);
            const node = {
                id,
                postId: post.id,
                title: post.title,
                url: post.url,
                order: index + 1,
                level: String(step.level || 'beginner'),
                aliases: (step.aliases || []).map(value => String(value || '').trim()).filter(Boolean)
            };
            nodes.push(node);
            graphNodes.push(Object.assign({ trackId }, node));
        }
        for (let index = 0; index < nodes.length - 1; index += 1) {
            const from = nodes[index];
            const to = nodes[index + 1];
            const reason = `作者维护的「${track.title}」阅读顺序`;
            graphEdges.push({
                id: `${trackId}:next:${from.id}:${to.id}`,
                trackId,
                from: from.id,
                to: to.id,
                relation: 'next',
                reason
            });
            graphEdges.push({
                id: `${trackId}:prerequisite:${from.id}:${to.id}`,
                trackId,
                from: from.id,
                to: to.id,
                relation: 'prerequisite',
                reason
            });
        }
        graphTracks.push({
            id: trackId,
            title: String(track.title || '').trim(),
            aliases: (track.aliases || []).map(value => String(value || '').trim()).filter(Boolean),
            description: String(track.description || '').trim(),
            nodes
        });
    }

    return {
        schemaVersion: 1,
        version: 'author-curated-v1',
        policy: 'explicit_author_curated_only',
        nodes: graphNodes,
        tracks: graphTracks,
        edges: graphEdges
    };
}

function createChunk(post, values) {
    const chunk = {
        postUrl: post.url || '',
        postId: post.id,
        postTitle: post.title,
        tags: post.tags || [],
        categories: post.categories || [],
        sectionTitle: values.sectionTitle || '',
        headingPath: (values.headingPath || []).slice(),
        chunkIndex: values.chunkIndex,
        sectionOccurrence: values.sectionOccurrence || 0,
        content: values.content,
        resourceLinks: (values.resourceLinks || []).slice(),
        metadataOnly: values.metadataOnly === true
    };
    chunk.id = stableChunkId(
        post,
        chunk.headingPath,
        values.sectionChunkIndex || 0,
        values.sectionOccurrence || 0
    );
    chunk.contentHash = contentHashForChunk(chunk);
    return chunk;
}

function buildPdfMetadataChunk(post) {
    const resourceSummary = post.resourceLinks && post.resourceLinks.length
        ? `资源链接：${post.resourceLinks.join(' ')}`
        : '资源链接未在正文中解析到。';
    const content = [
        post.title,
        post.description,
        (post.tags || []).join(' '),
        (post.categories || []).join(' '),
        '本文以 PDF 或其他外部文档资源形式发布，当前站内索引仅提供文章元数据与资源链接。',
        resourceSummary
    ].filter(Boolean).join('\n');

    return createChunk(post, {
        sectionTitle: '文章元数据',
        headingPath: ['文章元数据'],
        chunkIndex: 0,
        sectionChunkIndex: 0,
        sectionOccurrence: 0,
        content,
        resourceLinks: post.resourceLinks || [],
        metadataOnly: true
    });
}

function chunkPost(post) {
    const chunks = [];
    const chunkSize = 700;
    const overlap = 100;
    const postUrl = post.url || '';
    if (post.published === false || !postUrl) return chunks;

    const sections = splitMarkdownSections(post.body);
    const sourceSections = sections.length
        ? sections
        : [{ sectionTitle: '', content: post.contentText || '' }];
    let index = 0;

    const headingOccurrences = new Map();
    for (const section of sourceSections) {
        const headingKey = (section.headingPath || []).join('\u0000');
        const sectionOccurrence = headingOccurrences.get(headingKey) || 0;
        headingOccurrences.set(headingKey, sectionOccurrence + 1);
        const sectionChunks = chunkSection(section.content, chunkSize, overlap);
        for (const [sectionChunkIndex, content] of sectionChunks.entries()) {
            chunks.push(createChunk(post, {
                sectionTitle: section.sectionTitle,
                headingPath: section.headingPath || [],
                chunkIndex: index,
                sectionChunkIndex,
                sectionOccurrence,
                content,
                resourceLinks: post.resourceLinks || []
            }));
            index += 1;
        }
    }

    if (!chunks.length) {
        chunks.push(buildPdfMetadataChunk(post));
    }

    return chunks;
}

function buildCorpus(postsDir) {
    const files = findPostFiles(postsDir);
    const posts = [];
    const chunks = [];
    const assignedSlugs = new Set();
    const diagnostics = {
        sourcePosts: files.length,
        unpublishedPosts: [],
        postsWithoutUrl: [],
        postsWithoutIndexableContent: []
    };

    for (const filePath of files) {
        const post = buildPostObject(filePath, assignedSlugs);

        if (!post.published) {
            diagnostics.unpublishedPosts.push(post.title || post.id);
            continue;
        }

        if (!post.url) {
            diagnostics.postsWithoutUrl.push(post.title || post.id);
            continue;
        }

        posts.push(post);

        const postChunks = chunkPost(post);
        if (!postChunks.length) {
            diagnostics.postsWithoutIndexableContent.push(post.title || post.id);
        }
        chunks.push(...postChunks);
    }

    return {
        posts: posts,
        chunks: chunks,
        diagnostics
    };
}

module.exports = {
    findPostFiles,
    readPostFile,
    parseFrontMatter,
    isPublished,
    isDraft,
    buildPostObject,
    splitMarkdownSections,
    chunkSection,
    contentHashForChunk,
    contentHashForCodeBlock,
    extractResourceLinks,
    extractCodeBlocks,
    extractCodeBlocksForPost,
    buildLearningGraph,
    stableCodeBlockId,
    stableChunkId,
    chunkPost,
    buildCorpus
};
