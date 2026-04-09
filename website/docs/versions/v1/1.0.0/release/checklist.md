# 发布前检查清单

> **优先级**：P1  
> **状态**：🔄 持续更新  
> **关联**：所有需求文件

---

## 概述

DevCodex v1.0.0 是私有项目，发布指"部署到 `E:\MySelf\.github\` 可稳定使用"。  
本清单定义发布前必须完成的所有工作项。

---

## P0：核心功能（必须完成才能使用）

### Agent

- [ ] `agents/devcodex.agent.md` （当前 v0.03 是中文）
- [ ] `description` 字段符合官方 "Use when..." 格式
- [ ] `tools` 列表与实际使用的工具一致

### Instructions（11 个）

- [ ] `00-safety.instructions.md` — 安全底线
- [ ] `01-common.instructions.md` — 通用规范（包含全自动模式 C02 豁免条件）
- [ ] `02-output-paths.instructions.md` — 路径规范
- [ ] `10-dev.instructions.md` — dev 工作流规范
- [ ] `11-fix.instructions.md` — fix 工作流规范
- [ ] `12-audit.instructions.md` — audit 工作流规范
- [ ] `13-analyze.instructions.md` — analyze 工作流规范
- [ ] `14-self-fix.instructions.md` — self-fix 工作流规范
- [ ] `15-memory.instructions.md` — 记忆规范（含新会话加载逻辑）
- [ ] `16-report.instructions.md` — 报告规范
- [ ] `17-compliance.instructions.md` — 合规检查规范

### Skills（核心 7 个）

- [ ] `compliance/SKILL.md` — 合规检查（SC/FC/RC）
- [ ] `memory/SKILL.md` — 记忆读写
- [ ] `report/SKILL.md` — 报告生成
- [ ] `cp-gate/SKILL.md` — CP 流程门控（含全自动模式分支）
- [ ] `intent/SKILL.md` — 意图识别
- [ ] `summary/SKILL.md` — 会话摘要
- [ ] `plan/SKILL.md` — 规划工作流

---

## P1：主要功能（核心工作流可用）

### Skills（路由 + dev + fix）

- [ ] `routing/SKILL.md`
- [ ] `load-profile/SKILL.md`
- [ ] `dev-default/SKILL.md`
- [ ] `dev-docs/SKILL.md`
- [ ] `dev-refactor/SKILL.md`
- [ ] `dev-plan-review/SKILL.md`
- [ ] `fix-default/SKILL.md`

### 记忆与 Resume 功能

- [ ] 新会话预检查块输出正确（含 🔄 待续任务提示）
- [ ] `resume` 工作流正确恢复中断任务
- [ ] TASK-INDEX.md 自动维护

### 存储规范

- [ ] `.devcodex/` 目录结构正确创建
- [ ] `.gitignore` 包含 `.devcodex/.memory/`
- [ ] `data/violations.md` 模板存在
- [ ] `data/pending-fixes.md` 模板存在

### Hooks

- [ ] `devcodex-hooks.json` 事件名使用新格式（`UserPromptSubmit` / `Stop`）✅ 已完成

### Agent 双模式

- [ ] 确认模式（默认）CP 流程正常
- [ ] 选择 `@devcodex-auto` 可触发全自动模式
- [ ] 全自动模式下安全底线仍触发

---

## P2：完整功能（全工作流可用）

### Skills（audit + analyze + self-fix + cross）

- [ ] `audit-common/SKILL.md` 及 8 个子类型
- [ ] `analyze-research/SKILL.md`
- [ ] `self-fix-auto/SKILL.md`
- [ ] `token-check/SKILL.md`
- [ ] 其余 dev/fix 子类型 Skills

### 验证

- [ ] `scripts/validate.js` 结构验证脚本完成
- [ ] B1~B6 行为验证场景全部通过（见 [dev-validation.md](./validation)）

---

## P3：优化与准备

### v2.0.0 准备

- [ ] `memory` Skill 操作封装完整（存储层预留接口）
- [ ] `report` Skill 操作封装完整
- [ ] 存储根路径从 profile 读取而非硬编码

### CHANGELOG

- [ ] `CHANGELOG.md` 首版条目按 monSQLize 格式填写
- [ ] `changelogs/v1.0.0.md` 详细变更记录

---

## 已完成项

| 日期 | 完成内容 |
|------|---------|
| 2026-04-04 | v0.03 Skills 结构修复（扁平化 + name 字段修正，34 个）|
| 2026-04-04 | `E:\MySelf\.github\` 重建（从 v0.03 同步）|
| 2026-04-04 | Hooks 事件名修复（`UserPromptSubmit` / `Stop`）|
| 2026-04-04 | `directory-structure.md` 官方标准规范文档完成 |
| 2026-04-04 | 需求文档框架搭建（agent-modes / dev-validation / storage-spec / memory-resume / v2-roadmap）|
