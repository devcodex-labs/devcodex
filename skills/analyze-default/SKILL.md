---
name: analyze-default
description: 默认分析工作流规范 — 只读多轮分析、代码事实优先、analyze-lite 关联联查与 PCV 收敛验证
---
# Analyze Default Skill

## 定位

`analyze-default` 承接 `analyze.default` 的执行细节。`instructions/13-analyze.instructions.md` 只保留工作流入口、只读底线和路由索引；默认分析的轮次、证据、收敛和输出字段由本 Skill 负责。

## 触发条件

- 用户要求分析、判断、解释、定位原因、评估是否合理，但当前目标是结论而不是直接改文件。
- 语义初判为 `analyze`，且不满足 `analyze.research` 的技术调研、选型或外部资料优先条件。
- 用户要求“全面审查 / 多维度审查 / review / audit”时不得进入本 Skill，应路由到 `audit`。

## 只读边界

- analyze 是只读工作流，禁止修改源码、规范、台账或报告以外的执行产物。
- 发现必须修改的问题时，只能在结论里建议切换 `dev` 或 `fix`，不得在 analyze 内直接实施。
- 用户先给结论、根因或方案假设时，必须独立取证；核验成立才采纳，并说明证据。

## 执行流程

| 步骤 | 要求 |
|---|---|
| A1 问题界定 | 写一句话分析目标、边界、输入证据和不分析范围 |
| A1a 规模路由 | broad scan 前调用 `skill-gap-analysis` 的 `ProjectArtifactScaleRoutingGate`；先识别项目并形成 `ScaleDecisionRecord`，再决定 single-pass / batched / sampled+deep-read / blocked |
| A2 事实取证 | 先查真实代码、文档、配置或运行证据，再对照计划或用户说法 |
| A3 多轮分析 | 至少 3 轮；连续 2 轮无新发现后才可收敛 |
| A4 analyze-lite CRS | 建立关联文件集合，收敛前反向联查是否遗漏关键消费者 |
| A5 PCV 汇总验证 | 对每条结论执行去重、实证核查、三列验证、分级和推荐结论 |
| A6 报告输出 | 结论必须包含合理性、可实施性、收益、验证状态和影响范围 |

## 证据门禁

### CodeTruthFirstGate

当结论依赖代码是否存在、如何实现、路径是否正确或行为是否真实时：

1. 先用关键词、接口路径、类名、方法名或配置名探索真实代码。
2. 再与需求、计划或报告中的路径对比。
3. 结论标为 `按计划实现`、`架构偏差但功能完整`、`未实现` 或 `证据不足`。

禁止只对计划文档里的路径执行存在性检查后直接判定未实现。

### ProfileTruthReconciliationGate（targeted）

项目级 analyze 在 A2 事实取证时必须调用 `load-profile` 的 `ProfileTruthReconciliationGate` targeted 模式：先把 Profile 声明当作待核对输入，再用当前代码、配置、package、运行证据和正式需求建立 `ProfileTruthMatrix`。若出现 `stale-profile` 或 `unverifiable`，本轮结论必须采用可验证事实并明确可信度；若出现 `stale-code-or-doc` 或 `intentional-exception`，必须说明目标态/政策依据和消费者影响。

analyze 只矫正结论，不修改 Profile。需要修订 Profile 时在 `upgradeAdvice` 指向独立 dev/fix/self-fix。低风险单文件且结论与项目事实无关时可写 `N/A + skipReason`，不得把普通项目级根因分析降级为 N/A。

### AnalyzeLiteCRSGate

每轮分析需要维护关联文件集合：

- `seedEvidence`：用户输入、截图、报告、路径或初始线索。
- `actualSources`：本轮实际读取的代码、文档、配置、测试或日志。
- `relatedConsumers`：可能消费该事实的 README、website、Profile、prompts、validate、部署副本或运行时。
- `missingSurface`：尚未读取但可能影响结论的关联面。

收敛前必须复查 `missingSurface`，并说明未继续读取的 `skipReason`。

### ProjectArtifactScaleRoutingGate

项目级 analyze、全库关联联查或用户提示“大目录/文件很多”时必须触发。未形成 `ScaleDecisionRecord` 前，只允许带排除边界的 bounded inventory；非 single-pass 必须记录 batch budget、checkpoint、timeout/retry 和 invalid-run 排除。抽样深读只能声明“全量 inventory + 代表性深读”，不得宣称逐字全读。

### QuestionEvidenceGate

当问题本质是“是否应该 / 哪个更好 / 有没有更好建议 / 推荐什么”时，先判断是否需要 `ComparativeResearchGate`：

- 涉及高成本、技术路线、外部平台、产品路线或长期维护时，升级 `analyze.research` 或补足对比证据。
- 纯解释、低风险本地事实核验或用户明确要求快速答复时，写 `N/A + skipReason`。

### ReviewFindingIntakeGate

外部审查报告、AI review finding、audit issue 或代码评审发现只能作为线索。每条 finding 必须本地复核，并分类为：

- `must-fix`
- `user-decision-required`
- `docs-implementation-drift`
- `test-coverage-gap`
- `already-fixed-or-not-reproduced`
- `intentional-design-accepted`

不得直接按审查报告文字验证通过；涉及设计如此、兼容策略或产品取舍时，必须记录依据和消费者影响。

### GovernanceGateRegistryRef

分析发现规范吸纳、长清单残留、复审遗漏、用户文档、发布门禁、前端缓存或自我进化控制面问题时，不在本 Skill 内复制 Gate 长清单；应引用 `spec-governance` 的 `GovernanceGateRegistry`，输出 `gateGroup`、`ownerSkill`、`trigger`、`evidence` 与 `validationRoute`。

## PCV 收敛验证

| PCV | 动作 |
|---|---|
| PCV-1 | 汇总并去重所有轮次发现 |
| PCV-2 | 对每条结论重新读取对应事实源；运行时数字优先本轮实际执行，不能用记忆历史数字冒充已验证 |
| PCV-3 | 补齐合理性、可实施性、收益 |
| PCV-4 | 多路径时给出推荐结论和推荐理由；无后续动作时写 `推荐：无后续动作` |
| PCV-5 | 标注 `已验证` / `待验证` / `排除` |
| PCV-6 | 输出过滤后的最终结论，排除项说明原因 |

## 输出最小字段

| 字段 | 要求 |
|---|---|
| `analysisTarget` | 一句话问题定义 |
| `scaleDecision` | ProjectArtifactScaleRoutingGate、六项规模指标、四态决策、预算/checkpoint；N/A 仅限明确单文件且说明理由 |
| `rounds` | 至少 3 轮，记录每轮新增发现数 |
| `evidenceMap` | 结论到文件、命令或事实源的映射 |
| `profileTruth` | mode、profileTrustState、ProfileTruthMatrix；N/A 时写 skipReason |
| `pcv` | PCV-1~PCV-6 结果 |
| `recommendation` | 推荐结论、推荐理由或无后续动作 |
| `upgradeAdvice` | 是否建议切换 audit/dev/fix/research，含理由 |
