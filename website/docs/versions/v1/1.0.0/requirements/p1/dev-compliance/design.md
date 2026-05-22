# ⑥ 开发阶段合规检查 — 技术方案

> ⚠️ 历史快照说明：本页保留 `1.0.0` 阶段的开发合规技术方案。当时预检查只覆盖 PC0~PC3；当前版本已扩展为 PC0~PC7，实际规则以 `instructions/17-compliance.instructions.md` 和永久规范页 `website/docs/specs/precheck-flow.md` 为准。

> **需求来源**：[⑥ 开发阶段合规检查 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

通过 `instructions/17-compliance.instructions.md` 定义 dev 模式预检查块，保留 `PC0~PC3` 编号，并补齐上下文、意图、会话状态、执行准备四类信息。

---

## 核心设计

**预检查状态块**（仅 dev 模式，来自 `17-compliance.instructions.md`）：

- **PC0 上下文**：项目、输出语言、Profile 是否已加载
- **PC1 意图**：用户意图 → 工作流 / 子类型
- **PC2 会话状态**：轮次、待跟进事项、Token 关注区提示
- **PC3 执行准备**：是否存在 🔄 未完成任务、产物落点是否已确定

**用户面边界**：预检查块只输出自然语言状态，不直出内部 filePath。

通过 → 进入 ⑦ 路由  
不通过 → 尝试补齐 → 仍不够 → 回退 chat 或终止

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `prompts/precheck-status.prompt.md` | 用户面预检查模板 |
| `instructions/17-compliance.instructions.md` | 预检查状态块格式 |

---

## 风险与约束

- 此节点是路由前最后一道门，检查项不得减少
- ENV_MODE=dev 时全量执行合规检查
