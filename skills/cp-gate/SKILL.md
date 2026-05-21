---
name: cp-gate
description: 执行 CP1（需求确认）/ CP2（方案确认）/ CP3（实施计划确认）三阶段确认机制。dev/fix 工作流强制按序执行，不可跳过或合并。
---
## 模式判断

CP 门控**不受 ENV_MODE 影响**，dev/prod 均为 🔴 强制等待用户确认：

| ENV_MODE | CP 行为 |
|----------|--------|
| `prod`（默认）| CP1→CP2→CP3 强制按序，每步必须等待用户明确确认后方可继续 |
| `dev` | 同 prod：CP1→CP2→CP3 强制按序，每步必须等待用户明确确认 |

> ⛔ CP 是用户交互机制（确认需求/方案/计划），与规范验证无关，始终需要确认。
> **CP 跳过的唯一路径**：`@devcodex-auto`（全自动模式），这是 Agent 级行为，与 ENV_MODE 无关。

## 全自动模式

> 当用户选择 `@devcodex-auto` 时：

- CP1 / CP2 / CP3 确认**自动通过**（不等待用户确认）
- 以下约束**不可豁免**：[S01](../../instructions/00-safety.instructions.md)（不可逆确认）/ S02~S07 / [C01](../../instructions/01-common.instructions.md) / [C10](../../instructions/01-common.instructions.md) / [C18](../../instructions/00-safety.instructions.md)
- 可恢复失败：重试 ≤ 2 次
- 不可恢复失败：切换回确认模式并通知用户 ⚠️

## CP 定义

| CP | 名称 | dev | fix | 目的 |
|:--:|------|:---:|:---:|------|
| CP1 | 需求/问题确认 | 🔴 必须 | 🔴 必须 | 确认 AI 理解与用户一致 |
| CP2 | 方案确认 | 🔴 必须 | 🔴 必须 | 确认技术方案可行后再编码 |
| CP3 | 实施计划确认 | 条件触发 | 条件触发 | 确认任务拆分、顺序、依赖、验证和回滚后开始逐文件执行 |

### CP3 触发条件

| 工作流 | 条件 |
|--------|------|
| dev.default / dev.refactor / dev.database / dev.optimization | 必须 |
| dev.docs | 豁免 CP3；必须在需求级记忆或报告中记录 `CP3: N/A（docs 子类型豁免）` |
| dev.init | 豁免 CP3；必须在需求级记忆或报告中记录 `CP3: N/A（init 子类型豁免）` |
| dev.scenario-test | 必须 |
| dev.plan-review | N/A（自身为方案评审，不递归进入 CP3） |
| fix | ≥5 文件变更 **或** 含高风险操作 |
| fix | 其他场景 → 可选 |

**高风险操作**：DDL 变更 / 共享配置文件变更（如 `.env.example`、`package.json`、CI 配置）/ 生产环境配置变更（如生产用 `.env`） / 文件删除 / 直接影响生产环境的修改。仅本地使用且不提交的 `.env.local`、`.env.test.local` 或任务临时配置不在此列。

## 执行规则（[C02](../../instructions/01-common.instructions.md) 约束）

1. **严格按序**：CP1 → CP2 → CP3，不得跳过中间步骤
2. **禁止合并**：不得将 CP1+CP2 合并为一次输出
3. **每个 CP 独立确认**：输出后必须等待用户明确响应
4. **用户请求 ≠ CP 确认**：用户说"帮我做X"不等于 CP1 已通过
5. **"继续" ≠ CP3 授权**：必须先展示变更计划才能进入执行
6. **跨轮次状态保持**：CP 确认状态不因后续轮次消息重置
7. **CP3 内容边界**：CP3 只确认实施计划，不重复技术方案中的架构决策、接口论证和兼容性主说明；必须显式覆盖任务拆分、顺序、依赖、验证方式与回滚策略
8. **产物文件前置创建**：输出 CP 确认请求前，对应产物文件必须已写入磁盘（CP1 → `01-需求概述.md` + `<需求>/.memory/sessions.md`（需求级记忆，🔴 强制创建）；CP2 → `02-技术方案.md`（有架构/接口/设计决策时，否则跳过）；CP3 → `04-实施计划.md`）
9. **进度文档条件触发**：`05-实施进度.md` 不是默认必产物，仅在任务跨 2 轮以上会话、存在明确阻塞或用户要求持续跟踪时创建，且前提是已存在 `04-实施计划.md`
10. **CP3 豁免记录**：docs/init/plan-review 等被工作流规则明确豁免 CP3 时，必须写入 `CP3: N/A（<子类型> 子类型豁免）`，让 hook/fallback 能区分“合法豁免”和“遗漏确认”。

## CP 响应处理

| 用户响应 | 处理方式 |
|---------|---------|
| ✅ 确认（"可以"/"没问题"/"确认"） | 进入下一阶段 |
| ✏️ 修正（"X 部分改为 Y"） | 应用修正后重新输出当前 CP，等待再次确认 |
| ❌ 拒绝（"不对"/"重来"） | 回退到当前 CP 重新分析 |
| ？追问 | 回答后重新输出当前 CP，等待确认 |
| 🔀 模糊（含批评/情绪/意图不明）| **不得推进**，必须明确询问再等待显式响应 |

## 需求级记忆（sessions.md）CP 确认格式

> 🔴 **hook 强制读取此格式**：`hooks/_runtime/lifecycle.cjs` 通过读取 `.devcodex/requirements/<需求名>/.memory/sessions.md` 判断 CP 确认状态，正则为 `| CP[123] | ✅ |`。格式不符则 hook 视为"未确认"，持续阻断代码写入工具（Write/Edit/apply_patch）。

每次用户确认 CP 后，立即在 `.devcodex/requirements/<需求名>/.memory/sessions.md` 写入或更新：

```markdown
### CP 确认记录
| CP  | 状态 | 时间  |
|:---:|:----:|-------|
| CP1 | ✅   | 10:30 |
| CP2 | ⏳   | —     |
| CP3 | ⏹️   | —     |
```

- `✅` 已确认 · `⏳` 等待确认 · `⏹️` 未开始
- 推荐：使用 MCP 工具 `memory_cp_confirm {requirement, phase, time}` 自动写入（格式保证正确）
- 无 MCP 时：用 Edit 工具追加/更新此表格，确保 `| CP1 | ✅ |` 格式出现在文件中
- **禁止**：用 Bash/shell 命令修改此文件（C09：破坏 UTF-8 编码）

## CP 记录格式（报告文件）

报告中「CP 确认记录」表：

```markdown
| CP | 状态 | 用户响应 | 时间 |
|:--:|:----:|---------|------|
| CP1 | ✅ | 确认需求理解正确 | HH:MM |
| CP2 | ✏️→✅ | 修正后确认方案 | HH:MM |
| CP3 | ✅ | 确认实施计划 | HH:MM |
| CP3 | N/A | docs/init/plan-review 子类型豁免 | HH:MM |
```

## CP 通过后变更处理（F-08）

> 详细变更分级规则见 `instructions/10-dev.instructions.md §变更管理`。

| 变更级别 | 判断条件 | 处理方式 |
|:--------:|---------|---------|
| 🟢 微调 | 不影响已确认的接口/行为/范围 | 继续执行，记录偏离原因 |
| 🟡 扩展 | 追加功能点或调整非核心接口 | 回 CP2 补充确认后继续 |
| 🔴 重大 | 影响核心接口/数据模型/范围边界 | 必须回 CP1 重新确认 |

## 模板引用

| 产出物 | 模板 |
|--------|------|
| CP1/CP2/CP3 确认格式 | `prompts/cp-checklist.prompt.md` |

## 用户决策节点（AskUserQuestion / 多选项呈现）

> 🔴 **FC7 强制（v1.9.5+，PI-005 规范化）**：所有用户决策节点必须有且仅有 1 个 🟢 推荐项 + 一句话推荐理由。

适用范围：
- AskUserQuestion 工具调用（多 option）
- CP1 范围选择（如发版 vs 暂停 vs 子集）
- CP2 方案对比（如 A/B/C 实现路径）
- audit/analyze 报告 §决策点（如继续 / 暂停 / 强扫）

### AskUserQuestion 调用模板

```json
{
  "questions": [{
    "question": "选择哪个方案？",
    "header": "方案选择",
    "multiSelect": false,
    "options": [
      {
        "label": "方案 A（推荐）",
        "description": "推荐理由：[实证依据 / 风险权衡 / 性价比 一句话]"
      },
      {
        "label": "方案 B",
        "description": "代价：... 适用场景：..."
      },
      {
        "label": "方案 C",
        "description": "代价：... 适用场景：..."
      }
    ]
  }]
}
```

格式要求：
1. 推荐项必须放**首位**
2. 推荐项标签**必须**含 `(推荐)` 字样
3. 推荐项 description **必须**以"推荐理由："开头
4. 其他选项 description **建议**列出"代价/适用场景"对比信息
5. 不得出现 0 推荐项或 ≥2 推荐项

### 报告/Markdown 决策点模板

```markdown
**选项**：

| 选项 | 描述 | 推荐 |
|------|------|:---:|
| 🟢 A | 方案 A 描述 / **推荐理由**：... | ⭐ |
| B | 方案 B 描述 / 代价：... | |
| C | 方案 C 描述 / 代价：... | |
```

> 关联：[PI-005](../../.devcodex/.maintainer-state/process-improvements.md) · [FC7](../../instructions/17-compliance.instructions.md)

