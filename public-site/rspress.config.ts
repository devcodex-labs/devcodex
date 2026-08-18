import { defineConfig } from '@rspress/core'

export default defineConfig({
  root: 'docs',
  outDir: 'doc_build',
  base: '/devcodex/',
  lang: 'zh',
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
      { text: '概念', link: '/concepts/architecture' },
      { text: '工作流', link: '/workflows/' },
      { text: '案例', link: '/examples/resume' },
      { text: '参考', link: '/reference/workflows' },
      { text: 'GitHub', link: 'https://github.com/devcodex-labs/devcodex' }
    ],
    sidebar: Object.fromEntries(
      ['/', '/guide/', '/concepts/', '/workflows/', '/examples/', '/reference/'].map((prefix) => [
        prefix,
        [
          {
            text: '使用指南',
            items: [
              { text: '5 分钟开始', link: '/guide/getting-started' },
              { text: '常见任务', link: '/guide/common-tasks' },
              { text: '故障排查', link: '/guide/troubleshooting' }
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
              { text: '总览', link: '/workflows/' },
              { text: 'dev', link: '/workflows/dev' },
              { text: 'fix', link: '/workflows/fix' },
              { text: 'analyze', link: '/workflows/analyze' },
              { text: 'audit', link: '/workflows/audit' },
              { text: 'resume', link: '/workflows/resume' },
              { text: 'chat', link: '/workflows/chat' }
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
              { text: 'Skill', link: '/reference/skills' },
              { text: '宿主边界', link: '/reference/hosts' },
              { text: '配置', link: '/reference/configuration' },
              { text: '限制与边界', link: '/reference/limits' }
            ]
          }
        ]
      ])
    )
  }
})
