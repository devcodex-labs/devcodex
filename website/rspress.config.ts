import * as path from 'node:path';
import { defineConfig } from '@rspress/core';
import pluginMermaid from 'rspress-plugin-mermaid';

export default defineConfig({
    root: path.join(__dirname, 'docs'),
    base: '/devcodex/',
    title: 'DevCodex',
    icon: '/favicon.svg',
    description: 'GitHub Copilot Agent Plugin — AI 辅助开发规范体系',
    outDir: 'dist',
    plugins: [pluginMermaid()],
    themeConfig: {
        nav: [
            { text: '介绍', link: '/intro/', activeMatch: '/intro/' },
            { text: '工作指南', link: '/guide/', activeMatch: '/guide/' },
            { text: '规范与流程', link: '/specs/directory-structure', activeMatch: '/specs/' },
            { text: '版本', link: '/versions/', activeMatch: '/versions/' },
        ],
        sidebar: {
            '/guide/': [
                {
                    text: '工作指南',
                    items: [
                        { text: '概述', link: '/guide/' },
                        { text: '需求管理', link: '/guide/requirements' },
                        { text: '开发规范', link: '/guide/development' },
                        { text: '版本与发布', link: '/guide/release' },
                    ],
                },
            ],
            '/intro/': [
                {
                    text: '项目介绍',
                    items: [
                        { text: '什么是 DevCodex', link: '/intro/' },
                        { text: '设计理念', link: '/intro/philosophy' },
                        { text: '套餐与定价', link: '/intro/pricing' },
                    ],
                },
            ],
            '/specs/': [
                {
                    text: '永久规范',
                    items: [
                        { text: '目录结构规范', link: '/specs/directory-structure' },
                        {
                            text: '主流程图',
                            link: '/specs/flowcharts',
                            collapsed: false,
                            items: [
                                {
                                    text: '预检查流程图',
                                    link: '/specs/precheck-flow',
                                },
                                { text: '安全检查流程图', link: '/specs/safety-check-flow' },
                                { text: '阻断并给出合规替代流程图', link: '/specs/block-op-flow' },
                                { text: '写入摘要流程图', link: '/specs/summary-flow' },
                                { text: '检索记忆流程图', link: '/specs/memory-retrieval-flow' },
                                { text: '前置状态汇总流程图', link: '/specs/pre-state-summary-flow' },
                            ],
                        },
                        {
                            text: '合规检查框架',
                            link: '/specs/compliance-framework',
                            collapsed: false,
                            items: [{ text: '开发阶段合规检查流程图', link: '/specs/dev-compliance-flow' }],
                        },
                    ],
                },
            ],
            '/versions/': [
                {
                    text: '版本列表',
                    link: '/versions/',
                },
                {
                    text: 'v1 系列',
                    collapsed: false,
                    items: [
                        { text: '系列概览', link: '/versions/v1/' },
                        {
                            text: '1.0.0',
                            collapsed: false,
                            items: [
                                { text: '版本概述', link: '/versions/v1/1.0.0/' },
                                { text: '需求变更日志', link: '/versions/v1/1.0.0/CHANGELOG' },
                                {
                                    text: '需求文档',
                                    collapsed: false,
                                    items: [
                                        { text: '需求总览', link: '/versions/v1/1.0.0/requirements/' },
                                        {
                                            text: 'P0 核心需求',
                                            collapsed: true,
                                            items: [
                                                { text: '根骨架', link: '/versions/v1/1.0.0/requirements/p0/root' },
                                                { text: '项目信息 profile', link: '/versions/v1/1.0.0/requirements/p0/profile' },
                                                { text: '执行流程骨架', link: '/versions/v1/1.0.0/requirements/p0/execution-flow' },
                                                { text: '文档站 website', link: '/versions/v1/1.0.0/requirements/p0/website' },
                                            ],
                                        },
                                        {
                                            text: 'P1 基础需求',
                                            collapsed: false,
                                            items: [
                                                {
                                                    text: 'Agent 双模式',
                                                    collapsed: false,
                                                    items: [
                                                        { text: '需求定义', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/design' },
                                                        { text: '实施计划', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/plan' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/progress' },
                                                        { text: '关键决策', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/decisions' },
                                                    ],
                                                },
                                                {
                                                    text: '存储规范',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求定义', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/design' },
                                                        { text: '实施计划', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/plan' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/progress' },
                                                        { text: '关键决策', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/decisions' },
                                                    ],
                                                },
                                                {
                                                    text: '记忆恢复 & Resume',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求定义', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/design' },
                                                        { text: '实施计划', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/plan' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/progress' },
                                                        { text: '关键决策', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/decisions' },
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            text: 'P2 功能需求',
                                            collapsed: true,
                                            items: [
                                                { text: 'agents/', link: '/versions/v1/1.0.0/requirements/p2/agents' },
                                                { text: 'instructions/', link: '/versions/v1/1.0.0/requirements/p2/instructions' },
                                                { text: 'skills/ 核心', link: '/versions/v1/1.0.0/requirements/p2/skills-core' },
                                                { text: 'skills/ 路由', link: '/versions/v1/1.0.0/requirements/p2/skills-routing' },
                                                { text: 'skills/ dev', link: '/versions/v1/1.0.0/requirements/p2/skills-dev' },
                                                { text: 'skills/ fix', link: '/versions/v1/1.0.0/requirements/p2/skills-fix' },
                                                { text: 'skills/ audit', link: '/versions/v1/1.0.0/requirements/p2/skills-audit' },
                                                { text: 'skills/ analyze', link: '/versions/v1/1.0.0/requirements/p2/skills-analyze' },
                                                { text: 'skills/ self-fix & cross', link: '/versions/v1/1.0.0/requirements/p2/skills-self-fix' },
                                                { text: 'prompts & hooks & data', link: '/versions/v1/1.0.0/requirements/p2/prompts' },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    text: '发布',
                                    collapsed: false,
                                    items: [
                                        { text: '发布前检查清单', link: '/versions/v1/1.0.0/release/checklist' },
                                        { text: '开发验证规范', link: '/versions/v1/1.0.0/release/validation' },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    text: 'v2 系列',
                    collapsed: true,
                    items: [
                        { text: '系列概览', link: '/versions/v2/' },
                        {
                            text: '2.0.0',
                            collapsed: true,
                            items: [
                                { text: '路线图', link: '/versions/v2/2.0.0/' },
                            ],
                        },
                    ],
                },
            ],
        },
        socialLinks: [
            { icon: 'github', mode: 'link', content: 'https://github.com/vextjs/devcodex' },
        ],
        footer: {
            message: 'Private Project — DevCodex pre-development documentation',
            copyright: 'Copyright © 2024-present VextJS',
        },
    },
});

