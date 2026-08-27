---
agent: agent
description: 交付物完整性检查清单 — 需求开发完成后验证所有必要产物均已到位
applyTo: .devcodex/**/requirements/**
---
# 交付物完整性检查清单

> **触发时机**：dev 工作流 N6 方案一致性验证完成后，在宣告任务完成前执行。

## 必须产物（F-12）

| # | 产物 | 路径规范 | 状态 |
|:-:|------|---------|:----:|
| 1 | 纯新需求概况 | `.devcodex/**/requirements/<需求>/00-需求概况.md`（纯新需求来自用户/运营/老板/客户/内部使用方时 create/update；SimpleTaskFastPath 可 N/A） | ☐/N/A |
| 2 | 需求变更概况 | `.devcodex/**/requirements/<需求>/00-需求变更概况.md`（调整/修改/补充已确认需求时 create/update；纯新需求可 N/A） | ☐/N/A |
| 3 | 需求确认 | `.devcodex/**/requirements/<需求>/01-需求确认.md`（无产品角色时由 AI 生成草稿并双方确认；历史兼容 `01-需求概述.md`；已有真相源必须 update；SimpleTaskFastPath 可 N/A） | ☐/N/A |
| 4 | 产品完整需求 | `.devcodex/**/requirements/<需求>/01-产品需求.md`（有产品角色直接提供完整需求时 create/update；模板正文只给产品填写完整 PRD，AI / 研发缺口检查记录在 CP1 摘要、技术方案或报告中；无产品场景可 N/A） | ☐/N/A |
| 5 | 需求变更确认 | `.devcodex/**/requirements/<需求>/01-需求变更确认.md`（需求变更时 create/update，并回写目标需求真相源；纯新需求可 N/A） | ☐/N/A |
| 6 | 技术方案 | `.devcodex/**/requirements/<需求>/02-技术方案.md`（有架构/接口/设计决策时 create/update）| ☐/N/A |
| 7 | 实施计划 | `.devcodex/**/requirements/<需求>/04-实施计划.md`（CP3 触发时 create/update；轻路径或子类型豁免可 N/A） | ☐/N/A |
| 8 | 接口验证双产物 | `*-接口验证.http` + `*-接口验证.cjs`（有接口变更时；`.http` 须含 `@baseUrl` / `@token` / `@language` 标准变量）| ☐/N/A |
| 9 | 开发报告 | `.devcodex/**/requirements/<需求>/reports/<agent>/YYYYMMDD/NN--*.md`（无任务上下文时才回退到 `.devcodex/**/reports/requirements/...`） | ☐ |
| 10 | 记忆文件 | `.devcodex/**/.memory/clients/<agent>/tasks/YYYYMMDD.md` | ☐ |
| 11 | 需求级记忆 | `.devcodex/**/requirements/<需求>/.memory/sessions.md` | ☐ |

## 条件产物（F-17）

| # | 产物 | 触发条件 | 状态 |
|:-:|------|---------|:----:|
| 1 | 实施进度 | 跨多轮/多阶段、阻塞、用户要求持续跟踪、多批次、预计修改 ≥10 文件、控制面任务、模板-示例-校验链或部署同步联动；默认需 `04-实施计划.md`，CP3 豁免场景可用等价任务切片 / ContextHandoffCard | ☐/N/A |
| 2 | 行为核查清单 | 有多个业务规则需逐条验证时（使用 `behavior-checklist.prompt.md`）| ☐/N/A |
| 3 | 关键决策 | 多轮确认、范围变更、方案取舍、用户明确决策或与技术方案存在约束传递时，创建/更新 `06-关键决策.md` | ☐/N/A |
| 4 | Impact Review 报告 | PR-5② 跨模块架构依赖变更 | ☐/N/A |
| 5 | 数据库 Migration 文件 | 有 Schema 变更 | ☐/N/A |
| 6 | 未发布变更日志 | 用户可见行为、公开契约、CLI/Hook/API/config schema、维护者工作流或已确认的未发布实现发生变化时更新 `changelogs/unreleased.md`；纯内部重构、测试补强或无可见语义变化可 `N/A + skipReason` | ☐/N/A |
| 6a | 活跃需求版本日志 | 需求/规格或活动版本产品事实变化时更新 `website/docs/versions/v1/<active-version>/CHANGELOG.md`；仅实现既有需求可 N/A | ☐/N/A |
| 6b | 正式发布日志 | 仅用户明确授权 release 时更新根 `CHANGELOG.md` 与 `changelogs/releases/vX.Y.Z.md`；未授权发布必须 N/A | ☐/N/A |
| 7 | README 更新 | 有安装步骤/API/配置变更 | ☐/N/A |
| 8 | .env.example 更新 | 有新增/修改/删除环境变量 | ☐/N/A |
| 9 | ExecutionContract | Auto / 控制面 / 多批次 / 预计修改 ≥10 文件 / release 前置任务 | ☐/N/A |
| 10 | TestRoute | 跨模块、API、Hook/CLI、模板-示例-校验链或测试路线不明显 | ☐/N/A |
| 11 | ReleaseAudit | 发版前 review / publish 或 tag 前风险审查 | ☐/N/A |
| 12 | ReleaseVerification | 用户明确要求 tag / release / publish 或进入正式发版 | ☐/N/A |
| 13 | ConceptSyncMap | 控制面、模板-示例-校验链、README / website / Profile / validate / 部署副本联动 | ☐/N/A |
| 14 | HostContractVerification | Hook / CLI / visible reply / sticky project / workspace guard / bootstrap 相关任务 | ☐/N/A |
| 15 | CliDiagnosticContract | 机器可读 CLI、typed local probe、稳定错误码或 native exit 变化 | ☐/N/A |
| 16 | CheckpointValidation | response-time / post-execution checkpoint evidence 变化 | ☐/N/A |
| 17 | LocalTaskTrace | 当前 turn typed trace、terminal 或只读 replay 变化 | ☐/N/A |
| 18 | OfficialDocsEvidence | 新增/升级依赖、框架、SDK、平台 API、外部模块或外部平台能力判断 | ☐/N/A |
| 19 | ProfileImpactCheck | 项目技术栈、目录边界、脚本、测试/发布路线、分发面、配置项、长期连接或本地 overlay schema 变化 | ☐/N/A |

## 使用说明

1. 交付前逐行勾选；
2. 所有必须产物全部 ☐→✅；
3. 条件产物确认 N/A 是否成立（不成立须补充）；
4. 把所有 planned/observed/internal-delivered 文件登记到 `ArtifactDeliveryManifestV1`，rename/move/delete 保留 previousPath/tombstone；
5. 由 `UserFacingArtifactSetV1` 投影默认交付，检查 required hidden=0、`listed+remaining=total`；session/daily/SUMMARY/task/checkpoint/raw receipt/manifest/ledger 默认 internal-only；
6. 可见项必须使用 displayName/purposeText/userAction 与稳定 readingOrder，禁止“主要产物”；
7. 持久化投影继续使用 `LinkCapabilityDecisionV1`；用户面按 `HostLinkCapabilityDecisionV2.hostSurface + presentationSurface + rendererId + evidenceState` 选择 native-action/markdown-link/terminal-command/portable-path/absolute-copy/unavailable，未验证时降级而不推定可点击；
8. **ArtifactPathColumnGate（PF-175）**：每项必须有路径列/字段，默认 workspace-relative portable；自由文本表默认列=语义名称\|用途\|路径\|操作；
9. **禁止** 交付表只有「文件 \| 内容」+ 短文件名、无路径列（Grok 用户不可定位；与 PF-175 冲突）；
10. 完成后在报告中记录 `delivery-checklist: PASS`、manifestId、setId、semanticDigest 与 reconciliation。
