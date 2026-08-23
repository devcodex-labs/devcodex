---
name: document-sync
description: 文档同步规范 — 代码变更后同步必查与条件文档
---
# Document Sync Skill

## 职责

在 dev/fix 工作流执行完成后，确保以下核心文档与代码变更保持同步：

| 文档 | 同步级别 | 同步内容 |
|------|:--------:|---------|
| `changelogs/unreleased.md` | 🔴 必查 | 用户未明确要求发版时的未发布实现变更记录 |
| `changelogs/README.md` | 🟡 条件 | changelog 目录结构或发布归档路径变化时同步说明 |
| `CHANGELOG.md` | 🟡 条件 | 仅正式发版时更新已发布版本索引 |
| `README.md` | 🔴 必查 | 安装/使用/API 说明与代码一致 |
| `05-实施进度.md` | 🟡 条件 | 多批次、预计 ≥10 文件、跨轮次、阻塞或用户要求持续跟踪的任务必须更新当前批次状态 |
| `.env.example` | 🟡 条件 | 用户 / 项目明确选择共享环境变量方案，或已有共享环境变量发生新增/修改/删除时同步更新示例文件；未指定 env 时不得主动把明文或硬编码改成 `.env.example`、`.env.local`、`.env.test.local`、`*Env`、secretRef 或 secret manager |
| `.devcodex/profile/README.md` / `01-项目信息.md` / `02-架构约束.md` / `03-代码风格.md` | 🟡 条件 | 命中 `ProfileImpactCheck` 时同步；包括技术栈、框架/SDK、依赖管理、目录/模块边界、脚本/测试/发布路线、分发面、配置项、长期连接、`config.local.json` schema 或当前阶段变化 |
| `RULES.md` | 🟡 条件 | 当入口路由、工作流说明、当前可用状态或使用方式变更时同步 |
| `website/docs/guide/*.md` | 🟡 条件 | 当面向**使用者**的流程指南变更时同步（`audience=public-user`） |
| `website/docs/**/contributing*` / `docs/dev/**` / maintainer 分区 | 🟡 条件 | 当**维护者**开发/贡献/发版文档变更时同步（`audience=maintainer-dev`） |
| `website/docs/specs/*.md` | 🟡 条件 | 当永久规范页中的当前行为、流程图、规则说明变更时同步 |
| website sidebar/nav / README 索引 / 目录页 | 🟡 条件 | 当正文定义阅读顺序、审查顺序、实施顺序或“先看什么”时，同批校验导航、sidebar 与索引页是否按同一顺序呈现；**跨受众导航变更须两边各验** |
| `DocsConsumerSweep` | 🟡 条件 | 文档新增/调整命令、配置项、字段、状态、路径、能力承诺、阅读顺序或用户路径时，扫描 README / website / Profile / prompts / templates / examples / nav/sidebar / validate probes / 部署副本与代码消费位置 |
| `website/docs/versions/v1/<active-version>/requirements/**` | 🟡 条件 | 当正式需求入口、模板职责边界或活动版本 requirement 口径变更时同步 |
| `TASK-INDEX.md` | 🟡 条件 | 项目存在任务索引时更新任务状态 |
| `STATUS.md` | 🟡 条件 | 项目存在状态看板时同步当前版本状态/功能完成度 |

## 触发时机

所有 dev/fix 工作流在执行阶段完成后**自动触发**文档同步检查。

## audience-aware consumerMap

建立或更新 Concept Sync Map / consumerMap 时，每项建议带：

| 字段 | 说明 |
|------|------|
| `audience` | `public-user` \| `maintainer-dev` \| `shared` |
| `docsSurface` | guide/readme/reference/maintainer/…（可选） |
| `path` | 消费者路径 |

- 用户站变更默认扫描 `public-user` 消费者（README 主路径、guide、用户向 examples）。  
- 维护者站变更默认扫描 `maintainer-dev` 消费者（CONTRIBUTING、dev 分区、发版 runbook）。  
- `shared`（如版本号）两边都可列，但**不得**用维护者 checklist 覆盖用户主路径同步结论。

## 执行流程

| 步骤 | 动作 |
|------|------|
| 1 | 读取本次变更内容（diff 或变更摘要），必要时先建立 Concept Sync Map（含 audience） |
| 2 | 区分当前消费者与历史镜像，确认本轮必须同步的当前文档与可保留的历史归档 |
| 3 | 逐一检查必查文档，并确认条件文档是否存在/启用 |
| 4 | 更新需要同步的文档 |
| 5 | 确认文档与代码一致（版本号/API/配置项） |

### 文档即产品仓库的附加检查

当仓库自身以 profile、规则页和文档站作为正式产品入口时，除通用必查项外，还应补查：

- profile 真相源：`.devcodex/profile/01-项目信息.md` / `02-架构约束.md`
- 入口说明：`RULES.md`
- 使用者指南：`website/docs/guide/*.md`
- 永久规范页：`website/docs/specs/*.md`
- 当前活跃版本 requirement：`website/docs/versions/v1/<active-version>/requirements/**`

### 当前消费者 vs 历史镜像

- 当前消费者：仍以“当前行为”口吻描述现状，或会被 validate / 部署副本 / 模板继续消费；本轮必须同步。
- 历史镜像：只保留基线、归档或历史阶段事实；只有明确标注历史性质时，才允许暂不改动。
- 控制面任务建议先调用 `source-consumer-sync`，把 Concept Sync Map 写清后再执行文档同步。
- README 作为当前用户入口发生变化时，由 `readme-authoring` 收口写作路径；需要专项复审时联动 `audit-readme`，不得用通用文档同步检查替代其用户路径与消费链证据。

## 同步规则

**未明确发版时（默认）**：

```markdown
## YYYY-MM-DD
- **[主题]** 未发布变更摘要
```

- 每完成一个**已验证的语义变更批次**，默认更新 `changelogs/unreleased.md`
- 在完成上述记录后，默认建议执行**本地 `commit`** 作为回滚锚点，但不默认 `push`
- `commit` 不按“问题个数”切分，遵循 `01-common` 的语义批次提交边界

**正式发版时**：

1. 先将 `changelogs/unreleased.md` 中待发布条目归档到 `changelogs/releases/vX.Y.Z.md`
2. 再更新根 `CHANGELOG.md`

**CHANGELOG.md 格式**：
```markdown
## [版本号] - YYYY-MM-DD
### Added / Changed / Fixed / Breaking Changes
- 变更描述
```

**README.md 检查点**：
- 版本号标注
- 安装步骤（依赖版本）
- API 示例代码（与实现匹配）
- 配置项说明（完整且准确）
- 目标用户 / 使用者是否明确
- 快速开始与常见用法是否仍能形成最短成功路径
- 开发 / 贡献信息是否仍后置，没有抢占主叙事

**DevCodex 类仓库检查点**：

- 读取 `../spec-governance/gate-registry.json`，按本次适用 `gateGroup` 建立 Concept Sync Map；具体 Gate 字段和验证路线由 registry 指向的 Owner Skill 定义。
- 核对规范真相源、Owner Skill、Prompt/template、TestRoute/report schema、validate/targeted tests、README/website/Profile/changelog、plugin/portfolio 与部署副本。
- README、用户手册和站点文档继续验证首次成功路径、受众、导航/正文顺序、配置/错误/恢复以及维护者内容边界。
- Profile、runtime、宿主、package/release、用户文档、外部消费者、派生消费者或多批次证据发生变化时，按适用 Owner 追加专属证据，不在本文件复制版本专属 Gate 总表。
- 历史 Vxx、CrossProject 与 A1~A10 名称只通过 registry `legacyAnchors` 检索；找不到等强度承接方时标记 `legacy-index-retained`，不得直接删除或继续扩展长清单。
- 文档定义阅读/审查/实施顺序时，Concept Sync Map 必须对账正文、导航/sidebar 与 README/索引顺序；故意不同须说明理由。
- 宿主契约和多批次任务分别保留 HostContractRoute 证据与最新 `05-实施进度.md`。
- 用户可见输出契约变化时，把 `ArtifactDeliveryManifestV1 → UserFacingArtifactSetV1 → PostCompletionActionSetV1 → DevCodexVisibleEnvelopeV2 → LinkCapabilityDecisionV1` 同步到 instructions、report/memory/compliance/TestRoute、precheck/progress/delivery/report prompts、visible Hook、README、website、Profile、plugin/portfolio、package 与 validate probes；V1 只保留兼容读取，历史归档可保留旧表述，但当前消费者不得继续写 V1、按宿主名强制绝对路径或把 internal-only 文件默认列给用户。

### ProfileImpactCheck

dev/fix 执行完成后必须显式判定 `ProfileImpactCheck`：

| 触发项 | 同步目标 | 证据 |
|--------|----------|------|
| 技术栈、框架、SDK、依赖管理器变化 | `01-项目信息.md` 技术栈 / 依赖 / 验证路线 | diff + report |
| 目录结构、模块边界、分发面、宿主能力变化 | `02-架构约束.md` 目录 / 模块职责 / 分发边界 | diff + ConceptSyncMap |
| 代码风格、脚本、测试、构建、发布命令变化 | `03-代码风格.md` 或 `01-项目信息.md` | package/script diff + TestRoute |
| 共享配置、环境变量、长期连接、`config.local.json` schema 或 `extensions.<namespace>` 变化 | Profile README / `01-项目信息.md` / config 说明 | config diff + S02 用户 / 项目策略检查 |
| 当前阶段、活跃版本、任务现实、发布状态变化 | `01-项目信息.md` 当前开发重点 | release / task report |

- 若无需同步，报告必须写 `ProfileImpactCheck: N/A` 与 `skipReason`，例如“仅修正文案 typo，不影响技术栈/目录/配置/验证路线”。
- Profile Freshness Check 是 audit 的事后审查；不能替代 dev/fix 中的 `ProfileImpactCheck` 主动判定。

## 豁免

- `dev-docs` 子类型（文档本身就是产物，不触发文档同步）
- `analyze` / `audit` 工作流（只读，不触发）
- `chat` 意图（豁免所有后置处理）
