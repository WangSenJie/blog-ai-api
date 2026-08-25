// search the blog from source/_posts —— findPostFiles()
// read the content and extract the text —— readPostFile()
// extract the title, date, tag and content —— parseFrontMatter()
// standardize the main text into a uniform format —— markdownToText()
// produce a corpus object —— buildPostObject()

// buildCorpus()


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SITE_URL = 'https://wangsenjie.github.io';
const { resolveSlug, formatDatePrefix } = require('./slug-utils');
const { LEARNING_TRACKS } = require('./learning-graph-config');
const {
    CHUNK_PROFILES,
    PROFILE_SOURCES,
    loadProfileRegistry,
    normalizeRepositoryPath,
    resolveChunkProfile
} = require('./rag-chunk-profiles');
const {
    markdownParser,
    markdownToText,
    parseFrontMatter,
    parseMarkdownDocument
} = require('./markdown-structure');

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
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    let frontMatterText = '';
    let body = raw;
    let hasFrontMatter = false;
    let bodyLineOffset = 0;
    const frontMatter = raw.match(
        /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
    );

    if (frontMatter) {
        hasFrontMatter = true;
        frontMatterText = frontMatter[1].trim();
        body = raw.slice(frontMatter[0].length).replace(/\s+$/, '');
        bodyLineOffset = (frontMatter[0].match(/\n/g) || []).length;
    }

    return {
        filePath: filePath,
        raw: raw,
        frontMatterText: frontMatterText,
        body: body,
        hasFrontMatter,
        bodyLineOffset
    };
}

function toArray(value) {
    if (Array.isArray(value)) {
        return value.map(item => String(item || '').trim()).filter(Boolean);
    }
    if (!value) return [];
    return [String(value).trim()].filter(Boolean);
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

function extractInternalMarkdownLinks(markdown, filePath, rootDir) {
    const links = [];
    const source = String(markdown || '');
    const sourcePath = normalizeRepositoryPath(path.relative(rootDir, filePath));
    const seen = new Set();

    for (const match of source.matchAll(/(?<!!)\[([^\]]*)\]\(([^)]+)\)/g)) {
        const label = markdownToText(match[1]).replace(/\s+/g, ' ').trim();
        let rawTarget = String(match[2] || '').trim()
            .replace(/^<|>$/g, '')
            .replace(/\s+["'][^"']*["']\s*$/, '')
            .trim();
        if (!rawTarget || /^(?:mailto:|javascript:|data:)/i.test(rawTarget)) continue;

        let targetUrl = '';
        let targetSourcePath = '';
        let anchor = '';
        const hashIndex = rawTarget.indexOf('#');
        if (hashIndex >= 0) {
            anchor = rawTarget.slice(hashIndex + 1);
            rawTarget = rawTarget.slice(0, hashIndex);
        }
        const targetWithoutQuery = rawTarget.split('?')[0];
        if (!targetWithoutQuery) {
            targetSourcePath = sourcePath;
        } else if (/^https?:\/\//i.test(targetWithoutQuery)) {
            try {
                const url = new URL(targetWithoutQuery);
                if (url.origin !== SITE_URL) continue;
                targetUrl = url.pathname.replace(/\/{2,}/g, '/');
            } catch (error) {
                continue;
            }
        } else if (targetWithoutQuery.startsWith('/')) {
            targetUrl = targetWithoutQuery.replace(/\/{2,}/g, '/');
        } else if (/\.md$/i.test(targetWithoutQuery)) {
            targetSourcePath = normalizeRepositoryPath(path.relative(
                rootDir,
                path.resolve(path.dirname(filePath), targetWithoutQuery)
            ));
        } else {
            continue;
        }

        const key = [label, targetUrl, targetSourcePath, anchor].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({
            label,
            rawTarget: String(match[2] || '').trim(),
            targetUrl,
            targetSourcePath,
            anchor
        });
    }
    return links;
}

function standardizeInternalLinkEdges(posts) {
    const postsBySource = new Map((posts || []).map(post => [post.sourcePath, post]));
    const postsByPathname = new Map((posts || []).map(post => {
        let pathname = '';
        try {
            pathname = new URL(post.url).pathname.replace(/\/{2,}/g, '/');
        } catch (error) {
            pathname = '';
        }
        return [pathname, post];
    }).filter(([pathname]) => pathname));
    const edges = [];

    for (const post of posts || []) {
        const resolvedLinks = [];
        for (const link of post.internalLinks || []) {
            const target = link.targetSourcePath
                ? postsBySource.get(link.targetSourcePath)
                : postsByPathname.get(link.targetUrl);
            const edge = {
                sourcePostId: post.id,
                sourceUrl: post.url,
                targetPostId: target ? target.id : '',
                targetUrl: target ? target.url : link.targetUrl,
                targetSourcePath: target ? target.sourcePath : link.targetSourcePath,
                label: link.label,
                anchor: link.anchor,
                resolved: Boolean(target)
            };
            resolvedLinks.push(edge);
            edges.push(edge);
        }
        post.internalLinks = resolvedLinks;
    }
    return edges;
}

function buildPostObject(filePath, assignedSlugs, profileRegistry) {
    const activeProfileRegistry = profileRegistry || loadProfileRegistry();
    const postFile = readPostFile(filePath);
    const meta = parseFrontMatter(postFile.frontMatterText, filePath);
    const markdownDocument = parseMarkdownDocument(postFile.body);
    if (postFile.bodyLineOffset) {
        for (const block of markdownDocument.blocks || []) {
            if (!block.sourceLines) continue;
            block.sourceLines = {
                start: block.sourceLines.start + postFile.bodyLineOffset,
                end: block.sourceLines.end + postFile.bodyLineOffset
            };
        }
    }
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
    const contentText = markdownDocument.contentText;
    const profile = resolveChunkProfile(meta, filePath, activeProfileRegistry);
    const sourcePath = normalizeRepositoryPath(path.relative(
        activeProfileRegistry.rootDir,
        filePath
    ));

    return {
        id: meta.title || filePath,
        title: meta.title || '',
        date: meta.date || '',
        description: meta.description || '',
        tags: toArray(meta.tags),
        categories: toArray(meta.categories),
        filePath: filePath,
        sourcePath,
        body: postFile.body || '',
        contentText,
        resourceLinks: extractResourceLinks(postFile.body),
        internalLinks: extractInternalMarkdownLinks(
            postFile.body,
            filePath,
            activeProfileRegistry.rootDir
        ),
        chunkProfile: profile.profile,
        profileSource: profile.profileSource,
        profileMatchedRule: profile.matchedRule,
        slug: slug || '',
        url: url,
        published,
        hasFrontMatter: postFile.hasFrontMatter,
        bodyLineOffset: postFile.bodyLineOffset,
        structuredBlocks: markdownDocument.blocks,
        structuredSections: markdownDocument.sections
    };
}

function splitMarkdownSections(markdown) {
    return parseMarkdownDocument(markdown).sections;
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

const ATOMIC_PROSE_BLOCK_TYPES = new Set(['table', 'formula', 'image']);

function mergeSourceLines(units) {
    const locations = (units || [])
        .map(unit => unit && unit.sourceLines)
        .filter(location => (
            location &&
            Number.isSafeInteger(location.start) &&
            Number.isSafeInteger(location.end)
        ));
    if (!locations.length) return null;
    return {
        start: Math.min(...locations.map(location => location.start)),
        end: Math.max(...locations.map(location => location.end))
    };
}

function structuredChunk(units) {
    return {
        content: (units || []).map(unit => unit.content).filter(Boolean).join('\n\n').trim(),
        blockTypes: [...new Set((units || []).map(unit => unit.type).filter(Boolean))],
        sourceLines: mergeSourceLines(units)
    };
}

function chunkStructuredSection(section, chunkSize, overlap) {
    const units = [];
    for (const block of section && section.blocks || []) {
        if (!block || block.type === 'code' || !String(block.content || '').trim()) continue;
        const content = String(block.content).trim();
        const atomic = ATOMIC_PROSE_BLOCK_TYPES.has(block.type);
        const parts = atomic ? [content] : splitLongText(content, chunkSize);
        for (const part of parts) {
            units.push({
                content: part,
                type: block.type,
                sourceLines: block.sourceLines,
                atomic
            });
        }
    }

    const chunks = [];
    let current = [];

    function currentText() {
        return current.map(unit => unit.content).join('\n\n');
    }

    function flush(keepOverlap) {
        const chunk = structuredChunk(current);
        if (chunk.content) chunks.push(chunk);
        if (!keepOverlap || !current.length) {
            current = [];
            return;
        }
        const last = current[current.length - 1];
        if (last.atomic) {
            current = [];
            return;
        }
        const overlapUnits = [];
        let remaining = overlap;
        for (let index = current.length - 1; index >= 0 && remaining > 0; index -= 1) {
            const unit = current[index];
            if (unit.atomic) break;
            const content = String(unit.content || '').trim();
            if (!content) continue;
            const retained = content.length <= remaining
                ? content
                : content.slice(-remaining).trim();
            if (retained) {
                overlapUnits.unshift(Object.assign({}, unit, { content: retained }));
                remaining -= retained.length;
            }
        }
        current = overlapUnits;
    }

    for (const unit of units) {
        if (unit.atomic && unit.content.length > chunkSize) {
            if (current.length) flush(false);
            chunks.push(structuredChunk([unit]));
            continue;
        }

        const separatorLength = current.length ? 2 : 0;
        if (current.length && currentText().length + separatorLength + unit.content.length > chunkSize) {
            flush(true);
        }
        if (current.length && currentText().length + 2 + unit.content.length > chunkSize) {
            current = [];
        }
        current.push(unit);
    }

    if (current.length) flush(false);
    return chunks;
}

function buildRetrievalText(post, values) {
    return [
        post && post.title,
        post && (post.tags || []).join(' '),
        post && (post.categories || []).join(' '),
        values && (values.headingPath || []).join(' > '),
        values && (values.blockTypes || []).join(' '),
        values && values.content
    ].map(value => String(value || '').trim()).filter(Boolean).join('\n');
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
        sourcePath: String(chunk.sourcePath || '').trim(),
        profile: String(chunk.profile || '').trim(),
        profileSource: String(chunk.profileSource || '').trim(),
        headingPath: (chunk.headingPath || []).map(value => String(value || '').trim()),
        sectionAnchor: String(chunk.sectionAnchor || '').trim(),
        blockTypes: (chunk.blockTypes || []).map(value => String(value || '').trim()),
        sourceLines: chunk.sourceLines || null,
        content: String(chunk.content || '')
            .replace(/\r\n/g, '\n')
            .replace(/\s+/g, ' ')
            .trim(),
        retrievalText: String(chunk.retrievalText || '')
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
            sourceLineStart: Math.max(
                1,
                Number(lineMap[0]) + 1 + (Number(post.bodyLineOffset) || 0)
            ),
            sourceLineEnd: Math.max(
                1,
                Number(lineMap[1]) + (Number(post.bodyLineOffset) || 0)
            ),
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
        sourcePath: post.sourcePath || '',
        profile: post.chunkProfile || 'generic-article',
        profileSource: post.profileSource || 'migration-fallback',
        sectionTitle: values.sectionTitle || '',
        headingPath: (values.headingPath || []).slice(),
        sectionAnchor: values.sectionAnchor || '',
        chunkIndex: values.chunkIndex,
        sectionOccurrence: values.sectionOccurrence || 0,
        content: values.content,
        retrievalText: '',
        blockTypes: (values.blockTypes || ['paragraph']).slice(),
        sourceLines: values.sourceLines || null,
        resourceLinks: (values.resourceLinks || []).slice(),
        metadataOnly: values.metadataOnly === true
    };
    chunk.retrievalText = buildRetrievalText(post, chunk);
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
        sectionAnchor: 'section_metadata',
        chunkIndex: 0,
        sectionChunkIndex: 0,
        sectionOccurrence: 0,
        content,
        blockTypes: ['metadata'],
        sourceLines: null,
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

    const sections = Array.isArray(post.structuredSections)
        ? post.structuredSections
        : splitMarkdownSections(post.body);
    const sourceSections = sections.length
        ? sections
        : [{ sectionTitle: '', content: post.contentText || '' }];
    let index = 0;

    const headingOccurrences = new Map();
    for (const section of sourceSections) {
        const headingKey = (section.headingPath || []).join('\u0000');
        const sectionOccurrence = headingOccurrences.get(headingKey) || 0;
        headingOccurrences.set(headingKey, sectionOccurrence + 1);
        const sectionChunks = section.blocks
            ? chunkStructuredSection(section, chunkSize, overlap)
            : chunkSection(section.content, chunkSize, overlap).map(content => ({
                content,
                blockTypes: ['paragraph'],
                sourceLines: null
            }));
        for (const [sectionChunkIndex, sectionChunk] of sectionChunks.entries()) {
            chunks.push(createChunk(post, {
                sectionTitle: section.sectionTitle,
                headingPath: section.headingPath || [],
                sectionAnchor: section.sectionAnchor || '',
                chunkIndex: index,
                sectionChunkIndex,
                sectionOccurrence,
                content: sectionChunk.content,
                blockTypes: sectionChunk.blockTypes,
                sourceLines: sectionChunk.sourceLines,
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

function buildCorpus(postsDir, options) {
    const settings = options || {};
    const profileRegistry = settings.profileRegistry || loadProfileRegistry(
        settings.profileConfigPath
    );
    const files = findPostFiles(postsDir);
    const posts = [];
    const chunks = [];
    const assignedSlugs = new Set();
    const diagnostics = {
        sourcePosts: files.length,
        unpublishedPosts: [],
        postsWithoutUrl: [],
        postsWithoutIndexableContent: [],
        postsWithoutFrontMatter: [],
        postsWithoutDeclaredProfile: [],
        structuredBlocks: 0,
        blockTypeCounts: {},
        profileCounts: {},
        profileSourceCounts: {},
        profileRegistry: {
            version: profileRegistry.version,
            defaultProfile: profileRegistry.defaultProfile,
            documentRules: profileRegistry.documents.size,
            pathRules: profileRegistry.pathRules.length
        },
        internalLinkEdges: 0,
        resolvedInternalLinkEdges: 0
    };

    for (const filePath of files) {
        const post = buildPostObject(filePath, assignedSlugs, profileRegistry);

        if (!post.hasFrontMatter) {
            diagnostics.postsWithoutFrontMatter.push(post.sourcePath);
        }

        if (!post.published) {
            diagnostics.unpublishedPosts.push(post.title || post.id);
            continue;
        }

        if (!post.url) {
            diagnostics.postsWithoutUrl.push(post.title || post.id);
            continue;
        }

        posts.push(post);
        diagnostics.profileCounts[post.chunkProfile] = (
            diagnostics.profileCounts[post.chunkProfile] || 0
        ) + 1;
        diagnostics.profileSourceCounts[post.profileSource] = (
            diagnostics.profileSourceCounts[post.profileSource] || 0
        ) + 1;
        if (post.profileSource === 'migration-fallback') {
            diagnostics.postsWithoutDeclaredProfile.push(post.sourcePath);
        }
        for (const block of post.structuredBlocks || []) {
            const type = String(block && block.type || '').trim();
            if (!type) continue;
            diagnostics.structuredBlocks += 1;
            diagnostics.blockTypeCounts[type] = (
                diagnostics.blockTypeCounts[type] || 0
            ) + 1;
        }

        const postChunks = chunkPost(post);
        if (!postChunks.length) {
            diagnostics.postsWithoutIndexableContent.push(post.title || post.id);
        }
        chunks.push(...postChunks);
    }

    const internalLinkEdges = standardizeInternalLinkEdges(posts);
    diagnostics.internalLinkEdges = internalLinkEdges.length;
    diagnostics.resolvedInternalLinkEdges = internalLinkEdges.filter(edge => edge.resolved).length;

    return {
        posts: posts,
        chunks: chunks,
        diagnostics
    };
}

function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * ratio) - 1)
    );
    return sorted[index];
}

function buildIngestionReport(posts, chunks, diagnostics) {
    const lengths = (chunks || []).map(chunk => String(chunk && chunk.content || '').length);
    const contentCounts = new Map();
    for (const chunk of chunks || []) {
        const content = String(chunk && chunk.content || '').replace(/\s+/g, ' ').trim();
        if (!content) continue;
        contentCounts.set(content, (contentCounts.get(content) || 0) + 1);
    }
    const duplicateChunkContents = [...contentCounts.values()]
        .filter(count => count > 1)
        .reduce((total, count) => total + count - 1, 0);
    const blockTypeCounts = Object.fromEntries(
        Object.entries(diagnostics && diagnostics.blockTypeCounts || {})
            .sort(([left], [right]) => left.localeCompare(right))
    );
    const profileCounts = Object.fromEntries(
        Object.entries(diagnostics && diagnostics.profileCounts || {})
            .sort(([left], [right]) => left.localeCompare(right))
    );
    const profileSourceCounts = Object.fromEntries(
        Object.entries(diagnostics && diagnostics.profileSourceCounts || {})
            .sort(([left], [right]) => left.localeCompare(right))
    );

    return {
        schemaVersion: 1,
        parser: {
            frontMatter: 'js-yaml-json-schema-v1',
            markdown: 'markdown-it-token-v1'
        },
        transformer: 'retrieval-text-v1',
        chunking: 'section-character-v1',
        chunkSchema: {
            active: 'structured-v1',
            next: 'chunk-v2',
            nextSchema: 'config/rag-chunk-v2.schema.json',
            rollbackMode: 'legacy-v3',
            rollbackRevision: '7e6d67b',
            switch: 'RAG_CHUNK_SCHEMA'
        },
        profileRegistry: Object.assign({}, diagnostics && diagnostics.profileRegistry),
        fieldContract: {
            content: {
                role: 'citation-source',
                derived: false
            },
            retrievalText: {
                role: 'retrieval-only',
                derived: true,
                citeable: false,
                version: 'retrieval-text-v1',
                source: 'deterministic-title-metadata-structure-content'
            },
            sectionAnchor: {
                role: 'source-navigation',
                derived: true,
                citeable: false,
                version: 'section-anchor-v1',
                source: 'heading-path-and-occurrence'
            },
            blockTypes: {
                role: 'structure-metadata',
                derived: true,
                citeable: false,
                version: 'markdown-block-types-v1',
                source: 'markdown-it-token-stream'
            },
            sourceLines: {
                role: 'source-provenance',
                derived: true,
                citeable: false,
                version: 'source-lines-v1',
                source: 'markdown-token-line-map'
            },
            internalLinks: {
                role: 'navigation-metadata',
                derived: true,
                citeable: false,
                version: 'internal-links-v1',
                source: 'markdown-links'
            },
            reservedRetrievalFields: ['summary', 'keywords', 'aliases', 'questions']
        },
        stats: {
            structuredPosts: (posts || []).length,
            structuredBlocks: Number(diagnostics && diagnostics.structuredBlocks) || 0,
            blockTypeCounts,
            profileCounts,
            profileSourceCounts,
            internalLinkEdges: Number(diagnostics && diagnostics.internalLinkEdges) || 0,
            resolvedInternalLinkEdges: Number(
                diagnostics && diagnostics.resolvedInternalLinkEdges
            ) || 0,
            chunksWithRetrievalText: (chunks || []).filter(chunk => (
                String(chunk && chunk.retrievalText || '').trim()
            )).length,
            sourceLocatedChunks: (chunks || []).filter(chunk => (
                chunk && chunk.sourceLines &&
                Number.isSafeInteger(chunk.sourceLines.start) &&
                Number.isSafeInteger(chunk.sourceLines.end)
            )).length,
            metadataOnlyChunks: (chunks || []).filter(chunk => chunk && chunk.metadataOnly).length,
            duplicateChunkContents,
            contentLength: {
                min: lengths.length ? Math.min(...lengths) : 0,
                p50: percentile(lengths, 0.5),
                p95: percentile(lengths, 0.95),
                max: lengths.length ? Math.max(...lengths) : 0
            }
        },
        warnings: {
            postsWithoutFrontMatter: (diagnostics && diagnostics.postsWithoutFrontMatter || []).slice(),
            postsWithoutDeclaredProfile: (
                diagnostics && diagnostics.postsWithoutDeclaredProfile || []
            ).slice()
        }
    };
}

module.exports = {
    findPostFiles,
    readPostFile,
    parseFrontMatter,
    parseMarkdownDocument,
    markdownToText,
    isPublished,
    isDraft,
    buildPostObject,
    splitMarkdownSections,
    chunkSection,
    contentHashForChunk,
    contentHashForCodeBlock,
    extractResourceLinks,
    extractInternalMarkdownLinks,
    standardizeInternalLinkEdges,
    extractCodeBlocks,
    extractCodeBlocksForPost,
    buildIngestionReport,
    buildLearningGraph,
    stableCodeBlockId,
    stableChunkId,
    chunkStructuredSection,
    chunkPost,
    buildCorpus,
    CHUNK_PROFILES,
    PROFILE_SOURCES
};
