---
name: ux-interaction-architecture
description: UX 交互架构专家 Owner — 当任务涉及页面流程、信息架构、任务路径、交互状态、空/错/加载/恢复、可理解性、操作成本、键盘/无障碍触点或用户要求补充交互设计规范时使用；要求从用户任务和状态反馈闭环审查体验。
---

# UX Interaction Architecture Skill

## 定位

本 Skill 负责交互架构 Owner 视角。它关注用户如何完成任务、如何理解页面、如何在空态/错误/等待/返回/恢复中不断线，而不是只评价视觉好不好看。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 前端页面、后台工具、文档站、表单、列表、详情、编辑器、导航或多步骤流程 | 必须 |
| 用户提到交互设计、用户心智、是否能看懂、是否好用 | 必须 |
| 需要审查 loading、空态、错误、返回、缓存、保存、撤销、确认、批量操作 | 必须 |
| 纯后端内部接口，用户无直接交互路径 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `UxInteractionArchitectureGate` | 每个关键页面或工具必须绑定任务流、状态反馈和恢复路径 | 需求、页面结构、用户文档、截图、运行验证 |
| `TaskFlowContinuityGate` | 用户从入口到完成任务不应出现断点、空白或不可恢复状态 | taskFlow、navigation、returnPath |
| `StateFeedbackGate` | 空态、加载、保存、错误、成功、禁用、离线、过期和冲突状态必须有清楚反馈 | stateFeedback |
| `RecoveryPathGate` | 错误、返回、失败保存、超时和数据刷新必须有恢复动作 | emptyErrorRecovery |
| `InteractionCostGate` | 高频任务要减少重复输入、无意义确认和跳转成本 | interactionCost |
| `AccessibilityTouchpointGate` | 关键控件、焦点、键盘、语义、对比度和可读性不得破坏主路径 | accessibilityTouchpoints |

## 执行步骤

1. 建立用户任务流：入口、关键动作、分支、完成状态和退出路径。
2. 建立信息架构：导航、层级、命名、分组、默认视图、详情与列表关系。
3. 枚举状态反馈：空、加载、旧缓存、成功、错误、禁用、保存中、冲突、过期。
4. 审查恢复路径：返回不丢数据、刷新不空白、失败能重试、取消能恢复。
5. 审查操作成本：高频动作是否需要更少点击、批量能力、默认值或快捷路径。
6. 若前端实现存在，按 `test-router` 选择静态、组件、E2E 或截图验证；没有明确要求时不强制打开浏览器。

## 输出字段

```markdown
## UxInteractionArchitectureGate

| 字段 | 内容 |
|------|------|
| taskFlow | 入口 -> 动作 -> 反馈 -> 完成 / 退出 |
| informationArchitecture | 导航、层级、命名、分组和默认视图 |
| stateFeedback | 空态、加载、保存、错误、成功、禁用、冲突等状态 |
| emptyErrorRecovery | 空态/错误/返回/超时/刷新后的恢复路径 |
| interactionCost | 高频任务点击、输入、等待、确认和跳转成本 |
| accessibilityTouchpoints | 键盘、焦点、语义、对比、动态文本和可读性触点 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 详情返回列表后空白，只靠重新请求 | 先显示缓存或上次可用数据，再异步刷新 |
| 页面只有 loading，没有旧数据、空态或错误恢复 | 建立 stale-while-revalidate 和恢复动作 |
| 表单失败后清空用户输入 | 保留草稿，标出错误字段和重试方式 |
| 文档站导航按维护者目录堆叠 | 按用户任务、配置、示例、排错和迁移组织 |

## 与其他 Skill 的关系

- `frontend-architecture`：实现层负责状态模型、缓存策略和渲染验证。
- `product-strategy`：任务流和优先级来自目标用户与成功信号。
- `user-manual-authoring`：用户文档必须反映真实任务流和恢复路径。
- `audit-user-manual`：文档 IA 和菜单导航审查时叠加本 Skill。
