---
name: skill-gap-analysis
description: Skill 缺口与大语料分析 Owner — 当任务涉及项目/工作区产物扫描、能力盘点、缺少哪些 Skill、全量审查前规模判断、大目录分批、抽样深读、扫描恢复或自我进化候选发现时使用；要求先识别项目并形成规模决策，再进行有边界的证据扫描。
---

# Skill Gap Analysis

## 职责

在分析、审查或能力盘点前先判断目标项目和语料规模，再选择一次性、分批、抽样深读或阻断路线；完成扫描后，把领域信号与现有 Skill Owner、消费者和验证路线交叉去重，形成可复证的缺口决策。

## ProjectArtifactScaleRoutingGate

任何 broad scan 前必须按顺序执行：

1. 识别唯一 `project / root / activeRoot`；未识别时停止，不得扫描整个工作区。
2. 只做 bounded inventory，显式排除 `node_modules/dist/cache/tmp/backup/smoke/deploy mirror` 等派生产物。
3. 统计 `relevantFileCount / parseableBytes / largestFileBytes / directoryConcentration / derivedArtifactRatio / consumerFanOut`。
4. 形成 `ScaleDecisionRecord`，再允许内容读取或递归检索。

| decision | 默认判定 | 执行 |
|---|---|---|
| `single-pass` | 全部满足 ≤50 files、≤2 MiB、largest≤256 KiB、fan-out≤10，且用户未提示大目录 | 一次处理，仍保留排除策略 |
| `batched` | 任一中等规模、fan-out>10、控制面联动或用户提示目录大 | 按 namespace/目录/文件预算分批，逐批写 checkpoint |
| `sampled+deep-read` | >500 files、>20 MiB、derived ratio>30% 或目录极端集中 | 全量 inventory + 强语义检索 + 代表文件深读；禁止声称逐字全读 |
| `blocked` | 项目/root 不唯一、排除边界不可信、权限/文件系统错误 | 停止 broad scan，先恢复边界 |

项目 Profile 可以配置更保守阈值，不得放宽上述默认边界；用户明确“大目录/文件很多”时不得降为 `single-pass`。

## ScaleDecisionRecord

至少记录：`project`、`root`、`activeRoot`、`inventoryCommand`、六项规模指标、`decision`、`reason`、`exclusionPolicy`、`batchBudget`、`checkpointPath`、`timeoutRetry`、`invalidRunPolicy`。

- 非 single-pass 缺 `checkpointPath` 或 batch budget 时不得继续。
- timeout、错误 glob、派生产物污染或无法解释的数量跳变必须标记 `invalid/discarded`，不能进入结论。
- 检查点状态使用 `not-started / running / accepted / invalid / blocked`；恢复只从最后一个 `accepted` 批次继续。

## Skill 缺口分析流程

1. 生成 `WorkspaceCorpusManifest` 与 `ExclusionPolicy`。
2. 按规模决策执行 `BatchEvidenceLedger`，每批记录输入、命令、文件数、有效信号和异常。
3. 宽口径召回后执行强语义复扫、词边界校准、代表文件深读和历史镜像降权。
4. 建立 `ExistingSkillCoverageMatrix`：候选 → 最接近 Owner → 未闭合边界 → current consumer → validation。
5. 执行 `CommonNormGeneralizationGate` 与消费者证明；项目局部信号标为 `project-local / case-evidence-only`。
6. 为每个真正缺口冻结 trigger、ownedArtifacts、consumerSync、validationRoute 和负向样例。
7. 至少完成两轮维度不同的 omission-only 零新增，写入 `ConvergenceRecord`。

## 输出产物

| 产物 | 必填内容 |
|---|---|
| WorkspaceCorpusManifest | namespace、路径类型、文件/字节、派生边界 |
| ScaleDecisionRecord | 规模指标、四态决策、预算与理由 |
| BatchEvidenceLedger | 批次、checkpoint、命令、状态、invalid-run |
| ExistingSkillCoverageMatrix | 候选与现有 Owner 的覆盖/重叠/缺口 |
| CapabilityGapDecision | new-skill / existing-subgate / docs-only / reject |
| ConvergenceRecord | 每轮维度增量、新增数、连续零新增 |

所有覆盖结论同时执行 `audit-common` 的 `ReviewCoverageClaimIntegrityGate`。`WorkspaceCorpusManifest` 只能证明 inventory-covered；关键词检索只能证明 machine-scanned；代表文件深读必须明确 sampledSet/unreadSet/inferenceBoundary。只有逐文件 FileEvidenceLedger 才能声明逐字全读。

## 与 incremental-project-analysis 分界

| 本 Skill | `incremental-project-analysis` |
|----------|--------------------------------|
| 规模路由、corpus inventory、Skill 缺口 vs Owner | 知识快照、digest 失效、BatchProgress 强制交付、GlobalBacklog、精度合同、双层验证 |
| 「怎么分批扫、缺什么能力」 | 「扫完的事实如何复用、如何对用户分批交付与综合」 |

`batched` / `sampled+deep-read` 的 analyze 路径在形成 ScaleDecision 后应**同时**调用 `incremental-project-analysis` 的交付与精度门禁；本 Skill 不把快照状态机整坨并入。

## 反模式

- 未识别项目就从 workspace root 递归扫描。
- 先全量扫描超时，再补写“应该分批”。
- 把备份、安装包、浏览器 Profile、translation cache 或 lockfile 当能力证据。
- 只按关键词计数，不读代表样本、不反查现有 Skill。
- 用抽样深读结果宣称“逐字审查所有文件”。
- 同一批次失败后继续沿用部分输出，或用后续成功命令覆盖前序失败。
- 做完分批扫描却不调用 incremental Skill，导致无 ProgressCard / 无快照 / 假完整主题清单。

## 验证

至少包含：小项目 single-pass 正向、用户大目录强制 batched、>500 文件 sampled+deep-read、unresolved project blocked、错误 OR glob、派生污染、timeout 无 checkpoint、历史 already-fixed 未去重等正负向样例。
