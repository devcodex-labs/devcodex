# Agent 工具问题 & 体量分批规范落地报告

> **项目**: devcodex
> **类型**: analyze
> **子类型**: default
> **创建日期**: 2026-04-09
> **Agent**: webstorm-copilot
> **状态**: 已完成

---

## 任务概述

本次会话执行两项任务：
1. 落地 `05--分批次规范分析.md` 的结论 → 修改规范文件（self-fix 自动级）
2. 分析 JetBrains-WS 中 sub-agent 出现 XML 输出和无文件写入工具的原因

---

## 任务 1：体量分批规范落地

### 变更清单

| 文件 | 变更内容 | 级别 |
|------|---------|:----:|
| `audit-common/SKILL.md` | 在 G1~G5 之前新增 G0 体量评估步骤（1~30/31~60/>60 三档阈值决策）| 自动级 A |
| `audit-execution-guide/SKILL.md` | 末尾新增「体量分批策略」章节（分批原则/模板/跨批记忆格式）| 自动级 A |

### 三项验证

| 验证项 | 结论 |
|--------|------|
| ✅ 合理性 | G0 填补"体量分批"规范空白，与已有"维度分批"无冲突，分层清晰 |
| ✅ 可实施性 | 仅增量写入，不修改已有 G1~G5/维度分批逻辑，最小侵入 |
| ✅ 收益 | 所有项目 audit 开始前均执行体量评估，避免大型项目首次 audit 截断 |

---

## 任务 2：JetBrains-WS Sub-Agent 工具问题分析

### 问题 1：读取文件时 `<function_calls>` XML 输出到会话

**现象**：devcodex sub-agent 执行预检查时，`<function_calls><invoke><parameter>...</parameter></invoke></function_calls>` 原始 XML 出现在会话对话区。

**根本原因**：

```
run_subagent 调用 devcodex
  └─ 子 Agent 预检查：需读取多个 Skills 文件
       └─ 工具执行机制未正常绑定（JetBrains-WS 上下文）
            └─ 模型降级：将工具调用语法作为"文本"输出
                 └─ JetBrains-WS IDE 将子 Agent 原始输出原样展示
                      → 用户看到 XML 混入会话
```

| 因素 | 说明 |
|------|------|
| 工具调用未生效 | 子 Agent 在 `run_subagent` 上下文中工具调用机制未完整激活 |
| 模型降级输出 | 工具不可用时，模型退而将 `<function_calls>` XML 作为纯文本回复 |
| IDE 透传展示 | JetBrains-WS Copilot 面板未过滤 sub-agent 的原始输出，直接显示 |
| 预检查并发过多 | devcodex 预检查需并发读取多个文件，加剧降级触发概率 |

**解决方案**：

| 优先级 | 方案 | 说明 |
|:------:|------|------|
| ✅ 推荐 | 直接使用 `@devcodex` Agent（主会话）| 主会话工具完整，无降级问题 |
| 🟡 缓解 | 减少预检查强制并发读取数量 | 降低触发概率，治标不治本 |
| ℹ️ 待跟进 | 待 JetBrains-WS 完善 sub-agent 工具上下文 | 平台侧问题 |

### 问题 2：提示"当前会话无文件写入工具"

**现象**：sub-agent 生成文件内容后提示无法写入，需手动操作。

**根本原因**：

`devcodex.agent.md` frontmatter 使用 VS Code 泛型工具类别：
```yaml
tools:
  - edit    # 期望映射文件编辑工具
  - execute
  - read
  - search
  - web/fetch
```

JetBrains-WS 中实际文件写入工具名为 `insert_edit_into_file` / `replace_string_in_file` / `create_file`。
泛型 `edit` 在 JetBrains-WS sub-agent 上下文中**未完成映射** → 子 Agent 无文件写入能力。

**解决方案**：

| 优先级 | 方案 | 说明 |
|:------:|------|------|
| ✅ 推荐 | 主会话直接执行（同上）| 主会话有完整映射 |
| 🟡 试验 | frontmatter 增加 JetBrains 具体工具名 | 兼容性未知，需测试 |
| ℹ️ 根本解 | JetBrains-WS 扩展完善工具映射 | 平台侧 |

### 两个问题的共同根因

```
共同根因：run_subagent 在 JetBrains-WS 中工具上下文隔离
├─ 工具调用降级为文本输出 → 问题 1（XML 泄漏）
└─ 文件写入工具未映射   → 问题 2（无写入能力）
```

**结论**：两个问题均源于 `run_subagent` 在 JetBrains-WS 上工具上下文隔离不完整。**当前最有效解决方式：直接在主 Copilot 会话中使用 `@devcodex`，避免 `run_subagent` 的工具隔离问题。**

---

## 附：本次规范变更文件验证

| 文件 | 变更后状态 |
|------|----------|
| `audit-common/SKILL.md` | G0 体量评估步骤已新增，G1~G5 原内容未修改 |
| `audit-execution-guide/SKILL.md` | 「体量分批策略」章节已追加，原内容未修改 |

