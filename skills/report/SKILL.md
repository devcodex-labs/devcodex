---
name: report
description: 生成并写入工作流执行报告。适用于 dev/fix/analyze/audit/self-fix（chat 豁免）。
---
## 报告路径

### 需求级（优先）

任务关联到 `requirements/` · `bugs/` · `optimizations/` 目录时：
```
<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md
```

### 项目级（兜底）

```
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

| 工作流 | 默认子目录 |
|--------|:----------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

> 路径详细规范见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md)。
> 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，本文中的任务目录与项目级 `reports/...` 均以当前 **`<active-root>`** 为根。

## 头部必填

```markdown
# [标题]

> **项目**: [项目名]
> **类型**: [类型]
> **子类型**: [子类型]（无子类型时省略此行）
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: [agent-id]
> **状态**: 进行中 / 已完成
```

## 命名规则

| 组件 | 规则 |
|------|------|
| `NN` | 当日序号，从 `01` 起递增（扫描同目录取 max+1）|
| `--` | **双横杠**（非单横杠），分隔序号与简述（[FC4](../compliance/SKILL.md) 检查） |
| `<简述>` | 2~5 个中文词或英文单词，连字符分隔 |

示例：`01--v4规范全面审查.md`、`02--intent修复后再审.md`

## 工作流专属字段

### audit 报告额外头部

```markdown
> **审查目标类型**: [规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档 / 发布前审查]
> **审查范围**: [全面体检 / 定向深度 / 修复验证]
> **收敛**: 连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面）
> **ReviewCoverageDelta**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **PCV状态**: ✅已完成 / 🔄进行中
```

### fix 报告须包含

- CP 确认记录表（CP1→CP2→CP3 状态，格式见 [`cp-gate`](../cp-gate/SKILL.md)）
- 三步扫描结果（同类全局扫描 / 数据联动扫描 / grep 零残留复核）

### dev/fix 支撑产物字段

当以下支撑 Skill 被触发时，报告必须列出对应产物、判定结果与证据；未触发时可标 `N/A` 并说明原因。

| 支撑产物 | 触发场景 | 报告要求 |
|----------|----------|----------|
| ExecutionContract | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | 列出 scope、allowedPaths、requiredArtifacts、validationRoute、deviationPolicy、rollbackPlan |
| TestRoute | 跨模块、接口、Hook/CLI、模板-示例-校验链、测试路径不明显的任务 | 列出 changeType、routes、commands、skipReason、blockingLevel |
| ReleaseVerification | 用户明确要求正式发版、tag、publish 或已进入发布前验证 | 列出 R0~R7 的验证结果与证据；如存在远端 CI，补 R3c 目标 commit CI 绿色证据或 `N/A + skipReason` |
| ReleaseAudit | 用户要求发版前 review、publish/tag 前风险审查或 audit.发布前审查 | 列出 RL-1~RL-10 审查结果、风险、证据与推荐结论 |
| ConceptSyncMap | 控制面、模板-示例-校验链、README/website/Profile/validate/部署副本联动任务 | 列出 sourceOfTruth、currentConsumers、historicalMirrors、validateProbes、deployCopies、yellowDeviationBoundary |
| HostContractVerification | Hook/CLI/宿主契约、visible reply、sticky project、workspace guard、bootstrap 相关任务 | 列出 hostSurface、eventScope、evidenceMode、visibleReplyEvidence、workspaceGuard、bootstrapScope |
| 05-实施进度.md | 跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面或模板-校验链任务 | 报告引用进度路径，并核对 CP/批次/阻塞/验证状态 |
| OfficialDocsEvidence | 新增/升级依赖、框架、SDK、平台 API、外部模块或外部平台能力判断 | 列出官方文档来源、版本/日期、关键用法、限制、兼容性 / 弃用 / Breaking Change 判断；N/A 时写 `skipReason` |
| ProfileImpactCheck | dev/fix 改变项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema | 列出是否更新 Profile、目标文件、diff/证据；N/A 时写 `skipReason` |
| Backlog Intake 真相复核 | 任务或批次直接来源于 `data/*.md` open/partial 项 | 列出 `candidateIds`、`classification`、`evidence`、`scopeDelta` |
| 台账状态回写闭环 | 本轮会关闭/部分关闭/改分类任何 VL/PF/PI/ISSUE/GAP | 列出 `targetLedgers`、`requiredFields`、`writebackEvidence`、`rescanResult` |
| ReviewFindingIntakeGate | 输入来自外部审查报告、AI review finding、audit issue 或代码评审发现 | 列出 finding 来源、本地证据、`must-fix / user-decision-required / docs-implementation-drift / test-coverage-gap / already-fixed-or-not-reproduced / intentional-design-accepted` 分类、用户确认点与最终处理 |
| FigmaHighFidelityRestorationGate / ScopedVisualChangeGate | Figma、截图、既有页面、高保真 UI 或局部视觉修复 | 列出设计来源、allowedScope/frozenScope、还原检查项、偏离理由和视觉证据 |
| ActualPreviewChainAndMockFallbackGate / UIStateScopeRegressionGate | 前端真实页面验证、mock fallback 风险或状态回归 | 列出真实 URL、API target、路由入口、受影响状态、主 CTA 可见性与 mock 排除证据 |
| FigmaProductionAssetBudgetGate / RuntimeI18nArtifactVerificationGate | 生产设计资产或多语言运行时验证 | 列出资产尺寸/体积/格式/public 路径、源 JSON、构建合并产物、页面 runtime key 残留 |
| ExplicitCommitAuthorizationGate / CompatibilityAndContractAuthorityGate | 执行 commit、兼容修复、共享库/adapter/SDK 或上游契约判断 | 列出用户明确授权、消费者零代码兼容、上游合同权威、官方 public API 证据和共享库优先判断 |
| UIConfirmedSourceConflictTraceGate / PublicDocsReleasedVersionGate | UI 主真相源覆盖旧 PRD，或公开文档描述版本能力 | 列出冲突表、采纳理由、同步路线、released/unreleased/preview 边界 |
| CollectionRelationIdNamingGate / UserFacingVerificationArtifactLanguageGate | 数据库/ORM 关系字段命名或用户可读验证产物 | 列出集合/实体命名依据、项目 convention、用户当前语言和例外理由 |

## 输出规则

- 每次会话必须写入报告文件（**chat 豁免**，[C05/S05](../../instructions/00-safety.instructions.md)）
- 报告中每条建议/问题必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围）— 与 [`17-compliance`](../compliance/SKILL.md) §1 输出验证保持一致
- analyze / audit / self-fix / dev / fix 报告中，若出现多个可执行建议、多个后续路径、方案对比或用户决策点，必须新增 `## 推荐结论` 或 `## 推荐方案`：推荐项有且仅有 1 个，并说明“推荐理由”；无后续动作时写 `推荐：无后续动作` 与原因
- 若最终采纳的是用户原始方案，报告中也必须写明“经独立验证后采纳”及其证据来源，避免形成“顺从结论”的假象
- audit / analyze / self-fix 的汇总型报告默认采用“两层问题清单”：先列根因级问题，再展开逐文件完整落点；边界/非缺陷结论单独成节，不混入缺陷编号
- 报告写入后必须执行 [`compliance`](../compliance/SKILL.md) Skill §5 二次验证（V1~V6）
- `dev` / `fix` 报告在最终宣告完成前，必须显式体现“ECR 执行闭环复审”这一正式阶段，并与 CP1/CP2/CP3、关键产物、报告、daily tasks、SUMMARY、diff/commit、测试/扫描证据和 dirty 边界完成 1 轮复审对照；若发现阻断性问题，不得直接以“已完成”收尾
- 跨会话、跨 Agent、多批次、summary/compact 前、用户要求“传递上下文”或未完成任务的报告必须包含 `ContextHandoffCard`；已完成且无需交接时写 `ContextHandoffCard: N/A + skipReason`
- `dev` / `fix` 报告的 ECR 必须把触发的 ExecutionContract / TestRoute / ReleaseAudit / ReleaseVerification / ConceptSyncMap / HostContractVerification / OfficialDocsEvidence / ProfileImpactCheck / 05-实施进度.md 纳入关键产物核对；未触发时写明 N/A 判定依据
- 若本轮来源于 backlog open/partial 项，报告必须额外写出 Backlog Intake 真相复核结果；若本轮改变了台账真实状态，报告必须额外写出台账状态回写闭环证据
- 报告涉及记录规范问题时，必须列出规范化意图、置信度、依据、目标台账；涉及规范源、Skill、Hook、CLI、MCP、模板、部署副本、路径规则或 validate 语义变更时，必须列出 SCV-0~SCV-7 证据
- 报告涉及审查报告、AI review finding、audit issue 或代码评审发现 intake 时，必须列出 `ReviewFindingIntakeGate` 证据；不得只写“按报告修复”或把报告结论当已验证事实
- 报告涉及新增跨项目已吸纳守门时，必须按触发情况列出 `FigmaHighFidelityRestorationGate`、`ScopedVisualChangeGate`、`InstalledPluginVisualVerificationGate`、`ActualPreviewChainAndMockFallbackGate`、`UIStateScopeRegressionGate`、`FigmaProductionAssetBudgetGate`、`RuntimeI18nArtifactVerificationGate`、`ExplicitCommitAuthorizationGate`、`CompatibilityAndContractAuthorityGate`、`UIConfirmedSourceConflictTraceGate`、`PublicDocsReleasedVersionGate`、`CollectionRelationIdNamingGate` 与 `UserFacingVerificationArtifactLanguageGate` 的证据或 `N/A + skipReason`
- 控制面报告若出现新增探针、黄色偏离或部署同步，必须单独写出部署同步证据与其他证据来源，不能只在摘要里带过
- 报告末尾引用本次会话记忆路径
- 回复末尾必须输出产物文件路径（按 `ArtifactLinkSet` 输出主 Markdown 链接；当前宿主为 Codex Desktop/App、Copilot、未知宿主或用户反馈无法点击时，追加 `绝对路径：` copy fallback，详见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) §产物路径输出格式，[FC5](../compliance/SKILL.md)）

## 行数与拆分

- [C13](../../instructions/01-common.instructions.md) 只约束新建 DevCodex 规范资产 `.md`；报告不因 C13 强制压缩或拆分，超长报告按可读性、索引导航和项目规范决定是否拆分

## 写入工具选择（v1.9.4+）

新建报告预计 ≥ 200 行 → **Write 单次写入**（避免 Edit 多段写入被 session limit 截断；详见 [`16-report.instructions.md §写入工具选择`](../../instructions/16-report.instructions.md)）。已有报告小修订 → Edit。

## 跨会话报告

| 场景 | 处理 |
|------|------|
| 同一任务跨多会话 | 每次会话创建**独立报告文件**，不追加到前一份 |
| 修复后再审 | 独立文件，头部引用原始审查报告路径 |
| Token 中断恢复 | 新报告标注"恢复自会话 NN" |

> ⚠️ `dev` / `fix` 的“修复后再审/再次实施”并不自动等于收敛；仍须满足 ECR 执行闭环复审规则，确认最后一次阻断性修正后已有 1 轮无新增阻断问题的复审。

## 模板引用

| 报告类型 | 模板 |
|---------|------|
| 分析报告 | `prompts/report-analysis.prompt.md` |
| 审查报告 | `prompts/report-audit.prompt.md` |
| 规范自修复报告 | `prompts/report-audit.prompt.md`（结构相同，路径映射 `self-fix/`）|
| 开发报告 | `prompts/report-dev.prompt.md` |
| 开发报告（性能优化） | `prompts/report-optimization.prompt.md` |
| 开发报告（场景测试） | `prompts/report-scenario-test.prompt.md` |
| 修复报告 | `prompts/report-fix.prompt.md` |
