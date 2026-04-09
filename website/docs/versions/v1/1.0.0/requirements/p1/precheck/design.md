# ① 预检查 — 技术方案

> **需求来源**：[① 预检查需求概况](./index)  
> **状态**：✅ 已完成  
> **关联**：[实施进度](./progress)

---

## 方案概述

预检查通过 `devcodex.agent.md` §① 内联实现，按固定五步序列执行，调用 `intent` 和 `load-profile` 两个 Skill。

---

## 核心设计

按 `devcodex.agent.md` §① 定义的五步序列：

1. **读取规则基线** — 加载 `00-safety.instructions.md`（S01~S06）+ `01-common.instructions.md`（C01~C15）+ `02-output-paths.instructions.md`
2. **识别意图** — 调用 `intent` Skill（前置识别 → 三问法 → 意图类型）
3. **加载基础 profile** — 调用 `load-profile` Skill（确定 `<project>` → 加载 `.devcodex/profile/`）
4. **按意图补充加载** — dev/fix 额外加载 `03-代码风格.md`；audit 额外加载 `02-架构约束.md`
5. **确定产物落点** — 根据意图 + 项目，按 `02-output-paths.instructions.md` 解析产物目录

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `agents/devcodex.agent.md` §① | 主流程入口，定义五步序列 |
| `skills/intent/SKILL.md` | 意图识别（前置识别 + 三问法）|
| `skills/load-profile/SKILL.md` | profile 加载（项目确定 + 配置读取）|
| `instructions/00-safety.instructions.md` | 安全底线 S01~S06 |
| `instructions/01-common.instructions.md` | 通用规范 C01~C15 |
| `instructions/02-output-paths.instructions.md` | 产物路径规范 |

---

## 风险与约束

- 规则基线加载失败时走降级路径，不得编造规范（S03）
- `load-profile` 无法确定项目时 `<project> = null`，跳过加载
- 产物落点必须在此阶段明确，后续节点不可重新判断
