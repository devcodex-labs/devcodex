# ⑥ 开发阶段合规检查 — 技术方案

> **需求来源**：[⑥ 开发阶段合规检查 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

通过 `devcodex.agent.md` §⑥ 内联实现 6 项预检查闸门 + 输出语言检测 + ENV_MODE 预检查状态块。

---

## 核心设计

按 `devcodex.agent.md` §⑥ 定义的 6 项检查：
1. 意图是否成立？
2. profile 是否完整？
3. 产物落点是否明确？
4. 执行前约束是否齐备？
5. 记忆冲突检测（是否有 🔄 未完成任务？）
6. 变更边界是否清晰？

**输出语言检测**：根据用户消息检测输出语言（中/英/混合），声明后整个会话遵循。

**预检查状态块**（仅 dev 模式，来自 `compliance` Skill §0 + `17-compliance.instructions.md`）：
- PC1 Token 轮次
- PC2 待跟进事项
- PC3 未完成任务

通过 → 进入 ⑦ 路由  
不通过 → 尝试补齐 → 仍不够 → 回退 chat 或终止

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `agents/devcodex.agent.md` §⑥ | 六项检查 + 语言检测 |
| `skills/compliance/SKILL.md` §0 | ENV_MODE 判断 + 预检查 |
| `instructions/17-compliance.instructions.md` | 预检查状态块格式 |

---

## 风险与约束

- 此节点是路由前最后一道门，检查项不得减少
- ENV_MODE=dev 时仅执行 FC4/FC5
