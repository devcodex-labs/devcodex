---
agent: agent
description: 交付物完整性检查清单 — 需求开发完成后验证所有必要产物均已到位
applyTo: .devcodex/**/requirements/**
---
# 交付物完整性检查清单

> **触发时机**：dev 工作流 N6 方案一致性验证完成后，在宣告任务完成前执行。

## 必须产物（F-12）

| # | 产物 | 路径规范 | 状态 |
|:-:|------|---------|:----:|
| 1 | 需求概述 | `.devcodex/**/requirements/<需求>/01-需求概述.md`（已有真相源必须 update；SimpleTaskFastPath 可 N/A） | ☐/N/A |
| 2 | 技术方案 | `.devcodex/**/requirements/<需求>/02-技术方案.md`（有架构/接口/设计决策时 create/update）| ☐/N/A |
| 3 | 实施计划 | `.devcodex/**/requirements/<需求>/04-实施计划.md`（CP3 触发时 create/update；轻路径或子类型豁免可 N/A） | ☐/N/A |
| 4 | 接口验证双产物 | `*-接口验证.http` + `*-接口验证.cjs`（有接口变更时；`.http` 须含 `@baseUrl` / `@token` / `@language` 标准变量）| ☐/N/A |
| 5 | 开发报告 | `.devcodex/**/requirements/<需求>/reports/<agent>/YYYYMMDD/NN--*.md`（无任务上下文时才回退到 `.devcodex/**/reports/requirements/...`） | ☐ |
| 6 | 记忆文件 | `.devcodex/**/.memory/clients/<agent>/tasks/YYYYMMDD.md` | ☐ |
| 7 | 需求级记忆 | `.devcodex/**/requirements/<需求>/.memory/sessions.md` | ☐ |

## 条件产物（F-17）

| # | 产物 | 触发条件 | 状态 |
|:-:|------|---------|:----:|
| 1 | 实施进度 | 跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面任务、模板-示例-校验链或部署同步联动；默认需 `04-实施计划.md`，CP3 豁免场景可用等价任务切片 / ContextHandoffCard | ☐/N/A |
| 2 | 行为核查清单 | 有多个业务规则需逐条验证时（使用 `behavior-checklist.prompt.md`）| ☐/N/A |
| 3 | Impact Review 报告 | PR-5② 跨模块架构依赖变更 | ☐/N/A |
| 4 | 数据库 Migration 文件 | 有 Schema 变更 | ☐/N/A |
| 5 | CHANGELOG 更新 | 任何源码/配置文件变更 | ☐ |
| 6 | README 更新 | 有安装步骤/API/配置变更 | ☐/N/A |
| 7 | .env.example 更新 | 有新增/修改/删除环境变量 | ☐/N/A |
| 8 | ExecutionContract | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | ☐/N/A |
| 9 | TestRoute | 跨模块、API、Hook/CLI、模板-示例-校验链或测试路线不明显 | ☐/N/A |
| 10 | ReleaseAudit | 发版前 review / publish 或 tag 前风险审查 | ☐/N/A |
| 11 | ReleaseVerification | 用户明确要求 tag / release / publish 或进入正式发版 | ☐/N/A |
| 12 | ConceptSyncMap | 控制面、模板-示例-校验链、README / website / Profile / validate / 部署副本联动 | ☐/N/A |
| 13 | HostContractVerification | Hook / CLI / visible reply / sticky project / workspace guard / bootstrap 相关任务 | ☐/N/A |
| 14 | OfficialDocsEvidence | 新增/升级依赖、框架、SDK、平台 API、外部模块或外部平台能力判断 | ☐/N/A |
| 15 | ProfileImpactCheck | 项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 变化 | ☐/N/A |

## 使用说明

1. 交付前逐行勾选；
2. 所有必须产物全部 ☐→✅；
3. 条件产物确认 N/A 是否成立（不成立须补充）；
4. 完成后在报告中记录 `delivery-checklist: ✅ 通过`。
