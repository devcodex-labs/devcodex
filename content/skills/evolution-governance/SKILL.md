---
name: evolution-governance
description: 自我进化治理能力 — 规范、Skill、Prompt、探针和发布流程自动优化的控制面门禁
---
# Evolution Governance Skill

## 职责

当任务涉及自我进化、规范自动优化、模型辅助生成规则、自动补 Skill / Prompt / Probe、自动发版建议或治理控制面时，本 Skill 是独立入口。

本 Skill 负责把 AI 生成的“改进建议”限制在候选态，明确授权、模型配置、租户 / 权限、配额、数据边界、审计日志、回滚和发布审批。任何模型输出不得直接写入 active 规范、部署副本、tag、release 或 publish 流程。

运行态 canonical 化的迁移第一阶段可使用 `scripts/check-runtime-state.js`：它优先读取
fresh compact current projection，陈旧或损坏时只读解析台账、Agent/daily/global
SUMMARY；只有显式 `--write-index` 才同时写 legacy
`.runtime-state/runtime-state-index.json` 与内容寻址 current/detail 分区。两者都不
覆盖历史 Markdown、不切换现有写入者，也不授权自动修复或 active mutation。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求“自我进化 / 自动吸纳 / 自动优化规范 / 自动补探针 / 自动改 Skill” | 必须 |
| 代码或规范设计引入模型生成规则、模型评审规则、自动建议合并或治理流水线 | 必须 |
| 规范发布、tag、publish 前需要基于模型建议自动生成 release 决策 | 必须 |
| 普通手工规范修复、单条 PI/PF 吸纳且无自动化控制面 | N/A，走 `spec-governance` + `source-consumer-sync` |

## EvolutionCapabilityControlPlaneGate

自我进化能力必须先冻结控制面合同：

| 字段 | 要求 |
|------|------|
| `capabilityMode` | `candidate-only`、`review-assisted`、`auto-propose` 或明确禁用；默认 `candidate-only` |
| `authorization` | 用户 / 项目 / 租户是否允许该能力，谁能审批，何时可撤销 |
| `modelProviderConfig` | 模型提供方、模型名、版本、temperature / seed / tool 权限、降级路径 |
| `tenantAndPermissionScope` | 租户、项目、active-root、source-root、deployCopy、发布权限边界 |
| `quotaAndCostBudget` | token、调用次数、并发、重试、费用和超限策略 |
| `dataPolicy` | 可读数据、不可读数据、敏感信息策略、跨项目 / 跨租户隔离 |
| `EvolutionRun` | 每次候选生成的 runId、输入、输出、diff、证据、操作者、时间 |
| `qualityObjective` | 本轮要降低的返工簇、目标发现阶段和不可牺牲的质量边界 |
| `baselineWindow` | 变更前可比 WorkUnit、返工事件、首次通过率和晚发现成本基线 |
| `prospectiveTrials` | 变更后前瞻试运行的 WorkUnit、上下文、执行证据与观察窗口 |
| `effectivenessVerdict` | `effective / ineffective / harmful / insufficient-evidence`，不得用实现完成替代效果结论 |
| `overheadAndFalsePositiveCost` | 新 Gate / Skill / Probe 引入的执行耗时、认知成本、误报和绕行成本 |
| `rollbackOrSunset` | 无效、有害或长期未命中时的回滚、降级、合并或退役条件 |
| `auditLog` | 记录建议生成、人工采纳、拒绝、回滚、发布审批和验证结果 |
| `rollbackPlan` | 如何撤销候选、恢复 active 规范、回退部署副本、撤回发布 |
| `releaseApproval` | tag / release / publish 前必须有人类确认和 release-verification 证据 |

## EvolutionTargetDecisionGate

每个可泛化进化候选在写入任何 active Skill、项目 overlay 或 package source 前，必须先形成 `EvolutionTargetDecisionV1`。schema 位于同目录 `evolution-target-decision.v1.schema.json`。

| 目标 | 默认与证据要求 | active 目的地 |
|---|---|---|
| `workspace-local` | **默认**；适用于跨项目可复用、但尚未达到上游发布标准的本地规则 | `.devcodex/workspace/skills/<id>/` |
| `project-local` | 仅当行为依赖唯一项目的技术栈、约束或消费者；必须有 `projectSpecificEvidenceRefs` | `.devcodex/<project>/skills/<id>/` |
| `upstream-package` | 仅显式维护者贡献；必须有 `maintainerAuthorization=explicit-confirmed`、非空 `maintainerAuthorizationEvidenceRefs`，并用绝对 `upstreamPackageRoot` 绑定本次上游仓库，再重新走 spec/package/release 门禁 | `<upstreamPackageRoot>/content/skills/<id>/` 或既有 Owner |

候选真相源固定为 `.devcodex/workspace/evolution/candidates/`，决定与证据分别进入 `decisions/`、`evidence/`。candidate、decision 和 evidence 都不是 Skill resolver 输入；`candidateResolverEligible` 永远为 false。读取已保存 decision 时必须重算字段、`decisionId` 与 `validation`，不能信任其中的 `validation.valid`。只有 `decision=approved`、`activePromotionAuthorized=true` 且 `activePromotionAuthorizationEvidenceRefs` 非空后，另一个受控写步骤才能把内容晋级到 `activeDestination`；upstream 目的地还必须位于该 decision 明确绑定的 `<upstreamPackageRoot>/content/skills/` 内。拒绝、待审、缺证据或缺授权时 `activeDestination=null`，不得通过软链接、目录扫描或兼容 fallback 绕过隔离。

Provider 分两种：

- `host-assisted-local`：使用当前宿主已授权的模型/工具帮助形成本地候选，不要求 DevCodex 再声明一个 provider、tenant 或 quota；`automationControlPlane=null`，仍须保留 diff、证据、人工决定和回滚。
- `external-automation`：DevCodex 或外部流水线主动调用模型服务，必须填写 provider/model、tenantAndPermissionScope、quotaAndCostBudget、dataPolicy 和 auditLog；任何缺项都保持 candidate-only/BLOCK。

目标判断只决定“候选应归哪里”，不创建目录、不写 active Skill、不发布；workspace provisioning 由独立 CLI 合同拥有，Skill author 只消费已批准的 decision。

`devcodex init/update` 的目录准备必须返回 `WorkspaceProvisioningReceiptV1`（同目录 `workspace-provisioning-receipt.v1.schema.json`）：状态只允许 `fresh / existing / planned / failed`。dry-run 对缺失目录返回 `planned` 且零写入；既有候选、决定和证据不得覆盖；mkdir、路径类型或 workspace-local decision 校验失败必须 typed/nonzero，并保留部分创建事实，不得用空 `catch` 冒充成功。`status/doctor` 只读取该布局，不得隐式创建目录。

## 必执行门禁

- `EvolutionCapabilityControlPlaneGate`：自我进化能力只能生成候选，不得直接写 active 规范或发布。
- `LayeredAbsorptionGate`：候选被人工采纳后，仍要按 prompts / skill / 通用规范 / 探针 / 文档 / 部署副本分层吸纳。
- `ProactiveBetterAlternativeGate`：模型建议不是默认最优；必须比较手工修复、既有 Skill 子门禁、新 Skill 和 docs-only 路径。
- `RemoteCIParityPushGate`：任何由自我进化候选引发的 push / release 前必须执行远端 CI 同构本地门禁。
- `PortableExternalArtifactGate`：模型生成报告或共享包不得写死本机绝对路径、私有 `.devcodex` 路径或个人工作区前提。

## ReworkEffectivenessLoop

自我进化候选声称“降低返工率、提升首次通过率或减少复审逃逸”时，必须执行 `ReworkEffectivenessLoop`：

1. 用 `rework-prevention-engineering` 的 WorkUnit 口径冻结返工簇，区分 `rework`、`scope-change`、`external-change`、`planned-iteration` 与 `same-phase-catch`。
2. 按 `frequency × severity × lateDiscoveryCost × preventability` 排序，只治理高价值、可前移的根因；单次偶发问题最多作为候选证据。
3. 记录 `baselineWindow / reworkCluster / currentDetectionPhase / targetDetectionPhase / candidateControl`，历史审查记录只能证明基线，不能证明新控制有效。
4. 用变更后的可比 WorkUnit 做前瞻验证；普通晋级至少需要 3 个可比 WorkUnit，或 2 个相互独立的项目 / 工作流上下文。样本不足保持 `insufficient-evidence`。
5. 比较 FirstPassYield、WorkUnitReworkRate、RepeatEscapeRate、PreventionHitRate、晚发现成本、误报与执行开销；质量下降、成本失控或无改善时判 `ineffective / harmful`。
6. P0/P1、安全或发布阻断可紧急启用候选控制，但必须限定范围、保留回滚并在后续观察窗补齐前瞻证据；不得因此直接宣告 active 有效。

`EvolutionRun` 的有效性字段至少包括：`qualityObjective / baselineWindow / reworkCluster / targetPhaseShift / candidateControl / prospectiveTrials / falsePositiveCost / overheadCost / effectivenessVerdict / rollbackOrSunset`。

## ExecutionOptimizationLifecycleGate

执行链性能能力以 `OptimizationFeatureStateV1` 管理 `off → shadow → trial → default`，有害候选进入 `rolled-back`，连续两个 release candidate 无有效收益或维护税超过收益时进入 `sunset` review。当前受控能力仅包括 task index、context computation reuse、changed-scope validation、Profile section load、Skill bundle 与 ProjectKnowledge reuse；新增 feature 必须先补消费者、安全 fallback、负向探针和 V101，不得只向状态数组追加名称。

`safe-auto` 只允许已通过 trial 的加速路径；`full-only` 必须关闭全部选择性复用并保持 bounded task resolver、完整 Context/Profile/Skill 读取、intent-preserving direct validation plan 与 full-project-analysis 可用。validation 只有获得显式 full-audit 或 release authorization 才能进入 V3。状态 schema 只读兼容上一版，writer 只写当前版；未知未来 schema 或无效配置 fail-closed，不猜测迁移。promotion 必须同时满足 prospective trials、正确性零错误、收益阈值、fallback regression、overhead 与 false-positive 预算，任一正确性错误立即 rollback。

生命周期不是观测面标签。task resolver、Context cache、validation runner、Profile loader、Skill planner 与 ProjectKnowledge planner 必须在每次真实动作前消费 `ExecutionOptimizationFeatureDecisionV1`；`off / shadow / rolled-back / sunset` 禁止进入优化分支。状态文件缺失可按 trial 兼容启动，但读取失败、容量绕过、未知 schema、identity 无效或目标 root 不明确必须走该 feature 的安全 fallback：validation 使用保留显式 intent/route 的 `direct-validation-plan` 并禁用 cache/reuse，不能安全推导则 BLOCK；其他 feature 走完整读取 route。负向探针必须证明六类消费者均未漏接。

## 负向用例

自我进化控制面至少覆盖以下拒绝 / 降级探针：

1. `disabled`：能力未启用时只能记录候选，不执行写入。
2. `unauthorized`：无权限用户或租户不得触发 active 规范变更。
3. `missing-model-config`：缺模型配置时不得伪造默认模型或静默降级。
4. `quota-exceeded`：超预算时停止候选生成并记录未完成范围。
5. `cross-tenant-data-policy`：跨项目 / 跨租户数据不可混读或写错 active-root。
6. `direct-publish-blocked`：模型建议不得直接 tag、release、publish 或覆盖部署副本。
7. `retrospective-only-proof`：只有历史问题和文本规则时必须保持 `insufficient-evidence`。
8. `metric-gaming`：通过缩小 WorkUnit、把返工改标计划迭代或降低验收标准制造的指标改善必须判无效。
9. `execution-full-only`：kill switch、无效绑定或未知 schema 下仍命中 cache/changed/section/bundle/snapshot 必须失败。
10. `execution-lifecycle-disconnected`：状态已为 `off / shadow / rolled-back / sunset`，但任一真实消费者仍进入优化分支，必须失败；仅 status/doctor 显示回滚不构成执行闭包。
11. `candidate-resolver-leak`：resolver、catalog 或 fallback 直接读取 `evolution/candidates|decisions|evidence` 必须失败。
12. `project-local-without-project-evidence`：缺项目专属性证据不得选择 project-local。
13. `upstream-without-maintainer-authorization`：不得把历史贡献身份、仓库写权限或 auto 授权当作本次 maintainer contribution 确认。
14. `external-automation-incomplete`：provider、tenant/permission、quota/cost、data policy 或 audit 任一缺失不得启动外部自动进化。

## 交付证据

报告必须列出：

- `EvolutionRun` 路径或 `N/A + skipReason`
- 控制面字段冻结结果
- 候选 diff 与人工采纳 / 拒绝结论
- 分层吸纳决策与验证路线
- `ReworkEffectivenessLoop` 基线、前瞻证据、效果结论、成本和回滚 / 退役判断，未触发写 `N/A + skipReason`
- 回滚计划与发布审批状态

## 与其他 Skill 的关系

- `skill-gap-analysis`：负责候选发现前的项目/规模路由、语料完整性、现有 Owner 去重和缺口收敛；本 Skill 仍负责候选授权。
- `skill-lifecycle-governance`：负责 Skill portfolio 的依赖、冲突、触发质量、gray/deprecated/retired 与退役证据；任何 active 状态变化仍需本 Skill 的授权和发布审批。
- `spec-governance`：负责 PI/PF/GAP 分流与规范变更验证；本 Skill 只负责自我进化控制面。
- `source-consumer-sync`：负责真相源、消费者、历史镜像、部署副本和黄色偏离边界。
- `test-router`：选择负向用例、validate、targeted test、release parity 或人工证据。
- `release-verification`：任何 tag / publish / release 前仍由发布验证链执行，不被自我进化能力替代。

## 禁止

- 禁止模型输出绕过人工确认直接进入 active 规范、Skill、Prompt、部署副本或发布包。
- 禁止缺少模型配置、权限、配额、数据边界或审计日志时启用自动治理。
- 禁止把模型建议当成已经验证的事实；必须经本地源码、文档、测试或运行证据复核。
