'use strict';

// This is intentionally a small, author-maintained graph rather than an
// inference from tags, publication dates, or vector similarity.  A track is
// only added after its order has been reviewed as a useful reading sequence.
// `slug` is resolved against the generated post corpus at build time, so the
// public URL remains canonical while the configuration stays readable.
const LEARNING_TRACKS = Object.freeze([
  {
    id: 'agent-development',
    title: 'Agent 开发基础路线',
    aliases: ['agent', 'agent开发', 'ai应用开发', 'langchain', 'langgraph'],
    description: '从模型、消息和工具，逐步进入图工作流、状态与执行控制。',
    steps: [
      {
        id: 'agent-langchain-basic',
        slug: 'langchain-basic',
        level: 'beginner',
        aliases: ['模型', '消息', '工具']
      },
      {
        id: 'agent-langgraph-foundations',
        slug: 'langgraph-foundations',
        level: 'beginner',
        aliases: ['state', 'node', 'edge', '工作流']
      },
      {
        id: 'agent-state-memory',
        slug: 'state-and-short-term-memory',
        level: 'intermediate',
        aliases: ['状态', '短期记忆', 'reducer', 'checkpoint']
      },
      {
        id: 'agent-human-in-the-loop',
        slug: 'human-in-the-loop',
        level: 'intermediate',
        aliases: ['人机协作', '断点', '审批', '执行控制']
      }
    ]
  },
  {
    id: 'mathematical-analysis',
    title: '数学分析习题路线',
    aliases: ['数学分析', '极限', '微积分', '级数'],
    description: '按已维护的 1–7 题集顺序阅读。',
    steps: [
      { id: 'analysis-limits', slug: '1', level: 'beginner', aliases: ['极限'] },
      { id: 'analysis-continuity', slug: '2', level: 'beginner', aliases: ['连续性'] },
      { id: 'analysis-completeness', slug: '3', level: 'intermediate', aliases: ['完备性'] },
      { id: 'analysis-differentiation', slug: '4', level: 'intermediate', aliases: ['微分'] },
      { id: 'analysis-integration', slug: '5', level: 'intermediate', aliases: ['积分'] },
      { id: 'analysis-number-series', slug: '6', level: 'advanced', aliases: ['数项级数'] },
      { id: 'analysis-function-series', slug: '7', level: 'advanced', aliases: ['函数项级数'] }
    ]
  },
  {
    id: 'frontend-vue',
    title: '前端与 Vue 入门路线',
    aliases: ['前端', 'vue', 'html', 'css', 'javascript'],
    description: '先掌握前端三件套，再进入 Vue 的组织方式。',
    steps: [
      {
        id: 'frontend-basics',
        slug: 'frontend-basic',
        level: 'beginner',
        aliases: ['html', 'css', 'javascript']
      },
      {
        id: 'vue-basics',
        slug: 'vue',
        level: 'intermediate',
        aliases: ['vue', '组件', '数据驱动']
      }
    ]
  },
  {
    id: 'recurrent-neural-networks',
    title: '循环神经网络路线',
    aliases: ['rnn', '循环神经网络', 'lstm', 'gru'],
    description: '先理解基础循环网络，再学习门控变体。',
    steps: [
      {
        id: 'rnn-basics',
        slug: 'post-20260430-1a596f',
        level: 'beginner',
        aliases: ['rnn', '循环神经网络']
      },
      {
        id: 'rnn-gated',
        slug: 'lstm',
        level: 'intermediate',
        aliases: ['lstm', 'gru', '门控循环神经网络']
      }
    ]
  }
]);

module.exports = {
  LEARNING_TRACKS
};
