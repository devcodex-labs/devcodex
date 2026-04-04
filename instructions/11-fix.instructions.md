---
applyTo: **
---
# 修复工作流规则（11-fix）

> 本 Instructions 与 `agents/fix.agent.md` 关联，在 fix 工作流激活时由平台自动注入。

## 核心约束

### 子类型路由
- 进入 fix 工作流前，通过 `intent` Skill 确认子类型（default/incident/security）
- 三类均从读取代码风格开始

### C12 合理性评估（必须执行）
- 有更好建议先提出，确认后再执行

### CP 流程约束（C02）
```
CP1（问题确认）→ CP2（方案确认）→ [impact-review] → 执行 → [CP3]
```

- CP1：AI 输出问题分析（根因 + 影响范围），用户确认（模板：`prompts/problem-analysis.prompt.md`）
- CP2：AI 输出修复方案，用户确认
- impact-review：涉及跨模块架构依赖变更（PR-5②）时执行
- CP3：**≥5 文件变更 或 含高风险操作时必须**；其他可选

**高风险操作**：DDL 变更 / 配置文件变更（.env/package.json/CI）/ 文件删除 / 直接影响生产环境的修改

### 修复三步必做（执行后立即扫描，SC3 强制）

1. **同类全局扫描** — 同一模式错误是否存在于其他位置
2. **数据联动扫描** — 上下游数据流是否受影响
3. **grep 零残留复核** — 确认无残留引用

> ⛔ 这三步不可省略。SC3 检查项会验证是否执行。

### 执行约束
- 编码后必须运行 lint/typecheck/test；error 最多 2 次迭代
- 2 次仍失败 → 停止，输出错误摘要标 ⚠️

### 执行后检查
- 涉及 HTTP 接口变更 → 调用 `api-verification` Skill
- 涉及源码/配置文件变更 → 调用 `document-sync` Skill

### 影响评估触发条件
- 仅由 PR-5②"跨模块架构依赖变更"触发
- 对外接口变更 → api-verification；不进 impact-review

### 代码风格
- fix 工作流进入前必须读取项目 `profile/03-代码风格.md`
