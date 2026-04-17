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
| 1 | 需求概述 | `.devcodex/requirements/<需求>/01-需求概述.md` | ☐ |
| 2 | 技术方案 | `.devcodex/requirements/<需求>/02-技术方案.md`（有设计决策时）| ☐/N/A |
| 3 | 实施计划 | `.devcodex/requirements/<需求>/04-实施计划.md` | ☐ |
| 4 | 接口验证双产物 | `*-接口验证.http` + `*-接口验证.cjs`（有接口变更时）| ☐/N/A |
| 5 | 开发报告 | `.devcodex/reports/requirements/<agent>/YYYYMMDD/NN--*.md` | ☐ |
| 6 | 记忆文件 | `.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md` | ☐ |
| 7 | 需求级记忆 | `.devcodex/requirements/<需求>/.memory/sessions.md` | ☐ |

## 条件产物（F-17）

| # | 产物 | 触发条件 | 状态 |
|:-:|------|---------|:----:|
| 1 | 行为核查清单 | 有多个业务规则需逐条验证时（使用 `behavior-checklist.prompt.md`）| ☐/N/A |
| 2 | Impact Review 报告 | PR-5② 跨模块架构依赖变更 | ☐/N/A |
| 3 | 数据库 Migration 文件 | 有 Schema 变更 | ☐/N/A |
| 4 | CHANGELOG 更新 | 任何源码/配置文件变更 | ☐ |
| 5 | README 更新 | 有安装步骤/API/配置变更 | ☐/N/A |
| 6 | .env.example 更新 | 有新增/修改/删除环境变量 | ☐/N/A |

## 使用说明

1. 交付前逐行勾选；
2. 所有必须产物全部 ☐→✅；
3. 条件产物确认 N/A 是否成立（不成立须补充）；
4. 完成后在报告中记录 `delivery-checklist: ✅ 通过`。
