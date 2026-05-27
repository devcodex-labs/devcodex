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

任何“记录一下”“这个不合理”“这个规范要优化”“以后应该这样做”类输入，都必须先识别规范化意图，不得按关键词直接写台账。

| 规范化意图 | 触发含义 | 默认目标 |
|------------|----------|----------|
| `record.violation` | 已有明确规则，但 AI 未执行或执行错 | `data/violations.md` |
| `record.spec-defect` | 规范缺失、冲突、过窄、外部假设失效或拦截滞后 | `data/pending-fixes.md` |
| `record.process-improvement` | 用户提出更优执行策略，AI 验证后可泛化 | `data/process-improvements.md` |
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

## RecordRouter

RecordRouter 只在记录意图识别后执行。

| 输入 | 判定 | 目标 |
|------|------|------|
| AI 明确违反已有规范 | 有规则但未执行 | VL |
| 规范本身缺失、冲突、滞后 | 规则需要修复 | PF |
| 用户提出更优策略并被采纳 | 过程策略优化 | PI |
| 已确认但不阻断当前任务 | 可排期治理 | ISSUE |
| 检查体系存在盲区 | 检测能力缺口 | GAP |

升级规则：

1. 重复 VL 不得只追加违规，应判断是否升级 PF 或 GAP。
2. PF 经用户确认且可排期时，可转 ISSUE。
3. PI 只有在策略可泛化且不破坏现有规则时才写入。
4. GAP 必须包含“为什么原检查没有发现”和“建议探针”。

## SCV 规范变更验证

当修改规范源、Skill、Hook、CLI、MCP、模板、部署副本、website specs、路径规则或 validate 语义时，必须执行 SCV。

| 阶段 | 目标 | 最小动作 |
|------|------|----------|
| SCV-0 | 变更分类 | 判断文字、语义、控制面、宿主适配、路径存储、文档镜像 |
| SCV-1 | 真相源映射 | 列出 instruction、skill、prompt、hook、MCP、CLI、website、README、deploy 副本 |
| SCV-2 | CRS 双向联查 | 正向 grep 关键词，反向推导应同步但缺失的文件 |
| SCV-3 | 可执行验证 | 运行 `node scripts\validate.js` 与相关 targeted tests |
| SCV-4 | 行为回放 | 回放 Hook/MCP/CLI 场景，验证宿主契约与路径行为 |
| SCV-5 | 部署副本同步 | 执行并验证部署副本同步或明确 N/A |
| SCV-6 | 产物边界扫描 | 检查 workspace root、legacy `.devcodex`、错误 `.tmp`、报告/记忆落点 |
| SCV-7 | 完成判定 | 报告、memory、SUMMARY、dirty 边界、推荐结论一致 |

完成规则：

- SCV 结果必须写入报告，不能只写“已验证”。
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
