---
name: incremental-project-analysis
description: 增量项目分析 Owner — 知识快照、内容 digest、分析视角覆盖、changed→impact 选择性失效、智能分批可见交付、全局优先级综合、分析精度合同与双层验证；大型/逐文件分析禁止只缓存自然语言总结。
---

# Incremental Project Analysis

## 职责

承接大库 / 逐文件 / 多会话项目分析的**可复用认知层**：把稳定事实、依赖图、分析视角覆盖与结论新鲜度做成可校验快照，支持增量重算、分批交付与全局综合。  
**不**替代 `skill-gap-analysis` 的规模分批扫描本身；**不**替代 `analyze-default` 的只读多轮分析主流程。本 Skill 提供快照、精度、批次交付与验证状态机。

## 何时触发

- 用户要求完整深度 / 逐文件 / 多批项目分析，且语料 non-small。
- 用户要求「后续只分析增量 / 不要每轮重读全库」。
- `analyze-default` / `skill-gap-analysis` 在 ScaleDecision 为 `batched` / `sampled+deep-read` 时必须调用本 Skill 的交付与精度门禁。
- 用户要求最终确认清单 / 可吸纳包时，叠加 `FindingThemeCoverageMatrix`（与 `report` ABS-17 一致）。

## 与相邻 Skill 分界

| Skill | 本 Skill 管 | 对方管 |
|-------|-------------|--------|
| `skill-gap-analysis` | 知识快照、全局 backlog、精度与验证阶段 | 规模路由、缺口 vs Owner 矩阵、corpus inventory |
| `analyze-default` | 快照复用、BatchProgress、GlobalBacklog、双产物 | 三轮收敛、PCV、只读边界、治理 intake |
| `memory` | 快照路径链接；**禁止**把快照正文写入 SUMMARY | 会话日记、handoff、TimingCard |
| `report` | Theme+Detail 链接、CoverageMatrix 字段 | 报告路径与五项验证列 |

## 核心产物

| 产物 | 说明 |
|------|------|
| `ProjectKnowledgeSnapshotV2` | 可持久化 accepted 项目知识；含 repo/root、Merkle、环境绑定、policy/schema 版本 |
| `FileKnowledgeRecordV2` | 每文件 content identity、coverageLevel、结构观察与已接受声明 |
| `SemanticClaimV1` | 类型化声明；绑定 sourceRange/rangeDigest、authority、lens、policy 与依赖 |
| `ProjectKnowledgeBindingV1` | 绑定唯一 repo/root、inventory Merkle、配置、解析器、测试路线与 Profile 身份 |
| `ImpactGraphV1` | 依赖 / 消费者 / 配置 / 契约边 |
| `AnalysisLensRecordV1` | 分析视角覆盖（lens / questionFingerprint） |
| `IncrementalAnalysisPlanV2` | 本轮只读集合：binding + changed + impact + lens-gap + deterministic sample |
| `IncrementalAnalysisReceiptV2` | 复用/重算/失效分类、抽样复证与 accepted pointer 结果 |
| `BatchProgressCard` | 每 accepted 批用户可见交付 |
| `GlobalOptimizationBacklogV1` | 全批后唯一高/中/低优先级清单 |
| `ValidationPlanV1` / `BatchValidationResultV1` / `GlobalValidationResultV1` | 双层验证 |

落盘建议：`<active-root>/reports/analysis/<agent>/YYYYMMDD/deep/` 或任务目录 `artifacts/knowledge-snapshot/`；**禁止**写入 Agent SUMMARY 正文。

源仓 runtime Owner 为 `scripts/lib/project-knowledge-store.js`，内部 CLI 为 `scripts/project-analysis-state.js status|plan|observe|bootstrap|accept`。accepted runtime 固定落到 `<active-root>/.runtime-state/project-knowledge/v2/<repoId>/snapshot.json`；`status`、`plan`、`observe` 必须零写入，`bootstrap` 只生成可复证的 `content-structured` 首轮基线，只有 `BatchValidationResultV1=pass` 且 sample oracle=pass 的 bootstrap/accept 才可在所有批次内存验收后推进一次 runtime pointer 并写任务证据。

V1 只读兼容：`v1/<repoId>/snapshot.json` 仅用于返回 `compatibility-v1 + migrationRequired` 导航信息，禁止作为 V2 reuse/accept 基线；下一次 `bootstrap` 必须走 full-required 并生成独立 V2 accepted snapshot。禁止迁移时原地改写 V1。

当 execution optimization 为 `full-only`，或 `project-knowledge-reuse` 的 `ExecutionOptimizationFeatureDecisionV1` 为 `off / shadow / rolled-back / sunset`，或 state/snapshot schema/identity 无效、oracle 失败时，`plan` 必须返回 `full-project-analysis`，不得复用 snapshot records；status 同时公开 `executionOptimizationMode`、feature decision 与 `reuseAllowed=false`。kill switch 只关闭加速，不跳过 inventory、智能分批、逐批验证、最终全局验证或高/中/低 backlog。

---

## Gate 索引（执行正文）

### ProjectKnowledgeSnapshotGate（ABS-01）

1. 首次分析冻结：repo/base tree（或等价）、排除边界、文件 contentDigest、coverageLevel、依赖边、policyVersion。
2. 首次无快照时执行 deterministic `observe → batch validate → bootstrap`；只保存从当前字节可重建的结构声明，不得把 bootstrap 宣称为人工深读。
3. 稳定事实层（symbols、imports、配置锚点）按 content identity + rangeDigest 复用；职责、风险、建议只能以 `agent-semantic` authority 单独接受。
4. 判断层绑定 `analysisLens / dependsOn / policyVersion`；代码未变但目标变时只补 lens-gap。
5. `ProjectKnowledgeBindingV1` 的 repo/root、配置、解析器、测试路线或 Profile 身份错配时强制 full-required；inventory 内容差异走 delta/impact，不因正常小变化误判为环境错配。
6. **禁止**仅保存 Markdown 自然语言总结当作可复用知识。

### SemanticClaimBoundaryGate

1. 每条可复用声明必须是 `SemanticClaimV1`，至少包含 `type / statement / authority / sourceRange / rangeIdentity / sourceContentDigest / lensId / policyVersion / dependsOn / claimDigest / status`。
2. `inventory-only` 只能声明文件存在与内容身份；`content-structured` 只能声明文本中直接可解析的 heading、symbol、import、config/test 结构；只有 `agent-semantic` 可声明职责、风险或建议。
3. rangeDigest 必须从当前文件精确行范围重算；path、content、range、lens 或 claim digest 任一不一致即拒绝该批，禁止“修补后继续复用”。
4. accepted snapshot 只持久化 `status=accepted` 声明；candidate/provisional/invalid 只能留在当轮候选输出，不得推进 runtime pointer。

### SelectiveInvalidationGate

1. 变化集优先 `git diff --name-status`，并用当前 digest 覆盖未提交/未跟踪/rename。
2. 直接变化扩展到依赖、消费者、公共契约、配置、生成链、测试与文档闭包。
3. 状态：`fresh / stale / coverage-gap / incompatible / full-required`。
4. 强制升级：快照损坏、base 不可达、schema 不兼容、动态依赖未知、高风险变更、闭包过大、抽样复证失败。

`mtime/size` 只能做候选加速；fresh 必须由 current bytes content identity 证明。rename 必须同时写旧 path tombstone 与新 path identity，delete 写 tombstone；配置变化保守扩到受影响全域。ImpactGraph 每条边必须含 type/source/evidenceStrength，图覆盖不足时不得声称 selective complete。

### AdaptiveBatchDeliveryGate（ABS-02）

1. 按模块 / namespace / 消费者 / 风险分批；每批有 budget 与 checkpoint。
2. **每个 accepted 批次**必须立即输出并持久化：`BatchProgressCard` + 本批发现 + checkpoint + snapshot delta。
3. **禁止**等待全量完成才首次交付用户可见结果。
4. 恢复只从最后一个 `accepted` 批次继续；`invalid/blocked` 不得推进指针。

复用抽样必须按 contentId/path 稳定排序选择 5%，最少 3、最多 20，不足 3 全抽。任一 content/fact mismatch 使本批 `invalid + full-required`；历史 runtime 只标 stale，不自动删除。

`observe` 与 `bootstrap` 的候选选择、结构提取、claimId、rangeDigest、Merkle root 和 sample 必须确定性；同一 repo/root、字节、环境身份与 lens 重跑必须得到相同 identity。持久化顺序为“先验证全部身份与任务证据，最后单次原子替换 runtime pointer”；任务证据写入失败时 pointer 不得推进。

### GlobalPrioritySynthesisGate（ABS-03）

1. 全部计划批次 `accepted` 且 CRS/PCV 收敛后，跨批去重合并，输出唯一 `GlobalOptimizationBacklogV1`（高/中/低 + 推荐顺序）。
2. 未完成 / invalid / blocked → 只能 `partial/provisional`，禁止 final/completed 宣称。
3. `findingId` 与 `priority` **分字段**（ABS-05），禁止用 P1 编号冒充 P0 优先级。

### AnalysisPrecisionContractGate（ABS-04）

1. 开批前冻结 `depthTier`：`deep | standard | light`。
2. 每文件笔记必有 `evidenceStrength`：`agent-semantic | content-structured | inventory-only`。
3. 交付必须 **ThemePriorityBacklog + FindingDetailLedger**（去噪 high/medium；默认排除纯归档 low）。
4. **claimBoundary**：inventory/content-structured **不得**宣称「人工长文精读」；主题 N 条 **不得**宣称「仅有 N 个问题」。

### DualLayerValidationGate

生命周期：

```text
plan → execute → batch validate → accept/deliver → synthesize → global validate → final
```

| 规则 | 说明 |
|------|------|
| 执行前 | 冻结 `ValidationPlanV1`（风险、声明、消费者、证据、升级路线） |
| 批次 | 仅 `BatchValidationResult=pass` 可 accepted / 写 checkpoint / snapshot delta |
| 全局 | 仅 `GlobalValidationResult=pass` 可 final backlog / completed |
| 失败 | fail/inconclusive 隔离候选输出；按 targeted→related→full 扩大或重做；全局失败保持 provisional |

---

## 执行清单（最小）

1. 确认 ScaleDecision（委托 `skill-gap-analysis`）。
2. 加载 V2 snapshot；若仅有 V1，标记只读兼容并规划 full-required bootstrap。
3. 冻结 depthTier + lens + ValidationPlan。
4. 构建 `ProjectKnowledgeBindingV1`，计算 changed / impact / lens-gap → `IncrementalAnalysisPlanV2`。
5. 分批执行：observe/语义补充 → claim range 复证 → batch validate → accepted ProgressCard；首次基线用 bootstrap，后续按差量 accept。
6. 全批后 CRS/PCV → GlobalBacklog → global validate。
7. 报告双产物 + CoverageMatrix（确认清单场景）+ TimingCard（长任务）。

## 反模式

- 每轮全文重读却不更新 digest / 失效图。
- 只交付主题 8 条，隐瞒 high/medium 明细。
- 把 waiting-user 时间算进「分析执行慢」且无 TimingCard。
- 在 SUMMARY 粘贴快照正文。
- 未 batch validate 就写 accepted checkpoint。
- 把 V1 snapshot 静默升级、继续复用或写回原路径。
- 把结构提取结果描述成“逐文件人工深读完成”或“问题只有 N 个”。

## 验证路线

正负向至少覆盖：首轮 observe/bootstrap 确定性；单文件变更只重算闭包；配置变更使未改源码失效；新 lens 触发 coverage-gap；rename/tombstone；repo/root/config/parser/test/Profile/content/range identity 错配；V1 只读兼容；5% sample 确定性；candidate/provisional 不持久化；accepted 缺 ProgressCard 失败；global 未完成不得 final；findingId/priority 混用失败；claim authority 越界失败。
