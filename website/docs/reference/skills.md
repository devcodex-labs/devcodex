# Skills 清单

DevCodex v5 共有 **34 个 Skills**，分为 9 个类别。

## Core Skills（核心）

| Skill | 路径 | 职责 |
|-------|------|------|
| `intent` | `skills/core/intent/SKILL.md` | 语义识别用户意图，路由到工作流 |
| `cp-gate` | `skills/core/cp-gate/SKILL.md` | CP1→CP2→CP3 流程门禁管控 |
| `memory` | `skills/core/memory/SKILL.md` | 记忆文件读写（会话状态持久化）|
| `compliance` | `skills/core/compliance/SKILL.md` | SC1～SC13 合规检查 |
| `report` | `skills/core/report/SKILL.md` | 报告生成与写入 |
| `summary` | `skills/core/summary/SKILL.md` | Agent SUMMARY 更新 |
| `plan` | `skills/core/plan/SKILL.md` | 包装复杂多步骤任务规划 |

## Dev Skills（开发工作流）

| Skill | 路径 | 触发场景 |
|-------|------|---------|
| `dev-default` | `skills/dev/dev-default/SKILL.md` | 通用功能开发 |
| `dev-database` | `skills/dev/dev-database/SKILL.md` | Schema 变更、Migration、ORM |
| `dev-refactor` | `skills/dev/dev-refactor/SKILL.md` | 代码重构（不改功能行为）|
| `dev-optimization` | `skills/dev/dev-optimization/SKILL.md` | 性能优化 |
| `dev-init` | `skills/dev/dev-init/SKILL.md` | 项目初始化 |
| `dev-plan-review` | `skills/dev/dev-plan-review/SKILL.md` | CP2→CP3 方案质量门禁（PR-1~PR-6）|
| `dev-docs` | `skills/dev/dev-docs/SKILL.md` | 文档撰写 |
| `dev-scenario-test` | `skills/dev/dev-scenario-test/SKILL.md` | 场景测试 |

## Fix Skills（修复工作流）

| Skill | 路径 | 触发场景 |
|-------|------|---------|
| `fix-default` | `skills/fix/fix-default/SKILL.md` | 常规 Bug 修复 |
| `fix-incident` | `skills/fix/fix-incident/SKILL.md` | 线上事故响应 |
| `fix-security` | `skills/fix/fix-security/SKILL.md` | 安全漏洞修复 |

## Audit Skills（审计工作流）

| Skill | 路径 | 说明 |
|-------|------|------|
| `audit-common` | `skills/audit/audit-common/SKILL.md` | 公共维度 G1~G5（所有 audit 必执行）|
| `audit-dimensions` | `skills/audit/audit-dimensions/SKILL.md` | D1~D20 审查维度完整性汇总 |
| `audit-tech-design` | `skills/audit/audit-tech-design/SKILL.md` | 技术方案审查维度 |
| `audit-requirements` | `skills/audit/audit-requirements/SKILL.md` | 需求文档审查维度 |
| `audit-project` | `skills/audit/audit-project/SKILL.md` | 项目工程审查维度——需 Pro |
| `audit-report` | `skills/audit/audit-report/SKILL.md` | 报告文件审查维度 |
| `audit-document` | `skills/audit/audit-document/SKILL.md` | 通用文档审查维度 |
| `audit-execution-guide` | `skills/audit/audit-execution-guide/SKILL.md` | 实施指南审查维度 |

## Analyze Skills（分析工作流）

| Skill | 路径 | 触发场景 |
|-------|------|---------|
| `analyze-research` | `skills/analyze/analyze-research/SKILL.md` | 技术调研（多步骤）|

> 单轮快速分析（Free 层）由 DevCodex Agent 直接处理，无需独立 Skill 文件。

## Routing Skills（路由与加载）

| Skill | 路径 | 职责 |
|-------|------|------|
| `routing` | `skills/routing/routing/SKILL.md` | 工作流路由详细规则 |
| `load-profile` | `skills/routing/load-profile/SKILL.md` | 加载项目规范（`profile/`）|

## Self-fix Skills（规范自修复）

| Skill | 路径 | 职责 |
|-------|------|------|
| `self-fix-auto` | `skills/self-fix/self-fix-auto/SKILL.md` | A1～A5 级自动修复（错别字/断链/表格补行）|

## Cross Skills（跨工作流公共）

| Skill | 路径 | 职责 |
|-------|------|------|
| `impact-review` | `skills/cross/impact-review/SKILL.md` | 跨模块架构依赖变更影响评估 |
| `api-verification` | `skills/cross/api-verification/SKILL.md` | HTTP 接口变更验证 |
| `document-sync` | `skills/cross/document-sync/SKILL.md` | 关联文件同步检查 |

## Token Skills（授权）

| Skill | 路径 | 职责 |
|-------|------|------|
| `token-check` | `skills/token/token-check/SKILL.md` | Pro/Enterprise 商业授权验证 |
