# 最新 data 吸纳守门补强

> **状态**：✅ 已实现  
> **优先级**：P1  
> **关联规则**：`WorkspaceDataAbsorptionScopeGate`、`FlowchartNodeExplanationGate`、`DocsSiteVisualAcceptanceGate`、`OmissionOnlyReviewGate`、`MethodLevelLeakPressureProbe`、`V2FormalSolutionPackage`

## 背景

在跨项目 data 台账复核中发现，吸纳范围、遗漏专审、流程图说明、文档站体验验收、泄漏压测粒度和 v2 一期正式方案包仍需要从“建议”升级为可执行门禁。

本需求将这些剩余项纳入 `CrossProjectLearnedGuards`、TestRoute、dev/audit Skill、prompt、README/website 与验证探针，避免只在报告里出现一次性结论。

## 需求

| 守门项 | 触发场景 | 最小验收 |
|--------|----------|----------|
| `WorkspaceDataAbsorptionScopeGate` | 检查 data 目录、最新可吸纳问题、仍需吸纳清单、开始吸纳 | 扫描 `.devcodex/*/data/` 全命名空间，输出命中台账、候选编号、归属和跳过理由 |
| `FlowchartNodeExplanationGate` | 正式流程图、生命周期图、Nxx 节点图、维护者流程页 | 每个非终止节点有中文说明，覆盖触发、前置、动作、出口、异常/回退 |
| `DocsSiteVisualAcceptanceGate` | 官网、文档站、技术站或正式说明页的视觉/交互验收 | 覆盖主题集成、真实点击、异步动效、减弱动态、代码 token 对比度、终端 demo 范围、TOC inline code 和辅助导航层级 |
| `OmissionOnlyReviewGate` | 用户要求只审遗漏、上次没检查、只列仍需吸纳项 | 只输出此前未覆盖且仍有处理价值的遗漏项，已吸纳/关闭/无必要项只写排除理由 |
| `MethodLevelLeakPressureProbe` | 高风险资源泄漏修复、公开库/adapter/SDK、连接/监听/定时器/worker/cache 风险 | 评估公开方法级重复调用或生命周期压测，记录指标、阈值、冷却和清理证据 |
| `V2FormalSolutionPackage` | v2 一期正式规划、方案冻结或 ISSUE-027 尾项治理 | 形成 CP1/CP2 方案包，覆盖架构、数据模型、MCP API contract、instruction return、可见性、cache/signature/rollback、Codex-only 验证、Registry/Marketplace、私有维护站和 Mermaid 节点流程 |

## 验证

- `node scripts/validate.js` 必须包含 V63 探针。
- `node scripts/test-spec-governance.js` 必须覆盖上述规则在 instructions、skills、prompts、README、website 与 changelog 的同步。
- 文档站 sidebar 与需求索引必须出现本页入口。
