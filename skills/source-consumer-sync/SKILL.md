---
name: source-consumer-sync
description: 真相源-消费者同步规范 — 为规范源、模板、validate、文档站与部署副本变更建立 Concept Sync Map，区分当前消费者与历史镜像
---
# Source Consumer Sync Skill

## 职责

当任务会修改 instructions、skills、prompts、validate、README、website、Profile 或部署副本口径时，本 Skill 负责建立 Concept Sync Map，明确：

- 哪个文件是当前真相源
- 哪些文件是当前消费者，必须同批同步
- 哪些文件只是历史镜像，可以在满足条件时保留
- 哪些 validate probes、targeted tests 与部署副本必须一起更新

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 控制面 / 规范源 / 模板 / validate / 报告模板变更 | 🔴 必须 |
| README / website / Profile 当前行为说明变更 | 🔴 必须 |
| 部署副本同步口径变更 | 🔴 必须 |
| 仅局部业务代码改动 | N/A |

## Concept Sync Map

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `sourceOfTruth` | ✅ | 当前事实源，例如 `instructions.md`、某个 Skill、某个 prompt 或脚本 |
| `currentConsumers` | ✅ | 当前会被用户、runtime、validate 或部署副本实际消费的文件 |
| `historicalMirrors` | 条件 | 仅作归档/历史基线的文件，允许保留旧事实但必须明确历史性质 |
| `validateProbes` | ✅ | `validate` 编号、targeted tests 或其他自动化探针 |
| `deployCopies` | 条件 | `.github/`、`.claude/`、`AGENTS.md`、`.agents/`、`.codex/` 等需要同步的副本 |
| `yellowDeviationBoundary` | ✅ | 哪些新增当前消费者/探针可以按黄色偏离收口，而不需要回 CP2 |

## 分类规则

### 当前消费者

满足任一条件即视为当前消费者，本轮必须同步：

- 当前 README / website / guide / Profile 正在描述现行行为
- validate / targeted tests 直接依赖该描述或字段
- 部署副本会把该内容发给实际宿主
- 报告模板、实施模板会在下一轮继续消费该字段

### 历史镜像

仅在以下条件同时满足时，才可作为历史镜像暂不改动：

1. 文档已明确标注历史版本/基线/归档。
2. 页面不再以“当前行为”口吻描述现状。
3. 本轮 validate 或 targeted tests 不把它当作当前消费者。

## 执行步骤

1. 锁定本轮 `sourceOfTruth`。
2. 建立 `currentConsumers` / `historicalMirrors` 清单。
3. 为当前消费者补齐 `validateProbes` 和必要 targeted tests。
4. 列出 `deployCopies`，确认是否需要执行 `devcodex update`。
5. 定义 `yellowDeviationBoundary`，把允许纳入的额外消费者写入进度或报告。
6. 实施后做双向联查：正向 grep 真相源，反向 grep 旧口径残留。

## Registry 驱动的同步面

规范吸纳、控制面或历史规则分层时，不在本 Skill 维护版本号清单。执行方必须读取 `../spec-governance/gate-registry.json`，用 `gateGroup` 找到 `ownerSkills / requiredEvidence / route / legacyAnchors`，再建立本轮 Concept Sync Map。

每个适用分组至少核对：

1. 规范真相源与目标 Owner Skill。
2. Prompt/template、TestRoute、report schema 等当前执行消费者。
3. validate/targeted/negative fixture 等验证探针。
4. README、website、Profile 和 changelog 等公开消费者。
5. AGENTS、CLAUDE、Copilot、Codex、plugin package 等部署副本。
6. 历史镜像及其失效、保留或兼容边界。

跨仓消费者验证、Profile/宿主能力、修复协作、发布凭据、用户文档、派生消费者与返工闭环等专属字段由 registry 指向的 Owner Skill 定义。本 Skill 只保存关系、同步状态和偏离原因，不复制 Owner 的完整门禁正文。

历史 V73~V95 名称只作为 registry `legacyAnchors` 的检索入口；新增版本不得继续扩展本文件的版本专属长列表。

## 黄色偏离边界

以下情况可按黄色偏离处理，但必须记录到实施进度或报告：

- 为同一事实新增一个当前消费者或一个 validate probe
- 因部署同步需要追加一个当前副本检查点
- 为避免“真相源已修、当前消费者未修”补同步少量当前页面

以下情况不是黄色偏离：

- 新增另一套真相源
- 把当前页面降格为历史镜像但未明确标注
- 扩大到大批历史归档翻修

## 输出格式

```markdown
## ConceptSyncMap

| 字段 | 内容 |
|------|------|
| sourceOfTruth | |
| currentConsumers | |
| historicalMirrors | |
| validateProbes | |
| deployCopies | |
| yellowDeviationBoundary | |
```

## 与其他 Skill 的关系

- `spec-governance`：SCV-1 的核心输入来自本 Skill 的 Concept Sync Map。
- `execution-contract`：通过 `consumerScope` 和 `deviationLog` 约束同步边界。
- `document-sync`：实施后根据 Concept Sync Map 判断 README / website / Profile / changelog 等是否必须同步。
- `report`：控制面任务报告中需显式列出 Concept Sync Map、黄色偏离和部署同步证据。
