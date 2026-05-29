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

`devcodex init` / `devcodex init --claude` 将 `data/templates/*.md` 复制到目标项目的运行时数据目录：

- Copilot：`.github/data/*.md`
- Claude Code：`.claude/data/*.md`
- 规范正文中写 `data/*.md` 时，表示目标项目运行时台账的逻辑路径，不表示源仓根 `data/` 保存真实记录。

## 路径语义

规范文件里出现的以下路径，默认都指**目标项目 / 已部署副本的运行时台账路径**：

- `data/violations.md`
- `data/pending-fixes.md`
- `data/pending-issues.md`
- `data/process-improvements.md`

而在**源仓**里：

- `data/templates/*.md`：仅提供空模板与允许的 EXAMPLE 行
- `.devcodex/<project>/data/*.md`：workspace-namespace 下单项目维护者实际记录，不参与 npm 分发
- `.devcodex/workspace/data/*.md`：workspace-namespace 下全工作区维护者实际记录，不参与 npm 分发

换句话说，规范里写 `data/*.md` 时，表达的是“应该把记录落到运行时台账”，不是说源仓根 `data/` 目录里直接保存真实记录。

## 问题池说明

- `data/pending-fixes.md`：承载运行时 PF（规范缺口）记录，主要由 PC4 / spec-radar / audit 轻量登记使用
- `data/pending-issues.md`：承载**已确认但不阻断当前任务**的治理改进项，按批次进入后续需求或 bug 修复流程
- `data/process-improvements.md`：即“优化清单（PI）”，只记录“已确认更优且可泛化的执行策略”，不替代前两者
- `data/violations.md`、`data/pending-fixes.md`、`data/process-improvements.md`、`data/pending-issues.md`、`data/gap-registry.md` 的写入必须先经 `spec-governance` 的 RecordRouter 分流，记录规范化意图、置信度、依据和目标台账
- 若改进建议针对 DevCodex 规范自身、Hook、Skill、模板、validate 或宿主适配链路，而不是当前业务项目，则 `PI/PF` 应写回承载 DevCodex 规范资产的 active-root；不要把规范治理建议落到业务项目台账
