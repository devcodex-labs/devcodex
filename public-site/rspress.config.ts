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
      { text: '常见任务', link: '/guide/common-tasks' },
      { text: '排错', link: '/guide/troubleshooting' },
      { text: '参考', link: '/reference/workflows' },
      { text: 'GitHub', link: 'https://github.com/devcodex-labs/devcodex' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '使用指南',
          items: [
            { text: '5 分钟开始', link: '/guide/getting-started' },
            { text: '常见任务', link: '/guide/common-tasks' },
            { text: '故障排查', link: '/guide/troubleshooting' }
          ]
        }
      ],
      '/reference/': [
        {
          text: '产品参考',
          items: [
            { text: '工作流', link: '/reference/workflows' },
            { text: 'Skill', link: '/reference/skills' },
            { text: '宿主边界', link: '/reference/hosts' },
            { text: '配置', link: '/reference/configuration' },
            { text: '限制与边界', link: '/reference/limits' }
          ]
        }
      ]
    }
  }
})
