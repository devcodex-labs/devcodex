import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  outDir: 'doc_build',
  base: '/devcodex/',
  lang: 'zh',
  icon: '/favicon.png',
  logo: '/favicon.png',
  logoText: 'DevCodex',
  title: 'DevCodex — Intent-driven AI Coding Workflow Runtime',
  description: '把自然语言研发请求组织成有上下文、有边界、有验证、可续接的工程工作流。',
  markdown: {
    link: {
      checkDeadLinks: true,
      checkAnchors: true
    },
    image: {
      checkDeadImages: true
    }
  },
  themeConfig: {
    nav: [
      { text: '开始', link: '/guide/getting-started' },
      { text: '教程', link: '/tutorials/ambiguous-request' },
      { text: '原理', link: '/concepts/architecture' },
      { text: '工作流', link: '/workflows/' },
      { text: '信任', link: '/guide/trust-security-data' },
      { text: '参考', link: '/reference/workflows' },
      { text: 'GitHub', link: 'https://github.com/devcodex-labs/devcodex' }
    ],
    sidebar: Object.fromEntries(
      ['/', '/guide/', '/tutorials/', '/concepts/', '/workflows/', '/examples/', '/reference/'].map((prefix) => [
        prefix,
        [
          {
            text: '使用指南',
            items: [
              { text: '5 分钟开始', link: '/guide/getting-started' },
              { text: '常见任务', link: '/guide/common-tasks' },
              { text: '宿主与工作区', link: '/guide/hosts' },
              { text: '信任、安全与数据', link: '/guide/trust-security-data' },
              { text: '故障排查', link: '/guide/troubleshooting' }
            ]
          },
          {
            text: '任务教程',
            items: [
              { text: '把模糊需求变成行动', link: '/tutorials/ambiguous-request' },
              { text: '修复并控制回归', link: '/tutorials/fix-regression' },
              { text: '推进跨领域改动', link: '/tutorials/cross-domain-change' },
              { text: '带证据交付与续接', link: '/tutorials/evidence-handoff' }
            ]
          },
          {
            text: '运行机制',
            items: [
              { text: '架构怎么跑', link: '/concepts/architecture' },
              { text: '意图驱动', link: '/concepts/intent-driven' },
              { text: 'Profile、上下文与记忆', link: '/concepts/profile-context-memory' },
              { text: '渐进 Skill 路由', link: '/concepts/progressive-skill-routing' },
              { text: '证据与完成', link: '/concepts/evidence-and-completion' },
              { text: '任务续接', link: '/concepts/task-resume' }
            ]
          },
          {
            text: '工作流',
            items: [
              { text: '工作流选择', link: '/workflows/' },
              { text: '开发与修复', link: '/workflows/change' },
              { text: '分析、审查与规划', link: '/workflows/read-only' },
              { text: '对话与任务续接', link: '/workflows/session' }
            ]
          },
          {
            text: '案例',
            items: [
              { text: '跨会话续接', link: '/examples/resume' }
            ]
          },
          {
            text: '产品参考',
            items: [
              { text: '工作流索引', link: '/reference/workflows' },
              { text: 'CLI 命令', link: '/reference/cli' },
              { text: '状态与错误码', link: '/reference/diagnostics' },
              { text: 'Skill', link: '/reference/skills' },
              { text: '宿主边界', link: '/reference/hosts' },
              { text: '配置', link: '/reference/configuration' },
              { text: '运行态维护', link: '/reference/runtime-operations' },
              { text: '术语表', link: '/reference/glossary' },
              { text: '限制与边界', link: '/reference/limits' }
            ]
          }
        ]
      ])
    )
  }
})
