'use strict';

const crypto = require('crypto');
const { normalizeText, tokenize } = require('../retrieval-core');

const MODEL = 'local-semantic-hash-v1';
const DIMENSIONS = 384;
const VERSION = 3;

const CONCEPT_GROUPS = Object.freeze([
  ['two_tower', ['双塔', '双塔模型', 'two tower', 'two-tower', '用户塔', '物品塔', '候选侧', '请求侧', '向量召回', '表征空间']],
  ['residual_network', ['resnet', '残差网络', '残差连接', '残差块', '跳跃连接', 'skip connection', '深层卷积网络']],
  ['gated_recurrent', ['gru', '门控循环', '更新门', '重置门', '长期依赖', '循环神经网络']],
  ['item_collaborative_filtering', ['itemcf', '物品协同过滤', '物品相似度', '相似物品', '共同交互']],
  ['user_collaborative_filtering', ['usercf', '用户协同过滤', '用户相似度', '兴趣相近', '相似用户']],
  ['transformer_attention', ['transformer', '自注意力', 'self attention', 'self-attention', '注意力机制', '并行序列']],
  ['exposure_filtering', ['曝光过滤', '已看过滤', '已经看过', '已经展示', '候选排除', '过滤已曝光']],
  ['deep_retrieval', ['deep retrieval', '深度召回', '层次召回', '路径召回', 'beam search', '束搜索', '树结构召回']],
  ['langchain_pipeline', ['langchain', 'prompt template', '提示词模板', '聊天模型', '输出解析器', '调用链']],
  ['agent_workflow', ['langgraph', 'agent', '智能体', '状态图', '工作流', '节点', '边', '状态管理']],
  ['embedding_representation', ['embedding', '嵌入', '向量表示', '稠密向量', '特征表征', '语义向量']],
  ['ranking_retrieval', ['bm25', '关键词召回', '向量检索', '混合检索', 'rrf', '重排序', 'reranker']]
]);

function addFeature(features, feature, weight) {
  if (!feature || !Number.isFinite(weight) || weight <= 0) return;
  features.set(feature, (features.get(feature) || 0) + weight);
}

function extractFeatures(value) {
  const normalized = normalizeText(value);
  const features = new Map();
  for (const term of tokenize(normalized)) addFeature(features, `term:${term}`, 1.2);
  const compact = normalized.replace(/\s+/g, '');
  for (let index = 0; index < compact.length - 2; index += 1) {
    addFeature(features, `gram:${compact.slice(index, index + 3)}`, 0.18);
  }
  for (const [concept, aliases] of CONCEPT_GROUPS) {
    const count = aliases.filter(alias => normalized.includes(alias)).length;
    if (count) addFeature(features, `concept:${concept}`, 12 + Math.min(4, count));
  }
  return features;
}

function normalizeVector(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return values.map(() => 0);
  return values.map(value => Number((value / magnitude).toFixed(8)));
}

function embedText(value, options) {
  const dimensions = Number(options && options.dimensions) || DIMENSIONS;
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const [feature, weight] of extractFeatures(value)) {
    const digest = crypto.createHash('sha256').update(feature).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    vector[index] += digest[4] % 2 === 0 ? weight : -weight;
  }
  return normalizeVector(vector);
}

function createLocalProvider(options) {
  const dimensions = Number(options && options.dimensions) || DIMENSIONS;
  return Object.freeze({
    name: 'local',
    model: MODEL,
    dimensions,
    version: VERSION,
    normalization: 'l2-client-v1',
    async embedDocuments(inputs) {
      return {
        vectors: (inputs || []).map(input => embedText(input, { dimensions })),
        usage: { promptTokens: 0, totalTokens: 0 }
      };
    },
    async embedQuery(input) {
      return embedText(input, { dimensions });
    },
    embedText(input) {
      return embedText(input, { dimensions });
    }
  });
}

module.exports = {
  CONCEPT_GROUPS,
  DIMENSIONS,
  MODEL,
  VERSION,
  createLocalProvider,
  embedText,
  normalizeVector
};
