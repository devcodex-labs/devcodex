# data/ — 运行时数据目录

## 结构

```
data/
├── templates/                      ← 随 npm 包分发给用户（空模板）
│   ├── violations.md
│   ├── pending-fixes.md
│   ├── pending-issues.md
│   ├── process-improvements.md
│   └── gap-registry.md
└── README.md                       ← 本文件
```

目标项目初始化后的 **active-root** 还会包含运行时治理台账控制文件；这些文件不等于源码包 `data/` 根目录：

```text
<active-root>/
├── data/
│   ├── governance-ledger-manifest.json  ← 台账文件集合、摘要与 nextSequence 的唯一真相源
│   ├── *.md                             ← 当前活动台账，也是唯一写入目标
│   └── archive/<family>/<year>/*.md     ← manifest 引用的只读 immutable shard
└── .memory/indexes/governance-ledgers.json ← 可从 manifest + 台账重建的派生索引
```

## v1.6.0 变更说明（重要）

**变更前（v1.5.x）**：`data/` 直接包含维护者自身的违规/过程记录；`npm pack` 会把 `violations.md` 等**连同真实项目名与历史数据**发给所有用户。

**变更后（v1.6.0）**：
- 维护者状态不再放在源码包 `data/` 根目录中，避免随 npm 包分发
- `data/templates/` 仅保留空模板 + schema + 1 条 EXAMPLE
- `package.json "files"` 白名单改为 `data/templates/`，精确控制分发

**当前规则（workspace-namespace）**：
- 维护者实际记录按 active-root 写入，例如单项目 `.devcodex/<project>/data/*.md`
- 全工作区治理记录写入 `.devcodex/workspace/data/*.md`
- 旧 `.devcodex/.maintainer-state/` 只作为历史迁移口径，不作为当前写入目标

## init 行为

`devcodex init`、`devcodex init --claude` 与 `devcodex init --codex` 都必须先在目标项目的 **active-root** bootstrap 运行时台账模板：

- 旧布局：`<项目根>/.devcodex/data/*.md`
- workspace-namespace 单项目：`<工作区根>/.devcodex/<project>/data/*.md`
- workspace-namespace 全工作区：`<工作区根>/.devcodex/workspace/data/*.md`

普通非 dry-run 的 `devcodex init` / `devcodex update` 还会对既有台账执行**零搬迁初始化**：创建或复核 `GovernanceLedgerManifestV1`，再重建 `.memory/indexes/governance-ledgers.json`。这一步不改写现有 Markdown 台账，也不会自动把历史记录移入 archive；`--dry-run` 保持零写入。需要分片时，先显式运行只读 `devcodex governance ledger plan --kind GR --json`，再用其精确 `planDigest` 执行 apply。

同时，默认 `init` / `init --claude` 仍会把模板副本分发到宿主部署目录，作为随 adapter 下发的辅助副本：

- Copilot：`.github/data/*.md`
- Claude Code：`.claude/data/*.md`
- Codex：不分发 `.codex/data/`，运行时只认 active-root `data/*.md`
- 规范正文中写 `data/*.md` 时，表示目标项目运行时台账的逻辑路径，不表示源仓根 `data/` 保存真实记录。

## 路径语义

规范文件里出现的以下路径，默认都指**目标项目 / 已部署副本的运行时台账路径**：

- `data/violations.md`
- `data/pending-fixes.md`
- `data/pending-issues.md`
- `data/process-improvements.md`
- `data/pending-issues.md`
- `data/gap-registry.md`
- `data/governance-ledger-manifest.json`
- `data/archive/<family>/<year>/*.md`
- `.memory/indexes/governance-ledgers.json`

而在**源仓**里：

- `data/templates/*.md`：仅提供空模板与允许的 EXAMPLE 行
- `.devcodex/<project>/data/*.md`：workspace-namespace 下单项目维护者实际记录，不参与 npm 分发
- `.devcodex/workspace/data/*.md`：workspace-namespace 下全工作区维护者实际记录，不参与 npm 分发
- active-root `data/governance-ledger-manifest.json`：PI/PF/VL/GR/ISSUE 活动文件、immutable shard、reopened overlay 与 `nextSequence` 的 canonical 清单
- active-root `data/archive/<family>/<year>/*.md`：只读归档分片；普通 writer 不得追加或改写
- active-root `.memory/indexes/governance-ledgers.json`：只读消费者的派生索引，损坏或缺失时从 canonical 清单重建

换句话说，规范里写 `data/*.md` 时，表达的是“应该把记录落到运行时台账”，不是说源仓根 `data/` 目录里直接保存真实记录。

## 问题池说明

- `data/pending-fixes.md`：承载运行时 PF（规范缺口）记录，主要由 PC4 / spec-radar / audit 轻量登记使用
- `data/pending-issues.md`：承载**已确认但不阻断当前任务**的治理改进项，按批次进入后续需求或 bug 修复流程
- `data/process-improvements.md`：即“优化清单（PI）”，只记录“已确认更优且可泛化的执行策略”，不替代前两者
- `data/violations.md`、`data/pending-fixes.md`、`data/process-improvements.md`、`data/pending-issues.md`、`data/gap-registry.md` 的写入必须先经 `spec-governance` 的 RecordRouter 分流，记录规范化意图、置信度、依据和目标台账
- 若改进建议针对 DevCodex 规范自身、Hook、Skill、模板、validate 或宿主适配链路，而不是当前业务项目，则 `PI/PF` 应写回承载 DevCodex 规范资产的 active-root；不要把规范治理建议落到业务项目台账
