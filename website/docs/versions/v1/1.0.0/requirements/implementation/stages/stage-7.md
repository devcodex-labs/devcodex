# Stage 7 — 子类型 Skills + Prompts 模板

> **主流程节点**：跨阶段（子类型执行 + 执行后验证 + 模板支撑）  
> **前置依赖**：Stage 1~6 全部完成  
> **状态**：✅ 已完成（2026-04-08）

---

## 目标

补全 Agent 引用的 34 个 Skills 中 Stage 0~6 未覆盖的 **23 个子类型/辅助 Skill** + v0.03 引用的 **20 个 prompts 模板**。

---

## Part A：子类型 Skills（23 个）

### A1. 授权门控

| # | 目标文件 | v0.03 参考 | 说明 |
|:-:|---------|-----------|------|
| 1 | `skills/token-check/SKILL.md` | [`v0.03/skills/token-check/SKILL.md`](../../v0.03/skills/token-check/SKILL.md) | 路由后调用，验证 Free/Pro 层级 |

### A2. dev 子类型 Skills（7 个）

| # | 目标文件 | v0.03 参考 | 说明 |
|:-:|---------|-----------|------|
| 2 | `skills/dev-refactor/SKILL.md` | [`v0.03/skills/dev-refactor/SKILL.md`](../../v0.03/skills/dev-refactor/SKILL.md) | 重构子类型 |
| 3 | `skills/dev-database/SKILL.md` | [`v0.03/skills/dev-database/SKILL.md`](../../v0.03/skills/dev-database/SKILL.md) | 数据库变更 ⚠️ Pro |
| 4 | `skills/dev-init/SKILL.md` | [`v0.03/skills/dev-init/SKILL.md`](../../v0.03/skills/dev-init/SKILL.md) | 项目初始化 |
| 5 | `skills/dev-optimization/SKILL.md` | [`v0.03/skills/dev-optimization/SKILL.md`](../../v0.03/skills/dev-optimization/SKILL.md) | 性能优化 ⚠️ Pro |
| 6 | `skills/dev-scenario-test/SKILL.md` | [`v0.03/skills/dev-scenario-test/SKILL.md`](../../v0.03/skills/dev-scenario-test/SKILL.md) | 场景测试 ⚠️ Pro |
| 7 | `skills/dev-docs/SKILL.md` | [`v0.03/skills/dev-docs/SKILL.md`](../../v0.03/skills/dev-docs/SKILL.md) | 文档撰写（豁免 plan-review） |
| 8 | `skills/dev-plan-review/SKILL.md` | [`v0.03/skills/dev-plan-review/SKILL.md`](../../v0.03/skills/dev-plan-review/SKILL.md) | 🔴 dev 强制门禁（PR-1~PR-6） |

### A3. fix 子类型 Skills（2 个）

| # | 目标文件 | v0.03 参考 | 说明 |
|:-:|---------|-----------|------|
| 9 | `skills/fix-incident/SKILL.md` | [`v0.03/skills/fix-incident/SKILL.md`](../../v0.03/skills/fix-incident/SKILL.md) | 线上事故 ⚠️ Pro |
| 10 | `skills/fix-security/SKILL.md` | [`v0.03/skills/fix-security/SKILL.md`](../../v0.03/skills/fix-security/SKILL.md) | 安全修复 ⚠️ Pro |

### A4. audit 相关 Skills（8 个）

| # | 目标文件 | v0.03 参考 | 说明 |
|:-:|---------|-----------|------|
| 11 | `skills/audit-common/SKILL.md` | [`v0.03/skills/audit-common/SKILL.md`](../../v0.03/skills/audit-common/SKILL.md) | 审查通用规则（目标类型识别 + 收敛规则） |
| 12 | `skills/audit-dimensions/SKILL.md` | [`v0.03/skills/audit-dimensions/SKILL.md`](../../v0.03/skills/audit-dimensions/SKILL.md) | 规范文件审查维度（D1~D20） |
| 13 | `skills/audit-tech-design/SKILL.md` | [`v0.03/skills/audit-tech-design/SKILL.md`](../../v0.03/skills/audit-tech-design/SKILL.md) | 技术方案审查（TD-1~TD-13） |
| 14 | `skills/audit-requirements/SKILL.md` | [`v0.03/skills/audit-requirements/SKILL.md`](../../v0.03/skills/audit-requirements/SKILL.md) | 需求文档审查（RQ-1~RQ-8） |
| 15 | `skills/audit-project/SKILL.md` | [`v0.03/skills/audit-project/SKILL.md`](../../v0.03/skills/audit-project/SKILL.md) | 项目工程审查（PE-1~PE-11）⚠️ Pro |
| 16 | `skills/audit-report/SKILL.md` | [`v0.03/skills/audit-report/SKILL.md`](../../v0.03/skills/audit-report/SKILL.md) | 报告审查（RA-1~RA-6） |
| 17 | `skills/audit-document/SKILL.md` | [`v0.03/skills/audit-document/SKILL.md`](../../v0.03/skills/audit-document/SKILL.md) | 通用文档审查（DA-1~DA-6） |
| 18 | `skills/audit-execution-guide/SKILL.md` | [`v0.03/skills/audit-execution-guide/SKILL.md`](../../v0.03/skills/audit-execution-guide/SKILL.md) | 审查执行指南 |

### A5. analyze / self-fix 子类型（2 个）

| # | 目标文件 | v0.03 参考 | 说明 |
|:-:|---------|-----------|------|
| 19 | `skills/analyze-research/SKILL.md` | [`v0.03/skills/analyze-research/SKILL.md`](../../v0.03/skills/analyze-research/SKILL.md) | 技术调研子类型 |
| 20 | `skills/self-fix-auto/SKILL.md` | [`v0.03/skills/self-fix-auto/SKILL.md`](../../v0.03/skills/self-fix-auto/SKILL.md) | 自动级修复（A1~A5 + V1~V6） |

### A6. 执行后验证 Skills（3 个）

| # | 目标文件 | v0.03 参考 | v4 参考 | 说明 |
|:-:|---------|-----------|--------|------|
| 21 | `skills/api-verification/SKILL.md` | [`v0.03/skills/api-verification/SKILL.md`](../../v0.03/skills/api-verification/SKILL.md) | [`v4/specs/api-verification.md`](../../../../ai-dev-guidelines/version/v4/specs/api-verification.md) | HTTP 接口变更后验证 |
| 22 | `skills/document-sync/SKILL.md` | [`v0.03/skills/document-sync/SKILL.md`](../../v0.03/skills/document-sync/SKILL.md) | [`v4/specs/document-sync.md`](../../../../ai-dev-guidelines/version/v4/specs/document-sync.md) | 源码/配置变更后文档同步 |
| 23 | `skills/impact-review/SKILL.md` | [`v0.03/skills/impact-review/SKILL.md`](../../v0.03/skills/impact-review/SKILL.md) | [`v4/specs/impact-review.md`](../../../../ai-dev-guidelines/version/v4/specs/impact-review.md) | 跨模块架构影响评估（六维框架） |

---

## Part B：Prompts 模板（20 个）

> v0.03 路径：`prompts/<name>.prompt.md`  
> v4 路径：`templates/<name>.md`  
> v1.0.0 路径：`prompts/<name>.prompt.md`（沿用 v0.03 命名）

| # | 目标文件 | v0.03 参考 | v4 参考 | 引用方 |
|:-:|---------|-----------|--------|-------|
| 1 | `prompts/agent-summary.prompt.md` | [`v0.03/prompts/agent-summary.prompt.md`](../../v0.03/prompts/agent-summary.prompt.md) | [`v4/templates/agent-summary.md`](../../../../ai-dev-guidelines/version/v4/templates/agent-summary.md) | [`memory`](../../skills/memory/SKILL.md) Skill |
| 2 | `prompts/api-verification.prompt.md` | [`v0.03/prompts/api-verification.prompt.md`](../../v0.03/prompts/api-verification.prompt.md) | [`v4/templates/api-verification.md`](../../../../ai-dev-guidelines/version/v4/templates/api-verification.md) | [`api-verification`](../../skills/api-verification/SKILL.md) Skill |
| 3 | `prompts/contributing.prompt.md` | [`v0.03/prompts/contributing.prompt.md`](../../v0.03/prompts/contributing.prompt.md) | [`v4/templates/contributing.md`](../../../../ai-dev-guidelines/version/v4/templates/contributing.md) | dev-init Skill |
| 4 | `prompts/cp-checklist.prompt.md` | [`v0.03/prompts/cp-checklist.prompt.md`](../../v0.03/prompts/cp-checklist.prompt.md) | [`v4/templates/cp-checklist.md`](../../../../ai-dev-guidelines/version/v4/templates/cp-checklist.md) | [`cp-gate`](../../skills/cp-gate/SKILL.md) Skill |
| 5 | `prompts/implementation-plan.prompt.md` | [`v0.03/prompts/implementation-plan.prompt.md`](../../v0.03/prompts/implementation-plan.prompt.md) | [`v4/templates/implementation-plan.md`](../../../../ai-dev-guidelines/version/v4/templates/implementation-plan.md) | dev CP3 |
| 6 | `prompts/implementation-progress.prompt.md` | [`v0.03/prompts/implementation-progress.prompt.md`](../../v0.03/prompts/implementation-progress.prompt.md) | [`v4/templates/implementation-progress.md`](../../../../ai-dev-guidelines/version/v4/templates/implementation-progress.md) | dev 05-实施进度 |
| 7 | `prompts/memory-session.prompt.md` | [`v0.03/prompts/memory-session.prompt.md`](../../v0.03/prompts/memory-session.prompt.md) | [`v4/templates/memory-session.md`](../../../../ai-dev-guidelines/version/v4/templates/memory-session.md) | [`summary`](../../skills/summary/SKILL.md) / [`memory`](../../skills/memory/SKILL.md) Skill |
| 8 | `prompts/precheck-status.prompt.md` | [`v0.03/prompts/precheck-status.prompt.md`](../../v0.03/prompts/precheck-status.prompt.md) | [`v4/templates/precheck-status.md`](../../../../ai-dev-guidelines/version/v4/templates/precheck-status.md) | ⑥ 预检查输出 |
| 9 | `prompts/problem-analysis.prompt.md` | [`v0.03/prompts/problem-analysis.prompt.md`](../../v0.03/prompts/problem-analysis.prompt.md) | [`v4/templates/problem-analysis.md`](../../../../ai-dev-guidelines/version/v4/templates/problem-analysis.md) | fix CP1 |
| 10 | `prompts/project-profile.prompt.md` | [`v0.03/prompts/project-profile.prompt.md`](../../v0.03/prompts/project-profile.prompt.md) | [`v4/templates/project-profile.md`](../../../../ai-dev-guidelines/version/v4/templates/project-profile.md) | [`load-profile`](../../skills/load-profile/SKILL.md) Skill |
| 11 | `prompts/project-readme.prompt.md` | [`v0.03/prompts/project-readme.prompt.md`](../../v0.03/prompts/project-readme.prompt.md) | [`v4/templates/project-readme.md`](../../../../ai-dev-guidelines/version/v4/templates/project-readme.md) | dev-init Skill |
| 12 | `prompts/reply-summary.prompt.md` | [`v0.03/prompts/reply-summary.prompt.md`](../../v0.03/prompts/reply-summary.prompt.md) | [`v4/templates/reply-summary.md`](../../../../ai-dev-guidelines/version/v4/templates/reply-summary.md) | C14 多任务进度快照 |
| 13 | `prompts/report-analysis.prompt.md` | [`v0.03/prompts/report-analysis.prompt.md`](../../v0.03/prompts/report-analysis.prompt.md) | [`v4/templates/report-analysis.md`](../../../../ai-dev-guidelines/version/v4/templates/report-analysis.md) | [`report`](../../skills/report/SKILL.md) Skill |
| 14 | `prompts/report-audit.prompt.md` | [`v0.03/prompts/report-audit.prompt.md`](../../v0.03/prompts/report-audit.prompt.md) | [`v4/templates/report-audit.md`](../../../../ai-dev-guidelines/version/v4/templates/report-audit.md) | [`report`](../../skills/report/SKILL.md) Skill |
| 15 | `prompts/report-dev.prompt.md` | [`v0.03/prompts/report-dev.prompt.md`](../../v0.03/prompts/report-dev.prompt.md) | [`v4/templates/report-dev.md`](../../../../ai-dev-guidelines/version/v4/templates/report-dev.md) | [`report`](../../skills/report/SKILL.md) Skill |
| 16 | `prompts/report-fix.prompt.md` | [`v0.03/prompts/report-fix.prompt.md`](../../v0.03/prompts/report-fix.prompt.md) | [`v4/templates/report-fix.md`](../../../../ai-dev-guidelines/version/v4/templates/report-fix.md) | [`report`](../../skills/report/SKILL.md) Skill |
| 17 | `prompts/requirement-session.prompt.md` | [`v0.03/prompts/requirement-session.prompt.md`](../../v0.03/prompts/requirement-session.prompt.md) | [`v4/templates/requirement-session.md`](../../../../ai-dev-guidelines/version/v4/templates/requirement-session.md) | [`memory`](../../skills/memory/SKILL.md) Skill |
| 18 | `prompts/requirement.prompt.md` | [`v0.03/prompts/requirement.prompt.md`](../../v0.03/prompts/requirement.prompt.md) | [`v4/templates/requirement.md`](../../../../ai-dev-guidelines/version/v4/templates/requirement.md) | dev CP1 |
| 19 | `prompts/technical-design.prompt.md` | [`v0.03/prompts/technical-design.prompt.md`](../../v0.03/prompts/technical-design.prompt.md) | [`v4/templates/technical-design.md`](../../../../ai-dev-guidelines/version/v4/templates/technical-design.md) | dev CP2 |
| 20 | `prompts/token-setup.prompt.md` | [`v0.03/prompts/token-setup.prompt.md`](../../v0.03/prompts/token-setup.prompt.md) | ❌ v4 无对应 | Token 设置 |

---

## 文件对照总表

| 类别 | 数量 | v0.03 参考 | 说明 |
|------|:----:|:---------:|------|
| 授权门控 | 1 | ✅ | token-check |
| dev 子类型 | 7 | ✅ | 含 🔴 dev-plan-review 强制门禁 |
| fix 子类型 | 2 | ✅ | incident + security (Pro) |
| audit 相关 | 8 | ✅ | 含 common + 6 维度 + execution-guide |
| analyze/self-fix | 2 | ✅ | research + auto |
| 执行后验证 | 3 | ✅ | api-verification + document-sync + impact-review |
| prompts 模板 | 20 | ✅ | 全部有 v0.03 对应 |
| **总计** | **43** | | |

---

## Stage 7 完成后的整体效果

Stage 0~7 全部完成后的文件总量：

```
agents/                          2 个（Stage 1）
skills/                         34 个（Stage 1:2 + Stage 3:2 + Stage 4:1 + Stage 5:4 + Stage 6:2 + Stage 7:23）
instructions/                   11 个（Stage 1:3 + Stage 3:1 + Stage 5:5 + Stage 6:2）
data/                            3 个（Stage 2）
prompts/                        20 个（Stage 7）
─────────────────────────────────
总计                            70 个文件
```

### ✅ 覆盖率达成

| 维度 | Stage 0~6 | Stage 7 后 | v0.03 总量 |
|------|:---------:|:---------:|:---------:|
| Skills | 11 (32%) | **34 (100%)** | 34 |
| Instructions | 11 (100%) | 11 (100%) | 11 |
| Prompts | 0 (0%) | **20 (100%)** | 20 |
| Data | 3 (100%) | 3 (100%) | 3 |
| Agents | 2 (200%) | 2 (200%) | 1 |

