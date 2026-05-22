# ① 预检查 — 技术方案

> **需求来源**：[① 预检查需求概况](./index)  
> **状态**：✅ 已完成  
> **关联**：[实施进度](./progress)

---

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的预检查技术方案。当时文档中的 PC0~PC4、`<project> = null` 和 Hook 触发描述仅用于追溯；当前实现以 `17-compliance.instructions.md` 的 PC0~PC7、项目未识别阻断和 `website/docs/specs/precheck-flow.md` 为准。

## 方案概述

预检查的**语义规则**在 `1.0.0` 阶段由 `17-compliance.instructions.md` 的 PC0~PC4、`01-common.instructions.md` 的 Profile / 路由规则，以及 `intent` / `load-profile` Skill 共同定义；当前版本已演进为 PC0~PC7。

---

## 核心设计

按 `1.0.0` 阶段的 Instructions-First + Hook-First/Fallback 结构，预检查主链为：

1. **读取规则基线** — 加载 `00-safety.instructions.md`（S01~S06）+ `01-common.instructions.md`（C01~C15）+ `02-output-paths.instructions.md`
2. **识别意图** — 调用 `intent` Skill（前置识别 → 三问法 → 意图类型）
3. **加载基础 profile** — 调用 `load-profile` Skill（确定 `<project>` → 加载 `.devcodex/profile/`）
4. **读取会话记忆** — 按 `15-memory.instructions.md` 的读取顺序加载 SUMMARY 与今日/昨日任务文件
5. **输出 PC0~PC4 状态块** — 由 `17-compliance.instructions.md` 定义预检查输出格式与 dev 模式强制性；当前版本为 PC0~PC7
6. **确定产物落点** — 根据意图 + 项目，按 `02-output-paths.instructions.md` 解析产物目录

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `instructions/17-compliance.instructions.md` | `1.0.0` 阶段 PC0~PC4 预检查入口与输出格式；当前为 PC0~PC7 |
| `instructions/15-memory.instructions.md` | 记忆读取顺序 |
| `skills/intent/SKILL.md` | 意图识别（前置识别 + 三问法）|
| `skills/load-profile/SKILL.md` | profile 加载（项目确定 + 配置读取）|
| `instructions/00-safety.instructions.md` | 安全底线 S01~S06 |
| `instructions/01-common.instructions.md` | 通用规范 C01~C15 |
| `instructions/02-output-paths.instructions.md` | 产物路径规范 |
| `.github/hooks/*.json` | 宿主支持 Hooks 时提供触发时机硬门禁 |

---

## 风险与约束

- 规则基线加载失败时走降级路径，不得编造规范（S03）
- `1.0.0` 阶段曾允许 `load-profile` 无法确定项目时 `<project> = null` 并跳过加载；当前版本必须先询问用户确认项目
- 产物落点必须在此阶段明确，后续节点不可重新判断
