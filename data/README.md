# data/ — 运行时数据目录

## 结构

```
data/
├── templates/                      ← 随 npm 包分发给用户（空模板）
│   ├── violations.md
│   ├── pending-fixes.md
│   ├── process-improvements.md
│   └── gap-registry.md
└── README.md                       ← 本文件
```

## v1.6.0 变更说明（重要）

**变更前（v1.5.x）**：`data/` 直接包含维护者自身的违规/过程记录；`npm pack` 会把 `violations.md` 等**连同真实项目名与历史数据**发给所有用户。

**变更后（v1.6.0）**：
- 维护者状态迁移到仓库根 `.devcodex/.maintainer-state/`（不分发）
- `data/templates/` 仅保留空模板 + schema + 1 条 EXAMPLE
- `package.json "files"` 白名单改为 `data/templates/`，精确控制分发

## init 行为

`devcodex init` 将 `data/templates/*.md` 复制到用户项目的 `.github/data/*.md`（目标路径向后兼容，不变）。

## 路径语义

规范文件里出现的以下路径，默认都指**目标项目 / 已部署副本的运行时台账路径**：

- `data/violations.md`
- `data/pending-fixes.md`
- `data/pending-issues.md`
- `data/process-improvements.md`

而在**源仓**里：

- `data/templates/*.md`：仅提供空模板
- `.devcodex/.maintainer-state/`：维护者自己的实际记录，不参与 npm 分发

换句话说，规范里写 `data/*.md` 时，表达的是“应该把记录落到运行时台账”，不是说源仓根 `data/` 目录里直接保存真实记录。

## 问题池说明

- `data/pending-fixes.md`：承载运行时 PF（规范缺口）记录，主要由 PC4 / spec-radar / audit 轻量登记使用
- `data/pending-issues.md`：承载**已确认但不阻断当前任务**的治理改进项，按批次进入后续需求或 bug 修复流程
- `data/process-improvements.md`：只记录“已确认更优的执行策略”，不替代前两者
