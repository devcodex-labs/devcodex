---
applyTo: **
---
# 开发工作流规则（10-dev）

> 本 Instructions 与 `agents/devcodex.agent.md` 关联，在 dev 工作流激活时由平台自动注入。

## 核心约束

### 子类型路由
- 进入 dev 工作流前，必须通过 `intent` Skill 三问法确认子类型（8类）
- optimization/scenario-test 前置条件：`api-verification` 已通过，否则阻断并提示

### C12 合理性评估（必须执行）
- 有更好方案 → 提出并等待确认后再执行
- 明显不合理 → 先指出问题再等用户澄清
- 不得在 C12 前直接开始编码

### CP 流程约束（C02 — 严格按序，不可跳过或合并）
```
CP1（需求确认）→ CP2（方案确认）→ plan-review → [impact-review] → CP3（实施计划）→ 执行
```

- CP1：AI 输出需求理解，等待用户确认（模板：`prompts/requirement.prompt.md`）
- CP2：AI 输出技术方案，等待用户确认（模板：`prompts/technical-design.prompt.md`；docs 子类型输出文档大纲）
- plan-review：非 docs/plan-review 子类型后必须执行（阻断时回 CP2 重确认）
- CP3：AI 输出实施计划，等待用户确认（模板：`prompts/implementation-plan.prompt.md`）

### 子类型豁免规则
- **docs 子类型**：豁免 plan-review 和 impact-review
- **plan-review 子类型**：豁免 plan-review（自身即为方案评审）
- 豁免须在子类型 Skill 文档中明确声明

### 执行约束
- 逐文件执行，编码后必须运行 lint/typecheck/test
- error 最多 2 次迭代；2 次仍失败 → 停止，输出错误摘要标 ⚠️ 等待用户决策
- optimization/scenario-test：按各子类型 Skill 多步骤流程执行（非单次工具运行）

### 执行后检查
- 涉及 HTTP 接口变更 → 调用 `api-verification` Skill
- 涉及源码/配置文件变更 → 调用 `document-sync` Skill

### 影响评估触发条件（IMPACT_REVIEW）
- **仅**由 PR-5②"跨模块架构依赖变更"触发
- PR-5① 对外接口变更 → EXEC 后走 api-verification（不进 impact-review）
- PR-5③ 数据库 Schema 变更 → 走 dev-database Skill（不进 impact-review）

### 代码风格
- dev 工作流进入前必须读取项目 `profile/03-代码风格.md`
- 项目 profile 优先于默认值

### 重构 vs 优化边界
- 重构（refactor）≡ 结构/可读性变更，不改变功能行为
- 优化（optimization）≡ 功能行为不变，提升性能/资源使用
- 有疑问时优先走重构路径（流程更严格）
