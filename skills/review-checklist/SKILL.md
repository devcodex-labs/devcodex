---
name: review-checklist
description: 复审清单整理与审查规范 — 创建、冻结、证据执行、状态更新与收敛关闭
---
# Review Checklist Skill

## 职责

当任务需要正式复审、ECR、发布前复审、多轮收敛审查、外部 finding 批次处理或用户要求“复审直至收敛 / 按清单复审”时，本 Skill 负责创建和维护复审清单。

复审清单是执行真相源之一，不是报告里的临时段落。没有清单文件、没有逐项证据、没有状态更新或没有遗漏逃逸分析时，不得宣告复审已收敛。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求复审、再次复审、收敛复审、全维度复审 | 必须 |
| dev/fix 的 ECR 执行闭环复审涉及控制面、多文件、发布、模板、validate 或部署副本 | 必须 |
| 外部审查报告、AI review finding、audit issue、代码评审发现进入批量处理 | 必须 |
| 发布前审查、release readiness、tag/publish 前风险复查 | 必须 |
| CP 确认后命中高风险、多模块、公开契约、配置、安全、package、docs consumer、控制面或多真相源场景 | 必须 |
| 低风险单文件 typo 且无正式复审要求 | N/A + skipReason |

## 清单文件要求

| 字段 | 要求 |
|------|------|
| `reviewScope` | 本轮复审对象、目标版本、active requirement/task/bug id |
| `sourceAnchors` | 需求、技术方案、用户文档、审查报告、finding 来源或 release 目标 |
| `frozenChecklist` | 冻结后的检查项，不允许复审中静默删除 |
| `dimensionSet` | 本轮维度集合；R2+ 必须体现 `ReviewDimensionDeltaGate` |
| `evidence` | 每项绑定命令、代码落点、文档路径、页面、截图、构建产物或反向缺席扫描 |
| `status` | `todo / running / passed / failed / blocked / N/A` |
| `skipReason` | N/A 或未执行项必须写明原因、残余风险和替代证据 |
| `escapeRecords` | 复审或实施中发现原清单遗漏时的追加记录，字段见 `ReviewEscapeRecordGate` |
| `closure` | 收敛结论、未关闭项、下一步和报告引用 |
| `evidenceLedger` | 多批次或矩阵验证命中 `BatchEvidenceLedgerStateGate` 时，冻结 baseline、actualSources、commands、status、finding / skipReason |
| `progressCard` | 多批次命中 `BatchProgressCardGate` 时，记录 totalScope、completed、currentBatch、nextBatch、remaining、blockers、evidenceLinks |
| `coverageClaims` | 按 inventory/machine/manual/sample/executed 分级；强覆盖声明绑定 FileEvidenceLedger |

## 必执行门禁

- `ReviewChecklistPrecreationGate`：正式复审前先创建清单文件或明确复用已有清单。
- `ChecklistFreezeFileGate`：开始执行前冻结清单范围、维度和来源锚点；新增项只能追加，不得静默改写已冻结项。
- `ReviewChecklistCompletenessGate`：每个清单项都要有状态、证据或 skipReason。
- `EvidenceExecutionGate`：不能只按审查报告文字验收；关键结论必须做本地代码、测试、构建、页面、文档或配置证据核验。
- `BlockerSnapshotCompletenessGate`：同一复审阶段存在多个安全独立检查时，先完成该阶段并冻结完整 blocker 快照，再统一修正；若因 invalid premise、破坏性副作用或证据污染提前停止，必须记录 stopReason、skippedChecks 和恢复入口。
- `SampleIssueExpansionGate`：用户给出样例问题时，样例只能作为 seed evidence；正式复审必须先展开全维度图，标明样例覆盖 / 未覆盖维度，再冻结清单。
- `ReviewAnchorMaterializationGate`：PR / TD / CP2 / 发布前审查锚点必须物化为可 grep 的清单项、章节或表格，不能只写“已语义覆盖”。
- `RequirementDimensionBindingGate` / `RequirementPriorityAndPhaseGate`：需求维度进入复审清单时，必须绑定 CP2、批次计划、验收证据和阶段关闭规则；多阶段项写 entry / exit / carryOver / closeRule。
- `ValidationLifecycleTraceabilityGate`（GR-044）：分阶段/状态机需求必须证明独立验证阶段（`ValidationPlanV1` / `BatchValidationResultV1` / `GlobalValidationResultV1`）；验收矩阵不能替代 validate→accept 边界；无结果或 fail/inconclusive 不得 final。
- `PhaseDeliverySemanticGate`：多阶段/路线图复审冻结 `phaseKind`、planningCoverage、sourceDelivery 与 `OriginalIntentReverseTrace`；不得把规划覆盖误报为源码交付。
- `ChecklistEscapeAnalysisGate`：发现遗漏或返修时，分析为什么上轮清单、维度或探针没覆盖。
- `ReviewEscapeRecordGate`：二次复审、返修或实施过程中发现新问题逃逸时，必须先追加 escape record，再补清单和重跑证据。
- `ChecklistStateFreshnessGate`：最终报告前核对清单状态、报告结论、audit-state、sessions、SUMMARY 和 dirty 边界一致。
- `ReviewDimensionDeltaGate`：R2+ 复审不得机械重复同一维度；重复维度必须有阻断项回归、高风险锚点、新证据或抽样理由。
- `PostConfirmationReviewScopeGate`：CP1 / CP2 / CP3 确认后先判定轻量复审或全面复审；命中高风险场景时必须创建或复用本清单，低风险降级写 `N/A + skipReason`。
- `FeatureChecklistEvidenceMatrixGate`：需求维度、功能清单或公开能力进入复审时，必须把 capability group × evidence surface 绑定到当前证据；复审清单记录验证状态，不替代稳定 Profile feature inventory。
- `BatchEvidenceLedgerStateGate`：多批次、矩阵验证、长链路吸纳或发布前检查必须冻结 EvidenceLedger，区分 baseline-confirmed、executed-passed、partial、failed、not-started，且每项有 actualSources、commands、status、finding 或 skipReason。
- `BatchProgressCardGate`：多批次最终报告、记忆和回复必须同步 Progress Card，覆盖总范围、已完成、当前批、下一批、剩余项、阻塞/风险和证据链接。
- `ChecklistStateMaterializationGate`：每轮 clean、streak 增加或 closed 声明前，必须重开当前清单，以同一个 `ChecklistStateSnapshot` 原子核对 header、冻结项、轮次表、Evidence Ledger、Progress Card、Closure 六区块的 `currentRound / zeroFindingStreak / currentBatch / remaining / blockers / openFindings / closureState`。任一区块 stale、缺字段或互相冲突时，本轮无效且 streak 不增加；修正后必须从受影响轮次重新执行，不能只改文案。
- `RepairCollaborationAcceptanceGate`：repair task 的清单必须绑定 `repairClass / contractState / authorizationEvidence`；full 合同逐项核对 findingToPatchMap、handoffIntegrity、independentReReview 和 acceptanceMatrix，禁止补丁产出者以唯一证据关闭高风险项。
- `ReviewCoverageClaimIntegrityGate`：逐文件/逐服务/全量深读声明必须有 FileEvidenceLedger；抽样必须公开 sampledSet、unreadSet、sampleMethod 与 inferenceBoundary。
- `ReworkPreventionHandoffGate`：escape 属于原确认范围且已越过目标门禁时，交给 `rework-prevention-engineering` 分类 ReworkEvent/cluster，并把 prevention 注册到后续可比较任务；本任务重跑通过不能单独证明预防有效。
- `CandidateDiffCompletenessGate`：commit/tag/publish 前，复审清单必须把授权范围物化为 staged candidate snapshot，并记录 cached diff check、name-status、secret-shape scan 与 intended scope 对账；普通 working diff 不得作为未跟踪文件已覆盖的证据。
- `PostStageDerivedArtifactFreshnessGate`：存在 portfolio、索引、生成代码、文档清单或其他 tracked consumer 派生资产时，清单必须在 staged snapshot 物化后执行 Owner 提供的 candidate check，并在 commit 后对 clean target tree replay；记录 input digest、candidate identity、staged/post-commit 两次结果，禁止用“生成器刚运行过”代替提交态新鲜度。
- `ReleaseEfficiencyControlGate`：发布清单记录 candidate generation/freeze、关键路径预算模式、evidence reuse/invalidations 与 release rework incident；无基线预算只能 advisory。
- `ConsumerDesignFitnessRepairGate`：独立消费者验证命中时，清单同时核对 DesignFitnessMatrix 和 ValidationFindingRepairLoop；source mutation 后旧 evidence 必须 stale。

## 执行步骤

1. 识别复审目标和 active 范围，列出来源锚点。
2. 创建或定位清单文件，并写入 `reviewScope`、`sourceAnchors`、`dimensionSet`。
3. 冻结 `frozenChecklist`，标记每项初始状态为 `todo` 或 `N/A`。
4. 按项执行证据核验：命令、grep、代码落点、生成产物、页面、API、pack/install、registry/tag 或项目等价证据。
5. 每完成一项立即更新状态；失败项写修复建议和阻断级别。
6. 返修或发现遗漏时先执行 `ReviewEscapeRecordGate`，追加 escape record，再执行 `ChecklistEscapeAnalysisGate`，说明遗漏原因、补充清单和补充探针。
7. 收敛前执行 `ChecklistStateFreshnessGate`，确认清单、报告、记忆、SUMMARY 和台账状态一致。
8. 最终报告引用清单文件路径，未关闭项不得被隐藏。

## ReviewEscapeRecordGate

当复审、再次复审、ECR、发布前检查、实施中验证或外部 finding 处理发现“原清单没有覆盖但本轮必须处理”的问题时，必须在同一个复审清单文件追加 escape record，不能只在最终报告里口头说明。

escape record 至少包含：

| 字段 | 说明 |
|------|------|
| `escapedItem` | 逃逸问题或遗漏项名称 |
| `detectedAt` | 发现时间、轮次、Run ID 或触发命令 |
| `previousChecklistGap` | 原冻结清单缺了哪一项、哪一类维度或哪条证据 |
| `whyMissed` | 为什么一开始没发现：范围遗漏、消费者漏扫、探针旧口径、只信报告、样例未扩维、历史镜像误判等 |
| `missingDimensionOrProbe` | 缺失的审查维度、grep 反查、测试、validate、页面验证或人工证据 |
| `prevention` | 下次如何避免同类问题，包括新增/调整清单项、探针、模板字段或 ownerSkill |
| `checklistPatch` | 新增到 frozen checklist 的项或追加清单编号 |
| `rerunEvidence` | 补清单后重新执行的命令、代码落点、页面、构建或报告证据 |
| `ledgerRoute` | 是否需要写 VL / PF / GAP / PI / ISSUE；不需要时写 `record.none + skipReason` |

发现遗漏后处理顺序固定为：`append escape record -> patch checklist -> 执行补充验证 -> 更新状态 -> 判断是否写台账 -> 再次收敛复审`。若只是修复问题但没有记录逃逸原因和防复发策略，不得宣告“复审直至收敛”。

## 清单项分类

| 分类 | 说明 |
|------|------|
| requirement-alignment | 对照需求、用户文档、契约文档或技术方案 |
| code-truth | 代码、配置、package、runtime、public API 或消费者入口真相 |
| validation | 测试、validate、build、pack、install、Browser、API、benchmark |
| docs-consumer | README、website、Profile、prompts、templates、部署副本 |
| release-readiness | changelog、version、staged candidate snapshot、tag、registry、回滚、发布说明 |
| governance-ledger | PI/PF/VL/GAP/ISSUE 台账状态和关闭证据 |
| feature-inventory | Profile feature inventory、capability group、公开面、文档入口和验证路线 |
| batch-evidence | EvidenceLedger、批次矩阵、Progress Card、baseline / executed / partial / failed / not-started 状态 |
| brand-visual-evidence | `VisualEvidencePack`、母版谱系、主题几何、微尺寸/单色矩阵、人工结论；发现视觉 blocker 后必须追加 reset 并重跑受影响同母版矩阵 |

## 与其他 Skill 的关系

- `audit-common`：提供审查维度和收敛规则；本 Skill 提供清单文件和逐项证据执行。
- `audit-release`：发布前审查触发时叠加本 Skill 管理发布风险清单。
- `test-router`：为清单项选择最小但足够的验证路线。
- `report`：报告必须引用清单路径、状态新鲜度和未关闭项。
- `document-sync`：复审结论影响 README/website/Profile/validate/部署副本时负责同步检查。

## 禁止

- 禁止没有清单文件就宣告“复审直至收敛”。
- 禁止用“审查报告说通过”代替实际验证。
- 禁止每轮重复同一维度但算作有效零发现。
- 禁止清单状态未更新、audit-state 仍旧或 SUMMARY 口径漂移时宣告完成。
- 禁止删除失败项来制造全绿；只能追加修复记录和关闭证据。
- 禁止发现遗漏后直接修复并跳过 escape record；遗漏原因、防复发策略和重跑证据必须留在清单文件中。
