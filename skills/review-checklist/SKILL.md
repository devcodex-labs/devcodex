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
| `closure` | 收敛结论、未关闭项、下一步和报告引用 |

## 必执行门禁

- `ReviewChecklistPrecreationGate`：正式复审前先创建清单文件或明确复用已有清单。
- `ChecklistFreezeFileGate`：开始执行前冻结清单范围、维度和来源锚点；新增项只能追加，不得静默改写已冻结项。
- `ReviewChecklistCompletenessGate`：每个清单项都要有状态、证据或 skipReason。
- `EvidenceExecutionGate`：不能只按审查报告文字验收；关键结论必须做本地代码、测试、构建、页面、文档或配置证据核验。
- `SampleIssueExpansionGate`：用户给出样例问题时，样例只能作为 seed evidence；正式复审必须先展开全维度图，标明样例覆盖 / 未覆盖维度，再冻结清单。
- `ReviewAnchorMaterializationGate`：PR / TD / CP2 / 发布前审查锚点必须物化为可 grep 的清单项、章节或表格，不能只写“已语义覆盖”。
- `RequirementDimensionBindingGate` / `RequirementPriorityAndPhaseGate`：需求维度进入复审清单时，必须绑定 CP2、批次计划、验收证据和阶段关闭规则；多阶段项写 entry / exit / carryOver / closeRule。
- `ChecklistEscapeAnalysisGate`：发现遗漏或返修时，分析为什么上轮清单、维度或探针没覆盖。
- `ChecklistStateFreshnessGate`：最终报告前核对清单状态、报告结论、audit-state、sessions、SUMMARY 和 dirty 边界一致。
- `ReviewDimensionDeltaGate`：R2+ 复审不得机械重复同一维度；重复维度必须有阻断项回归、高风险锚点、新证据或抽样理由。

## 执行步骤

1. 识别复审目标和 active 范围，列出来源锚点。
2. 创建或定位清单文件，并写入 `reviewScope`、`sourceAnchors`、`dimensionSet`。
3. 冻结 `frozenChecklist`，标记每项初始状态为 `todo` 或 `N/A`。
4. 按项执行证据核验：命令、grep、代码落点、生成产物、页面、API、pack/install、registry/tag 或项目等价证据。
5. 每完成一项立即更新状态；失败项写修复建议和阻断级别。
6. 返修后执行 `ChecklistEscapeAnalysisGate`，说明遗漏原因和补充探针。
7. 收敛前执行 `ChecklistStateFreshnessGate`，确认清单、报告、记忆、SUMMARY 和台账状态一致。
8. 最终报告引用清单文件路径，未关闭项不得被隐藏。

## 清单项分类

| 分类 | 说明 |
|------|------|
| requirement-alignment | 对照需求、用户文档、契约文档或技术方案 |
| code-truth | 代码、配置、package、runtime、public API 或消费者入口真相 |
| validation | 测试、validate、build、pack、install、Browser、API、benchmark |
| docs-consumer | README、website、Profile、prompts、templates、部署副本 |
| release-readiness | changelog、version、tag、registry、回滚、发布说明 |
| governance-ledger | PI/PF/VL/GAP/ISSUE 台账状态和关闭证据 |

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
