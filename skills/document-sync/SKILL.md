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
| `CHANGELOG.md` | 🟡 条件 | 仅正式发版时更新已发布版本索引 |
| `README.md` | 🔴 必查 | 安装/使用/API 说明与代码一致 |
| `05-实施进度.md` | 🟡 条件 | 多批次、预计 ≥10 文件、跨轮次、阻塞或用户要求持续跟踪的任务必须更新当前批次状态 |
| `.env.example` | 🔴 必查 | 有新增/修改/删除共享环境变量时同步更新示例文件，禁止遗漏；仅本地专用 `.env.local` / `.env.test.local` 或临时 task config 不在此列 |
| `.devcodex/profile/01-项目信息.md` / `02-架构约束.md` | 🟡 条件 | 当工作流边界、分发面、活动版本入口或当前规则事实变更时同步 |
| `RULES.md` | 🟡 条件 | 当入口路由、工作流说明、当前可用状态或使用方式变更时同步 |
| `website/docs/guide/*.md` | 🟡 条件 | 当面向使用者的流程指南、开发说明、发布说明变更时同步 |
| `website/docs/specs/*.md` | 🟡 条件 | 当永久规范页中的当前行为、流程图、规则说明变更时同步 |
| `website/docs/versions/v1/<active-version>/requirements/**` | 🟡 条件 | 当正式需求入口、模板职责边界或活动版本 requirement 口径变更时同步 |
| `TASK-INDEX.md` | 🟡 条件 | 项目存在任务索引时更新任务状态 |
| `STATUS.md` | 🟡 条件 | 项目存在状态看板时同步当前版本状态/功能完成度 |

## 触发时机

所有 dev/fix 工作流在执行阶段完成后**自动触发**文档同步检查。

## 执行流程

| 步骤 | 动作 |
|------|------|
| 1 | 读取本次变更内容（diff 或变更摘要），必要时先建立 Concept Sync Map |
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

1. 先将 `changelogs/unreleased.md` 中待发布条目归档到 `changelogs/vX.Y.Z.md`
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

**DevCodex 类仓库检查点**：
- 分发面说明是否仍与当前 `agents / instructions.md / hooks` 事实一致
- `token-check` 是否仍被描述为授权占位，而非当前 tier 门控
- `ENV_MODE` 是否仍按当前 `dev / prod` 规则说明，而不是 Draft
- 正式需求入口是否仍指向 `website/docs/versions/v1/<active-version>/requirements/`
- 支撑型 Skill（`execution-contract` / `test-router` / `release-verification` / `host-contract-verification` / `source-consumer-sync`）的注册、触发说明、报告模板、validate 探针和用户文档是否一致
- 控制面任务是否已建立 Concept Sync Map，并把当前消费者、历史镜像、validate 探针、部署副本与黄色偏离边界说明清楚
- 宿主契约相关变更是否补了 HostContractRoute 证据，而不是只改文档叙述
- 多批次任务的 `05-实施进度.md` 是否随批次完成更新

## 豁免

- `dev-docs` 子类型（文档本身就是产物，不触发文档同步）
- `analyze` / `audit` 工作流（只读，不触发）
- `chat` 意图（豁免所有后置处理）
