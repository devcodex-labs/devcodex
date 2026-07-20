import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from '@rspress/core';
import pluginMermaid from 'rspress-plugin-mermaid';

function readVersion(fileName: string) {
    const filePath = path.join(__dirname, '..', fileName);
    return JSON.parse(fs.readFileSync(filePath, 'utf8')).version as string;
}

const packageVersion = readVersion('package.json');
const pluginVersion = readVersion('plugin.json');

if (packageVersion !== pluginVersion) {
    throw new Error(`Version mismatch: package.json=${packageVersion}, plugin.json=${pluginVersion}`);
}

const currentVersionLabel = `v${packageVersion}`;

export default defineConfig({
    root: path.join(__dirname, 'docs'),
    base: '/devcodex/',
    title: 'DevCodex',
    icon: '/favicon.svg',
    description: 'Copilot / Claude Code 双主支持升级到 Codex 三宿主支持的 AI 辅助开发规范体系',
    outDir: 'dist',
    plugins: [pluginMermaid()],
    themeConfig: {
        nav: [
            { text: '使用介绍', link: '/intro/', activeMatch: '/intro/' },
            { text: '维护者指南', link: '/guide/', activeMatch: '/guide/' },
            { text: '规范与流程', link: '/specs/directory-structure', activeMatch: '/specs/' },
            {
                text: currentVersionLabel,
                items: [
                    { text: '版本归档', link: '/versions/' },
                    { text: 'CHANGELOG', link: 'https://github.com/vextjs/devcodex/blob/main/CHANGELOG.md' },
                    { text: 'Releases', link: 'https://github.com/vextjs/devcodex/releases' },
                ],
            },
        ],
        sidebar: {
            '/guide/': [
                {
                    text: '维护者指南',
                    items: [
                        { text: '概述', link: '/guide/' },
                        { text: 'Profile 使用指南', link: '/guide/profile' },
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
                        { text: 'Grok 与 Codex 宿主对齐', link: '/intro/host-parity-grok' },
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
                                    text: '① 预检查流程图',
                                    link: '/specs/precheck-flow',
                                    items: [
                                        { text: 'PC4 规范雷达流程图', link: '/specs/spec-radar-flow' },
                                    ],
                                },
                                {
                                    text: '② 安全检查流程图',
                                    link: '/specs/safety-check-flow',
                                    items: [
                                        { text: '② 阻断并给出合规替代流程图', link: '/specs/block-op-flow' },
                                    ],
                                },
                                { text: '③ 写入摘要流程图', link: '/specs/summary-flow' },
                                { text: '④ 检索记忆流程图', link: '/specs/memory-retrieval-flow' },
                                { text: '⑤ 前置状态汇总流程图', link: '/specs/pre-state-summary-flow' },
                                { text: '⑥ 开发阶段合规检查流程图', link: '/specs/dev-compliance-flow' },
                                { text: '⑦ 路由到工作流流程图', link: '/specs/routing-flow' },
                                { text: '⑧ 工作流执行流程图', link: '/specs/workflow-execution-flow' },
                                { text: '⑨ 执行阶段合规检查流程图', link: '/specs/exec-compliance-flow' },
                                { text: '⑩ 输出报告流程图', link: '/specs/report-output-flow' },
                                { text: '⑪ 更新记忆流程图', link: '/specs/memory-update-flow' },
                                { text: '⑫ 完成前合规检查流程图', link: '/specs/completion-compliance-flow' },
                            ],
                        },
                        {
                            text: '合规检查框架',
                            link: '/specs/compliance-framework',
                            collapsed: false,
                            items: [
                                { text: '⑥ 开发阶段合规检查流程图', link: '/specs/dev-compliance-flow' },
                                { text: '⑨ 执行阶段合规检查流程图', link: '/specs/exec-compliance-flow' },
                                { text: '⑫ 完成前合规检查流程图', link: '/specs/completion-compliance-flow' },
                            ],
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
                            text: '1.0.1',
                            collapsed: false,
                            items: [
                                { text: '版本概述', link: '/versions/v1/1.0.1/' },
                                { text: '需求变更日志', link: '/versions/v1/1.0.1/CHANGELOG' },
                                { text: '需求总览', link: '/versions/v1/1.0.1/requirements/' },
                                { text: '意图驱动的上下文按需加载', link: '/versions/v1/1.0.1/requirements/p0/intent-driven-context-loading' },
                                { text: '项目侧执行链性能与任务续接', link: '/versions/v1/1.0.1/requirements/p0/project-execution-chain-performance' },
                                { text: '模板边界与开发流程收口', link: '/versions/v1/1.0.1/requirements/p1/template-flow-alignment/' },
                                { text: '可配置并发执行策略', link: '/versions/v1/1.0.1/requirements/p1/concurrency-policy/' },
                                { text: '全局默认 Auto 别名', link: '/versions/v1/1.0.1/requirements/p1/global-auto-alias/' },
                                { text: '泄漏风险稳定性压测', link: '/versions/v1/1.0.1/requirements/p1/leak-risk-stability-pressure/' },
                                { text: '前端体验质量门禁', link: '/versions/v1/1.0.1/requirements/p1/frontend-experience-quality/' },
                                { text: '剩余 data 吸纳守门扩展', link: '/versions/v1/1.0.1/requirements/p1/data-absorption-guard-extensions/' },
                                { text: '最新 data 吸纳守门补强', link: '/versions/v1/1.0.1/requirements/p1/latest-data-absorption-guards/' },
                            ],
                        },
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
                                            text: 'P1 功能需求',
                                            collapsed: false,
                                            items: [
                                                {
                                                    text: '① 预检查',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/precheck/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/precheck/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/precheck/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '② 安全检查',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/safety-check/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/safety-check/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/safety-check/progress' },
                                                        {
                                                            text: '阻断并给出合规替代',
                                                            collapsed: true,
                                                            items: [
                                                                { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/block-op/' },
                                                                { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/block-op/design' },
                                                                { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/block-op/progress' },
                                                            ],
                                                        },
                                                    ],
                                                },
                                                {
                                                    text: '③ 写入摘要',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/summary/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/summary/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/summary/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '④ 检索记忆',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/memory-retrieval/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/memory-retrieval/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/memory-retrieval/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑤ 前置状态汇总',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/pre-state-summary/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/pre-state-summary/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/pre-state-summary/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑥ 开发阶段合规检查',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/dev-compliance/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/dev-compliance/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/dev-compliance/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑦ 路由到工作流',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/routing/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/routing/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/routing/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑧ 工作流执行',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/workflow-execution/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/workflow-execution/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/workflow-execution/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑨ 执行阶段合规检查',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/exec-compliance/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/exec-compliance/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/exec-compliance/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑩ 输出报告',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/report-output/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/report-output/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/report-output/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '⑪ 更新记忆',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/memory-update/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/memory-update/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/memory-update/progress' },
                                                    ],
                                                },
                                                {
                                                    text: 'Agent 双模式',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/agent-modes/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '变更护栏',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/change-guardrails/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/change-guardrails/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/change-guardrails/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '存储规范',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/storage-spec/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '记忆恢复与 Resume',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/memory-resume/progress' },
                                                    ],
                                                },
                                                {
                                                    text: '宿主生命周期硬门禁',
                                                    collapsed: true,
                                                    items: [
                                                        { text: '需求概况', link: '/versions/v1/1.0.0/requirements/p1/host-lifecycle-gates/' },
                                                        { text: '技术方案', link: '/versions/v1/1.0.0/requirements/p1/host-lifecycle-gates/design' },
                                                        { text: '实施进度', link: '/versions/v1/1.0.0/requirements/p1/host-lifecycle-gates/progress' },
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            text: 'P2 实现规范',
                                            collapsed: true,
                                            items: [
                                                { text: 'Agent 路由', link: '/versions/v1/1.0.0/requirements/p2/agents' },
                                                { text: '全局 Instructions', link: '/versions/v1/1.0.0/requirements/p2/instructions' },
                                                { text: '核心 Skills', link: '/versions/v1/1.0.0/requirements/p2/skills-core' },
                                                { text: '路由 Skills', link: '/versions/v1/1.0.0/requirements/p2/skills-routing' },
                                                { text: 'dev Skills', link: '/versions/v1/1.0.0/requirements/p2/skills-dev' },
                                                { text: 'fix Skills', link: '/versions/v1/1.0.0/requirements/p2/skills-fix' },
                                                { text: 'audit Skills', link: '/versions/v1/1.0.0/requirements/p2/skills-audit' },
                                                { text: 'analyze Skills', link: '/versions/v1/1.0.0/requirements/p2/skills-analyze' },
                                                { text: 'self-fix + token', link: '/versions/v1/1.0.0/requirements/p2/skills-self-fix' },
                                                { text: 'prompts + data', link: '/versions/v1/1.0.0/requirements/p2/prompts' },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    text: '实施计划',
                                    collapsed: true,
                                    items: [
                                        { text: '实施总览', link: '/versions/v1/1.0.0/requirements/implementation/' },
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
                                { text: '一期正式方案包', link: '/versions/v2/2.0.0/formal-solution-package' },
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
            message: 'DevCodex official documentation — user guides, specifications, and maintainer references',
            copyright: 'Copyright © 2024-present VextJS',
        },
    },
});
