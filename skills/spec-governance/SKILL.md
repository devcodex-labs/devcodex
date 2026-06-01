---
name: spec-governance
description: 规范治理生命周期 — 意图驱动记录、RecordRouter 分流、SCV 规范变更验证
---
# Spec Governance Skill

## 定位

本 Skill 是规范治理生命周期的集中规则源，负责把“记录规范问题”和“规范变更验证”收口为统一链路：

```text
发现 -> Intent Detection -> Ambiguity Guard -> RecordRouter -> Ledger Write -> Upgrade Check -> Verification
```

原则：

- AI 负责语义判断、上下文归因、多意图拆分和模糊表达澄清。
- 规则负责安全底线、CP 状态、台账格式、路径落点和 SCV 阶段要求。
- 工具负责文件存在、测试结果、部署同步、active-root 泄漏和 validate 探针。

## 记录意图识别

任何“记录一下”“这个不合理”“这个规范要优化”“以后应该这样做”“你刚才漏了/错了/违反流程了”类输入，都必须先识别规范化意图，不得按关键词直接写台账。

| 规范化意图 | 触发含义 | 默认目标 |
|------------|----------|----------|
| `record.violation` | 已有明确规则，但 AI 未执行或执行错 | `data/violations.md` |
| `record.spec-defect` | 规范缺失、冲突、过窄、外部假设失效或拦截滞后 | `data/pending-fixes.md` |
| `record.process-improvement` | 用户提出更优执行策略，AI 验证后可泛化 | `data/process-improvements.md`（优化清单，PI） |
| `record.pending-issue` | 已确认但不阻断当前任务，适合后续批次治理 | `data/pending-issues.md` |
| `record.audit-gap` | 审计/validate/Hook 未发现本该发现的问题 | `data/gap-registry.md` |
| `record.none` | 普通解释、需求整理、报告整理，不是治理记录 | 不写台账 |
| `record.ambiguous` | 指代不清或可能误写台账 | 先澄清 |

## 置信度规则

| 置信度 | 条件 | 处理 |
|--------|------|------|
| 高 | 用户表达明确，且上下文证据支持唯一分类 | 直接分流并说明依据 |
| 中 | 主意图明确，但存在副意图或升级可能 | 先处理主意图，列出副意图 |
| 低 | “记录这个”等指代不清，或目标台账不唯一 | 不写台账，先澄清 |

每次记录分流必须输出：`规范化意图`、`置信度`、`依据`、`目标台账`。

## Improvement Intake（优化清单）

在所有模式下，除了处理“记录一下”这类显式记录请求，每条用户消息在完成合理性评估后，还必须执行一次主动 Improvement Intake：

- 若用户建议经验证**更优且可泛化**，即使没有说“记录一下”，也应主动写 PI。
- 若用户建议同时暴露了**规范未定义、过窄或不完整**，应同步写 PF。
- 若只是这次执行没有遵守已存在规则，应写 VL，而不是误写 PI/PF。
- 若只是业务项目的一次性偏好、局部临时安排或不可泛化做法，应判为 `record.none`。

### Intake 分流矩阵

| 场景 | 目标 |
|------|------|
| 更优策略，可泛化 | `PI` |
| 规范缺口 / 规范不完整 | `PF` |
| 更优策略 + 规范缺口同时成立 | `PI + PF` |
| 已有规则未执行 | `VL` |
| 一次性偏好 / 不可泛化 / 普通讨论 | `none` |

所有模式下，主动 Intake 完成后必须显式回执：`已记录 PI-xxx`、`已记录 PF-xxx` 或 `已记录 PI-xxx / PF-xxx`。

## Backlog Intake 真相复核

当新的需求、bug、批次计划或尾项治理**直接来源于 `data/*.md` 的 open/partial 条目**时，不能把这些编号直接视为本轮真实 open。进入 CP1 / 问题确认或批次实施前，必须先做 Backlog Intake 真相复核：

| 分类 | 含义 | 处理 |
|------|------|------|
| `pure-open` | 主体尚未实施，仍是当前真实 open | 直接纳入本轮 |
| `residual-tail` | 主体已修，只剩尾项/补强/探针/文书 | 缩减为尾项治理 |
| `already-fixed` | 代码/产物已修，仅状态没回写 | 先回写台账并从本轮范围剔除 |
| `misclassified` | 台账分类、描述、归属或计数错误 | 先修正台账与统计口径，再决定是否继续纳入 |

最小复核动作：

1. 对照源码、运行时台账、最新报告/进度、测试结果和记忆索引。
2. 为每个候选编号给出上述分类之一。
3. 非 `pure-open` 项必须先回写台账，再修正 CP1/CP2/CP3 的范围、统计与实施计划。
4. 用户面至少说明：候选编号、分类结果、是否缩减本轮范围。

## 台账落点与关闭证据

- `data/*.md` 是运行时逻辑台账路径，实际写入必须先解析 active-root。
- 旧布局写 `<项目根>/.devcodex/data/`；workspace-namespace 单项目写 `<工作区根>/.devcodex/<project>/data/`；全工作区写 `<工作区根>/.devcodex/workspace/data/`。
- DevCodex 规范自身、Hook、Skill、模板、validate 或宿主适配链路问题归属当前 DevCodex 源仓或规范维护项目的 active-root；在 `workspace-namespace` 下应解析为承载 DevCodex 源码或规范资产的项目命名空间，不得因当时正在处理业务项目而写入业务项目台账。
- `data/process-improvements.md` 在本 Skill 中也可称“优化清单（PI）”；当建议针对 DevCodex 规范自身时，PI/PF 的 active-root 归属同样遵循上条，不得写入业务项目台账。
- VL/PF 关闭前必须具备修复方案、修复时间、验证状态、验证时间、验证证据与关闭时间；仅“已登记”不得视为“已验证关闭”。
- VL/PF 关闭链的时间顺序必须满足 `登记时间 ≤ 修复时间 ≤ 验证时间/关闭时间`；不得写入未来时间或让关闭/验证早于登记。若只能确定日期而非分钟，先保留 `—` 并在证据中说明来源，禁止倒填一个看似精确但破坏时间线的值。
- 若实施、复审或范围收紧改变了 VL/PF/PI/ISSUE/GAP 的真实状态，必须执行**台账状态回写闭环**：回写状态、验证证据、验证时间、关闭时间或部分完成说明，并在批次完成前做 1 轮 target ledger rescan，确认 open 计数、进度、报告和 SUMMARY 已同步。

## RecordRouter

RecordRouter 只在记录意图识别后执行。

| 输入 | 判定 | 目标 |
|------|------|------|
| AI 明确违反已有规范 | 有规则但未执行 | VL |
| 用户指出 AI 漏做流程、错用规范、误判完成或误写台账 | 已有规则未执行时记 VL；规则缺失/不清时升级 PF/GAP | VL / PF / GAP |
| 规范本身缺失、冲突、滞后 | 规则需要修复 | PF |
| 用户提出更优策略并被采纳 | 过程策略优化 | PI |
| 已确认但不阻断当前任务 | 可排期治理 | ISSUE |
| 检查体系存在盲区 | 检测能力缺口 | GAP |

升级规则：

1. 重复 VL 不得只追加违规，应判断是否升级 PF 或 GAP。
2. PF 经用户确认且可排期时，可转 ISSUE。
3. PI 只有在策略可泛化且不破坏现有规则时才写入。
4. GAP 必须包含“为什么原检查没有发现”和“建议探针”。
5. 实施完成复审、ECR 或审计复审发现新问题时，必须记录逃逸原因、缺失检查/探针、补救方案，并判断是否升级 VL/PF/GAP。

## SCV 规范变更验证

当修改规范源、Skill、Hook、CLI、MCP、模板、部署副本、website specs、路径规则或 validate 语义时，必须执行 SCV。

### Concept Sync Map

控制面或模板-示例-校验链任务在进入 SCV-2 前，必须先建立 Concept Sync Map；推荐直接调用 `source-consumer-sync`：

| 字段 | 说明 |
|------|------|
| `sourceOfTruth` | 当前事实源 |
| `currentConsumers` | 本轮必须同步的当前消费者 |
| `historicalMirrors` | 仅作历史归档的镜像 |
| `validateProbes` | `validate` 编号、targeted tests、replay 或其他探针 |
| `deployCopies` | `.github/`、`.claude/`、`AGENTS.md`、`.agents/`、`.codex/` 等部署副本 |
| `yellowDeviationBoundary` | 允许按黄色偏离一并纳入的当前消费者/探针 |

| 阶段 | 目标 | 最小动作 |
|------|------|----------|
| SCV-0 | 变更分类 | 判断文字、语义、控制面、宿主适配、路径存储、文档镜像 |
| SCV-1 | Concept Sync Map | 列出 `sourceOfTruth`、`currentConsumers`、`historicalMirrors`、`validateProbes`、`deployCopies`、`yellowDeviationBoundary` |
| SCV-2 | CRS 双向联查 | 正向 grep 关键词，反向推导应同步但缺失的当前消费者和探针 |
| SCV-3 | 可执行验证 | 运行 `node scripts\validate.js` 与相关 targeted tests |
| SCV-4 | 行为回放 | 回放 Hook/MCP/CLI 场景，验证宿主契约、visible reply 证据与路径行为 |
| SCV-5 | 部署副本同步 | 执行并验证部署副本同步或明确 N/A |
| SCV-6 | 产物边界扫描 | 检查 workspace root、legacy `.devcodex`、错误 `.tmp`、报告/记忆落点 |
| SCV-7 | 完成判定 | 报告、memory、SUMMARY、dirty 边界、推荐结论一致 |

完成规则：

- SCV 结果必须写入报告，不能只写“已验证”。
- 黄色偏离必须写明为什么仍在 `yellowDeviationBoundary` 内，且不能把当前消费者伪装成历史镜像。
- SCV 失败时不得宣告任务完成。
- 控制面任务的 ECR-7 必须引用 SCV 证据。

## AI 与确定性边界

| 交给 AI | 交给规则/工具 |
|---------|---------------|
| 自然语言意图、上下文指代、多意图拆分 | 删除/危险命令/密钥安全底线 |
| 判断违规 vs 规范缺口 | active-root、workspace-namespace 路径 |
| 判断建议是否可泛化 | CP 状态、台账编号、模板字段 |
| 判断是否需要澄清 | 测试、lint、validate 实际结果 |
| 判断重复违规是否应升级 | 部署副本 hash、文件存在性、SCV 完成状态 |

禁止：

- 禁止仅凭关键词把“记录一下”写成 VL。
- 禁止低置信度下静默写台账。
- 禁止用 AI 主观判断替代测试和 validate 结果。
- 禁止用户指定错误台账时盲从，必须做合理性复核。
