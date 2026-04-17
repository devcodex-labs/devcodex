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
