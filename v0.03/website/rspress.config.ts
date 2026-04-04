import * as path from 'node:path';
import { defineConfig } from '@rspress/core';

export default defineConfig({
    root: path.join(__dirname, 'docs'),
    base: '/devcodex/',
    title: 'DevCodex',
    icon: '/favicon.svg',
    description: 'GitHub Copilot Agent Plugin — 1 个统一 Agent + 34 个 Skills，AI 辅助开发规范体系',
    outDir: 'dist',
    search: {
        codeBlocks: true,
    },
    themeConfig: {
        nav: [
            {
                text: '指南',
                link: '/guide/introduction',
                activeMatch: '/guide/',
            },
            {
                text: '架构',
                link: '/architecture/overview',
                activeMatch: '/architecture/',
            },
            {
                text: '参考',
                link: '/reference/skills',
                activeMatch: '/reference/',
            },
            {
                text: '部署',
                link: '/deployment/github-packages',
                activeMatch: '/deployment/',
            },
            {
                text: 'v0.0.1',
                items: [
                    {
                        text: '更新日志',
                        link: 'https://github.com/vextjs/devcodex/blob/main/CHANGELOG.md',
                    },
                    {
                        text: 'v4 → v5 迁移',
                        link: '/guide/migration',
                    },
                ],
            },
        ],
        sidebar: {
            '/guide/': [
                {
                    text: '开始',
                    items: [
                        { text: '介绍', link: '/guide/introduction' },
                        { text: '快速开始', link: '/guide/quick-start' },
                        { text: '安装配置', link: '/guide/installation' },
                        { text: 'v4 → v5 迁移', link: '/guide/migration' },
                    ],
                },
                // 核心概念文档计划在 v0.1.0 补充（unified-agent/workflow-routing/tiers/safety）
            ],
            '/architecture/': [
                {
                    text: '架构设计',
                    items: [
                        { text: '架构总览', link: '/architecture/overview' },
                        // plugin-model / skills-system / mcp 计划在 v0.1.0 补充
                    ],
                },
            ],
            '/reference/': [
                {
                    text: '参考',
                    items: [
                        { text: 'Skills 清单', link: '/reference/skills' },
                        // instructions / prompts / cli 参考文档计划在 v0.1.0 补充
                    ],
                },
            ],
            '/deployment/': [
                {
                    text: '部署',
                    items: [
                        { text: 'GitHub Packages', link: '/deployment/github-packages' },
                        { text: 'Auth Server（VextJS）', link: '/deployment/auth-server' },
                    ],
                },
            ],
        },
        socialLinks: [
            {
                icon: 'github',
                mode: 'link',
                content: 'https://github.com/vextjs/devcodex',
            },
        ],
        footer: {
            message: 'Released under the AGPL-3.0 License.',
            copyright: 'Copyright © 2024-present VextJS',
        },
    },
});
