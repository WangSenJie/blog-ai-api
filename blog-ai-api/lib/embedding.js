'use strict';

const crypto = require('crypto');

const {
  normalizeText,
  tokenize
} = require('./retrieval-core');

// This deterministic local embedding keeps the first hybrid index portable: it
// needs no network call at build or query time, and can later be replaced by a
// hosted embedding provider without changing the vector file contract.
const EMBEDDING_MODEL = 'local-semantic-hash-v1';
const EMBEDDING_DIMENSIONS = 384;
const EMBEDDING_VERSION = 2;

const CONCEPT_GROUPS = Object.freeze([
  ['two_tower', [
    '双塔', '双塔模型', 'two tower', 'two-tower', '用户塔', '物品塔',
    '用户编码', '物品编码', '用户表征', '物品表征', '候选侧', '请求侧',
    '向量召回', '表征空间', '用户和物品', '编码用户和物品', '两个表征',
    '两个向量的相似度', '用户物品表征'
  ]],
  ['residual_network', [
    'resnet', '残差网络', '残差连接', '残差块', '跳跃连接', '捷径连接',
    'skip connection', '深层卷积网络'
  ]],
  ['gated_recurrent', [
    'gru', '门控循环', '门控机制', '更新门', '重置门', '长期依赖',
    '序列记忆', '循环神经网络'
  ]],
  ['item_collaborative_filtering', [
    'itemcf', '物品协同过滤', '物品相似度', '相似物品', '商品相似',
    '共同交互', '共同购买'
  ]],
  ['user_collaborative_filtering', [
    'usercf', '用户协同过滤', '用户相似度', '兴趣相近', '相似用户',
    '相近的人群', '共同喜欢'
  ]],
  ['transformer_attention', [
    'transformer', '自注意力', 'self attention', 'self-attention',
    '注意力机制', '并行序列', '非循环', '不依赖循环'
  ]],
  ['exposure_filtering', [
    '曝光过滤', '已看过滤', '已经看过', '已经展示', '候选排除',
    '去除已消费', '过滤已曝光'
  ]],
  ['deep_retrieval', [
    'deep retrieval', '深度召回', '层次召回', '路径召回', 'beam search',
    '束搜索', '树结构召回'
  ]],
  ['langchain_pipeline', [
    'langchain', 'prompt template', '提示词模板', '聊天模型', '输出解析器',
    '调用链', '链式应用'
  ]],
  ['agent_workflow', [
    'langgraph', 'agent', '智能体', '状态图', '工作流', '节点', '边',
    '短期记忆', '状态管理'
  ]],
  ['embedding_representation', [
    'embedding', '嵌入', '向量表示', '稠密向量', '特征表征', '语义向量'
  ]],
  ['ranking_retrieval', [
    'bm25', '关键词召回', '向量检索', '混合检索', 'rrf', '重排序',
    'reranker', '召回阶段'
  ]]
]);

function embeddingMetadata() {
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    version: EMBEDDING_VERSION,
    provider: 'local'
  };
}

function addFeature(features, feature, weight) {
  if (!feature || !Number.isFinite(weight) || weight <= 0) return;
  features.set(feature, (features.get(feature) || 0) + weight);
}

function addCharacterFeatures(features, value) {
  const normalized = normalizeText(value).replace(/\s+/g, '');
  if (!normalized) return;

  for (let index = 0; index < normalized.length - 2; index += 1) {
    addFeature(features, `gram:${normalized.slice(index, index + 3)}`, 0.18);
  }
}

function extractFeatures(value) {
  const normalized = normalizeText(value);
  const features = new Map();

  for (const term of tokenize(normalized)) {
    addFeature(features, `term:${term}`, 1.2);
  }
  addCharacterFeatures(features, normalized);

  for (const [concept, aliases] of CONCEPT_GROUPS) {
    const matchedAliases = aliases.filter(alias => normalized.includes(alias));
    if (matchedAliases.length) {
      addFeature(features, `concept:${concept}`, 12 + Math.min(4, matchedAliases.length));
    }
  }

  return features;
}

function featureSlot(feature, dimensions) {
  const digest = crypto.createHash('sha256').update(feature).digest();
  return {
    index: digest.readUInt32BE(0) % dimensions,
    sign: digest[4] % 2 === 0 ? 1 : -1
  };
}

function normalizeVector(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return values.map(() => 0);
  return values.map(value => Number((value / magnitude).toFixed(6)));
}

function embedText(value, options) {
  const dimensions = Number(options && options.dimensions) || EMBEDDING_DIMENSIONS;
  const vector = Array.from({ length: dimensions }, () => 0);
  const features = extractFeatures(value);

  for (const [feature, weight] of features) {
    const slot = featureSlot(feature, dimensions);
    vector[slot.index] += slot.sign * weight;
  }

  return normalizeVector(vector);
}

function embeddingInputForChunk(chunk) {
  return [
    chunk && chunk.postTitle,
    chunk && chunk.postTitle,
    chunk && (chunk.tags || []).join(' '),
    chunk && (chunk.categories || []).join(' '),
    chunk && (chunk.headingPath || []).join(' '),
    chunk && chunk.sectionTitle,
    chunk && chunk.content
  ].filter(Boolean).join('\n');
}

function embedChunk(chunk) {
  return embedText(embeddingInputForChunk(chunk));
}

function isFiniteVector(values, dimensions) {
  return Array.isArray(values) &&
    values.length === dimensions &&
    values.every(value => Number.isFinite(value));
}

function isReusableVector(record, chunk) {
  return Boolean(
    record &&
    chunk &&
    record.id === chunk.id &&
    record.contentHash === chunk.contentHash &&
    isFiniteVector(record.values, EMBEDDING_DIMENSIONS)
  );
}

function buildVectorIndex(chunks, previousVectors) {
  const previousById = new Map(
    (previousVectors || [])
      .filter(record => record && record.id)
      .map(record => [record.id, record])
  );
  const vectors = [];
  let added = 0;
  let updated = 0;
  let reused = 0;
  let failed = 0;

  for (const chunk of chunks || []) {
    const previous = previousById.get(chunk.id);
    try {
      if (isReusableVector(previous, chunk)) {
        vectors.push({
          id: previous.id,
          contentHash: previous.contentHash,
          values: previous.values.slice()
        });
        reused += 1;
      } else {
        vectors.push({
          id: chunk.id,
          contentHash: chunk.contentHash,
          values: embedChunk(chunk)
        });
        if (previous) updated += 1;
        else added += 1;
      }
    } catch (error) {
      failed += 1;
    }
  }

  const currentIds = new Set(vectors.map(record => record.id));
  const deleted = [...previousById.keys()].filter(id => !currentIds.has(id)).length;
  return {
    vectors,
    embedding: embeddingMetadata(),
    build: { added, updated, reused, deleted, failed }
  };
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return 0;
  }
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

module.exports = {
  CONCEPT_GROUPS,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  buildVectorIndex,
  cosineSimilarity,
  embedChunk,
  embedText,
  embeddingInputForChunk,
  embeddingMetadata,
  isFiniteVector,
  isReusableVector
};
