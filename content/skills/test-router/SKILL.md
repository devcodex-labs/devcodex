---
name: test-router
description: 测试路由规范 — 根据变更类型、影响范围与风险选择静态、单元、集成、API、E2E、场景/负载、pack 或发布验证，并记录跳过理由
---
# Test Router Skill

TestRoute 的稳定输入、route selector、固定输出与 skip 合同以同目录 `test-route-schema.json` 为唯一结构化事实源；领域专用证据保留在对应 Owner Skill，不再全部提升为 TestRoute 顶层字段。

## 职责

`test-router` 只负责选择验证路线和记录跳过理由，不替代 `dev-testing`、`api-verification`、`dev-scenario-test` 或项目自身测试规范。

## 输入

机器可读输入、selector、输出与跳过字段以同目录 `test-route-schema.json` 为唯一事实源。稳定输入只有：

`workflow / changeTypes / risk / publicSurface / runtimeBoundary / profileConstraints / candidateState / capabilitySurfaceDecision / requestedClaims`

领域专属证据不得复制进 TestRoute 输入清单；先从 `../spec-governance/gate-registry.json` 解析适用 `gateGroup`，再由目标 Owner Skill 提供证据字段和阈值。

## 路由选择

| selector | 触发边界 | 最小证据 |
|----------|----------|----------|
| `static` | 源码或契约变化 | command、exitCode |
| `unit-integration` | 行为或跨模块变化 | suite、result、coverageDecision |
| `api` | HTTP 或 public API 边界 | endpointMatrix、双 API 产物、result |
| `runtime-e2e` | 用户路径或运行时状态变化 | target、stateMatrix、result |
| `package-release` | package candidate 或 release 声明 | candidateDiff、pack、install、registry |
| `profile-deploy` | Profile、宿主或分发面变化 | profileValidation、deploymentParity |

先按变化事实选择所有适用 selector，再按风险升级验证层级。不得仅因“已有单测”跳过跨边界、真实 runtime、package candidate、Profile 或部署副本验证；不适用的 selector 必须形成结构化跳过记录。

`brandVisualQuality` 是 `brand-visual-quality` gateGroup 的领域绑定，不新增顶层 selector：至少选择 `static`，并用 Owner Skill 的同画布渲染、微尺寸/单色预览和人工视觉结论补充 evidence；涉及网站或产品运行态采用资产时再叠加 `runtime-e2e`。若任务只改 token/component 而不生产品牌资产，写结构化 skipReason 并交给设计系统 Owner。

`localObservability` 是 `local-observability-contract` gateGroup 的领域绑定：CLI JSON/human/error/exit 选择 `unit-integration + runtime-e2e`；typed local probe 追加 dependency/error/zero-write fixture；进入 package/公开文档时叠加 `package-release / profile-deploy`。

`turnLiveness` 是 `agent-turn-liveness` gateGroup 的领域绑定，不新增顶层 selector：至少选择 `unit-integration + runtime-e2e`，执行 fixed-clock 状态机、Hook direct replay、no-continuation、active lease、restart rehydrate 与 duplicate recovery；`CheckpointValidationResultV1` 必须覆盖 response-time/post-execution、缺证据与 timeout；`LocalTaskTraceV1` 必须覆盖 sequence/duplicate/terminal/restart、payload 不执行和 source state zero-write。触达 Profile/部署或 gray sidecar package 时再叠加 `profile-deploy / package-release`。Hook 无事件自唤醒能力未由宿主或 sidecar 实证时，coverageClaim 必须降级并保留 residualRisk。

`context-acquisition` 是同名 gateGroup 的领域绑定，不新增顶层 selector：契约、Profile/Memory MCP 或 Hook receipt 变化至少选择 `unit-integration + runtime-e2e`；规范、Prompt、README/website 或部署面变化叠加 `static`，触达 Profile/宿主分发时再叠加 `profile-deploy`。Owner evidence 至少链接 IntentSeed/plan/receipt correlation、**`ContextReadBindingV1`（request-bound；legacy-unbound 不得 claim complete）**、`ProfilePlanNoHiddenFullReadProbe`、bounded memory query、failed-Pre/false-complete 负例、legacy compatibility 与 V99。ValidationExecutionReceipt 须携带 **`testRouteDigest`** 与可选 **`intentExpansionDigest`**（PF-149），使 TestRoute 选择与上下文绑定可对账。性能证据记录 bytes/chars/latency/cache/escalation；input tokens 不可观测时必须标 N/A，不能用 chars 冒充。staged consumer 只允许精确列出 missing consumer 与后续 Owner batch，不得把 known-red 泛化为通过。

`executionChainOptimization` 是执行链性能与稳定演进的领域绑定：至少选择 `static + unit-integration + runtime-e2e`，执行 manifest 节点 `execution-chain-evolution`、V101、任务/Context/Profile/Skill/knowledge 的 full-only 负例，并逐一验证 `ExecutionOptimizationFeatureDecisionV1` 在 `off / shadow / rolled-back / sunset` 下真实阻断六类优化消费者。触达 Profile/部署叠加 `profile-deploy`，公开 package/benchmark 脚本叠加 `package-release` smoke，网站说明变化追加 website build/link。只有 full route、correctness oracle 和可比 benchmark 都通过才可声明 accepted；否则状态保持 `provisional`，但 `full-only` 正确路径必须继续为 green。

`derivedArtifactFreshness` 绑定 `skill-lifecycle` 或对应派生资产 Owner，不新增顶层 selector：至少选择 `static + unit-integration + runtime-e2e`，覆盖确定性生成、先生成后 stage 的负例、精确 staged/index candidate check 与 post-commit clean-tree replay；触达 Profile/部署副本叠加 `profile-deploy`，触达 package/release candidate 叠加 `package-release`。working-tree check、staged check 与 post-commit replay 必须分别记录 candidateState，不能复用一次结果冒充三种状态。

`repairPreventionAssessment` 绑定 active `repair-prevention-assessment`，不新增顶层 selector：所有 repair 至少选择 `static + unit-integration`，分别绑定当前 defect 的 regression/negative evidence 与 prevention decision 的 prospective/rollback evidence。高风险、repeat escape、emergency-active、控制面或公共契约再叠加 `runtime-e2e` 和适用的 package/profile 路线；当前修复重跑只能进入 immediate closure，不得填充 prospective effectiveness。返工指标或长期效果验证才额外绑定 gray `rework-prevention-engineering`。

`baseAdmissionGovernance` 绑定 `spec-absorption` / `skill-lifecycle-governance`，不新增顶层 selector：新增或晋级规范、Skill、Prompt、流程、验证器或部署消费者至少选择 `static + unit-integration`，并记录 `BaseImpactAssessmentV1`、`ComplexityDeltaBudgetV1`、`UnaffectedIntentRegression`、`replacementOrRetirementCredit`、回滚和退役/删除条件。`base-changing` 叠加 `runtime-e2e + profile-deploy`，且必须有单独确认和未受影响意图负样本；普通 chat/dev/fix 不因此增加默认验证路径。V96 负责正负向分类器证据。

`visibleOutputContract` 绑定 `user-visible-output-contract`，不新增顶层 selector：任何 `ArtifactDeliveryManifestV1`、`UserFacingArtifactSetV1`、`DevCodexVisibleEnvelopeV1`、renderer 或 visible-reply Hook 变化至少选择 `static + unit-integration + runtime-e2e`，覆盖 planned/observed/internalDelivered 对账、required hidden=0、计数守恒、六 message kinds、compact eligibility、legacy/unobserved ceiling、semanticDigest 和 rich/portable/plain 等价性。触达 README/website/Profile/部署副本时叠加 `profile-deploy`，进入 package public surface 时叠加 `package-release`。宿主 capability 未 direct replay 时必须保持 portable/plain 或 unverified，不得按宿主名推断 clickable。

`evidenceFreshness` 绑定 `report` / `analyze-default` / `audit-report` / `review-checklist`，不新增顶层 selector：强主张新鲜度、summary-only 降级、外部 finding 采纳、artifact anchor 或 final validation summary 绑定变化至少选择 `static + unit-integration`，执行 `npm run test:evidence-freshness` 并在控制面或当前消费者同步时叠加 `node scripts/validate.js` 与 `profile-deploy`。若只是普通报告没有 strong claim，写 `N/A + skipReason=no-strong-claims`。

`expertOutputQuality` 绑定 `expert-output-quality` / V84，不新增顶层 selector：代码、文档、示例、fixture、技术方案或报告命中专家型质量时，至少选择 `static`（并优先 `node scripts/test-spec-governance.js` + 控制面变更时 `npm run test:core`），证据链覆盖 `ExpertOutputQualityGate`、生产推荐路径、fixture 边界与 **MeasuredVerificationStandard**（生产入口命令 + exitCode；隔离 harness 不得冒充 V84 成败）。Owner 字段与完整门禁见 `skills/expert-output-quality/SKILL.md` 与 gate-registry `expert-output-quality`。

`requirementParallelOrchestration` 绑定 `requirement-parallel-orchestration`，不新增顶层 selector：新增或修改多需求并行判定、`SharedSurfaceLockMapV1`、`ParallelLaunchCardV1`、`IntegrationMergeProtocolV1` 或相关消费者时，至少选择 `static + unit-integration`，执行 `npm run test:requirement-parallel-orchestration`。触达 Skill portfolio、validation manifest、package/plugin、README/website/Profile 或部署副本时叠加 `control-plane / profile-deploy` 对应命令；缺负向探针不得声明可并行。

`capabilitySurfaceDecision` 只接受中央 `decisionRef / status / identity / preferredSurface / validationRoute` 的只读投影，不复制判定矩阵。新增或改变 Rule/Skill、Prompt、MCP Resource/Resource Template/Tool、Task 增强 Tool、CLI 或 Hook 时，至少选择 `static + unit-integration` 并执行 `npm run test:capability-surface-decision`；触达 MCP runtime、宿主 adapter、package、Profile、public docs 或部署副本时按 decision 的 `validationRoute` 叠加 `runtime-e2e / package-release / profile-deploy`。decision 缺失、stale、blocked 或 identity 不匹配时不得降级为 skipped。

### 发布候选验证

选择 `package-release` 时必须调用 `release-verification`，并把 `npm run test:audit`、package completeness gate、publish dry-run 和远端 CI 作为独立证据记录。pack 或本地 install 通过不能替代远端 CI，也不能替代发布前的 package completeness gate；未形成真实发布候选时必须记录 skipReason，不得把普通开发验证写成发布完成。

## TestRoute 输出

输出固定为 `selectedRoutes / commands / evidence / skipped / residualRisk / coverageClaim`。推荐使用以下最小结构：

```yaml
workflow: fix
changeTypes: [control-plane, documentation]
risk: high
selectedRoutes:
  - selector: static
    commands: [npm run test:control-plane]
    evidence: [{ command: npm run test:control-plane, exitCode: 0 }]
  - selector: profile-deploy
    commands: [node scripts/validate-all-profiles.js]
    evidence: [{ profileValidation: passed, deploymentParity: passed }]
skipped:
  - route: runtime-e2e
    reason: no runtime user path changed
    authority: source diff and execution contract
    residualRisk: none identified
    upgradeCondition: runtime boundary enters scope
coverageClaim: executed-selected-routes
```

## 跳过规则

每条跳过记录必须包含 `route / reason / authority / residualRisk / upgradeCondition`。缺少任一字段、用“暂不需要”作理由、或目标声明需要该路线却没有可替代证据时，TestRoute 不得标记完整。

高风险、公共契约、控制面、发布候选和跨宿主分发变更至少要求两类独立证据；若无法执行，结果必须降级为 partial/blocked，并把升级条件带入报告与 `ContextHandoffCard`。

## 报告要求

dev/fix/optimization/scenario-test 报告应包含 TestRoute 或明确 `N/A`，ECR-3/ECR-4 应引用实际执行结果。若命中宿主验证，还应同时引用 `host-contract-verification` 的 HostContractRoute 结果，包括适用时的 `mcpFallback=used`；若命中用户可见输出，必须引用 manifest/visible set/envelope/capability 的同一 semanticDigest 与 renderer parity 结果。
