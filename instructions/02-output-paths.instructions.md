---
applyTo: "**"
priority: 5
version: "1.0.0"
source: "v4:specs/output-paths.md"
description: "产物输出路径规范 — 全局强制，所有工作流产物必须遵循此路径体系"
---

# 产物输出路径规范

> 🔴 所有路径以 `projects/<project>/` 为根，禁止写入项目源码目录。  
> 🔴 禁止在 `projects/<project>/` 下创建规范路径之外的一级目录。

## 目录结构

```text
projects/<project>/
├── requirements/<中文描述>/          # 需求产物（dev 默认）
│   ├── 01-需求概述.md               # 🔴 强制
│   ├── 02-技术方案.md               # 🔴 强制（有架构/接口/设计决策时）
│   ├── 03-实施方案/                  # 🔴 强制
│   ├── 04-实施计划.md               # 🔴 强制
│   ├── 05-实施进度.md               # 🔴 强制（任务跨 2 轮以上会话时）
│   ├── *-接口验证.http              # 🔴 强制（有接口变更时）
│   ├── *-接口验证.cjs               # 🔴 强制（有接口变更时）
│   ├── .ai-memory/sessions.md       # 🔴 强制（需求级记忆）
│   ├── .tmp/                        # 临时文件（.gitignore 排除）
│   └── reports/<agent>/YYYYMMDD/    # 🔴 强制（需求级报告）
├── bugs/<中文描述>/                  # Bug 修复产物（fix）
├── optimizations/<中文描述>/         # 优化产物（dev > 性能优化）
├── migrations/                        # 数据库迁移脚本
├── scenario-tests/<中文描述>/        # 场景测试产物
├── reports/<子目录>/<agent>/YYYYMMDD/ # 全局报告（NN--<简述>.md）
├── .ai-memory/clients/<agent>/tasks/YYYYMMDD.md  # 记忆
├── profile/README.md                  # 项目规范
├── TASK-INDEX.md                      # 任务索引
└── README.md
```

## 目录规则

| 规则 | 说明 |
|------|------|
| **目录命名** | `<中文描述>` 必须描述本任务的目标，禁止复用其他任务的目录 |
| **任务隔离** | 每个 `<中文描述>/` 目录只服务一个明确任务 |
| **禁止非规范路径** | `projects/<project>/` 下只允许上述目录树中的一级目录 |
| **脚本命名** | `scripts/` 目录下的文件名必须使用**中文** |
| **禁止写入源码目录** | 脚本/测试/辅助文件严禁放入项目源码目录 |
| **强制产物首轮完成** | 01/02/03/04 在首轮会话结束前必须创建 |

## 报告路径

```text
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

- 子目录：`analysis/` · `audit/` · `bugs/` · `requirements/` · `optimizations/`
- `NN`：当日序号，从 `01` 起递增
- `--`：双横杠分隔序号与简述

## 记忆路径

```text
.ai-memory/clients/<agent>/tasks/YYYYMMDD.md
```

每天一个文件，文件内以 `## 会话 NN` 分段。

## 产物路径输出格式

每轮回复中涉及文件新建或修改时，在回复末尾输出：

```
📂 本次会话产物：
- [文件名（类型）](file:///E:/绝对路径)
  `E:\绝对路径`
```

> 🔴 Markdown 链接 + 纯文本路径双行均须输出。禁止询问"是否需要打开"；禁止省略产物路径输出。

## CHANGELOG 维护规范

| 版本类型 | `CHANGELOG.md` | `changelogs/` |
|---------|----------------|---------------|
| MAJOR / MINOR | 🔴 添加版本概览行 + 更新日期 | 🔴 创建 `changelogs/vX.Y.Z.md` |
| PATCH | 不新增版本概览行 | 追加到最近 MINOR 的 `changelogs/vX.Y.0.md` |
