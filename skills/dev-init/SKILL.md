---
name: dev-init
description: 项目初始化子类型规范 — 新项目/模块脚手架 + Profile 自动生成
---
# Dev Init Skill

## 触发条件

用户要求初始化新项目、新模块、新仓库，典型场景：从零搭建项目脚手架、初始化 monorepo 子包、创建新服务模板。

## 执行流程

| 步骤 | 动作 |
|------|------|
| 1 | 收集项目信息：名称/技术栈/包管理器/团队规范 |
| 2 | CP1：确认技术栈选型和目录结构 |
| 3 | CP2：确认依赖清单和配置文件方案 |
| 4 | 生成脚手架：目录结构 + 配置文件 + 基础文件 |
| 5 | 自动生成 Profile：`.devcodex/profile/` |
| 6 | 初始化 Git + CHANGELOG + README |

## Profile 自动生成

init 完成后**必须**在 `.devcodex/profile/` 创建：
- `README.md` — 项目概述
- `01-项目信息.md` — 技术栈/仓库地址
- `02-架构约束.md` — 目录结构/模块边界
- `03-代码风格.md` — 编码规范

## 关键规则

- 跳过 CP3（init 无需实施计划阶段）；同时豁免 `dev-plan-review`（CP3 已跳过，质量门禁不适用）；必须记录 `CP3: N/A（init 子类型豁免）`，供 hook/fallback 区分合法豁免与漏确认
- 生成的 .gitignore 必须包含 `.devcodex/.memory/`（记忆文件不入版本库）
- 依赖选型遵循项目 profile 中的技术栈约束（若已有 profile）
