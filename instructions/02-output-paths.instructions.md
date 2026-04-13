---
applyTo: "**"
---
# 产物输出路径规范

> 🔴 所有路径以 `<项目根>/.devcodex/` 为根，与源码目录天然隔离，无需手动区分。  
> 🔴 禁止在 `.devcodex/` 下创建规范路径之外的一级目录。  
> ⚠️ `init` 命令自动将 `.devcodex/.memory/` 加入 `.gitignore`；`requirements/`、`bugs/`、`reports/` 等产物目录按需提交。

## 语言规则

> 目录名（`<描述>`）和产物文件名以**用户输入的主要语言**为准。下方示例使用中文；英文用户应使用对应英文命名（如 `requirements/add-login-feature/` → `01-requirements.md`）。语言检测规则见 [`00-safety.instructions.md`](./00-safety.instructions.md) §输出语言规则。

## 路径映射说明（v4 ↔ v1）

| 项目 | v4（[ai-dev-guidelines](../../ai-dev-guidelines/version/v4/specs/output-paths.md)）| v1（本文件）|
|------|------------|---------|
| 产物根 | `projects/<project>/` | `<项目根>/.devcodex/` |
| 记忆根 | `projects/<project>/.ai-memory/` | `<项目根>/.devcodex/.memory/` |
| 需求级记忆 | `<需求>/.ai-memory/sessions.md` | `<需求>/.memory/sessions.md` |
| Agent SUMMARY | `.ai-memory/clients/<agent>/SUMMARY.md` | `.memory/clients/<agent>/SUMMARY.md` |

> 两者**内部结构完全一致**（`clients/<agent>/tasks/YYYYMMDD.md`），差别仅在根路径。v1 采用 `.devcodex/` 统一伞下路径，v4 使用独立 `.ai-memory/` 根。

## 目录结构

```text
<项目根>/.devcodex/
├── requirements/<中文描述>/          # 需求产物（dev 默认）
│   ├── 01-需求概述.md               # 🔴 强制
│   ├── 02-技术方案.md               # ⚠️ 条件（有架构/接口/设计决策时）
│   ├── 03-实施方案/                  # ⚠️ 条件（多子模块/多阶段实施时，CP2 确认后创建）
│   │   └── *.md                     #   各子模块/阶段实施细节，不含时间线
│   ├── 04-实施计划.md               # 🔴 强制
│   ├── 05-实施进度.md               # 🔴 强制（任务跨 2 轮以上会话时）
│   ├── scripts/                     # ⚠️ 条件（有辅助脚本时，可提交）
│   │   └── <用途>.js / <用途>.sh    #   数据迁移/数据填充等辅助脚本；禁止放业务逻辑或网络请求
│   ├── *-接口验证.http              # 🔴 强制（有接口变更时）
│   ├── *-接口验证.cjs               # 🔴 强制（有接口变更时）
│   ├── .memory/sessions.md       # 🔴 强制（需求级记忆）
│   ├── .tmp/                        # 临时文件（.gitignore 排除）
│   └── reports/<agent>/YYYYMMDD/    # 🔴 强制（需求级报告）
├── bugs/<中文描述>/                  # Bug 修复产物（fix）
├── optimizations/<中文描述>/         # 优化产物（dev > 性能优化）
├── migrations/                        # 数据库迁移脚本
├── scenario-tests/<中文描述>/        # 场景测试产物
├── reports/<子目录>/<agent>/YYYYMMDD/ # 全局报告（NN--<简述>.md）
├── .memory/clients/<agent>/tasks/YYYYMMDD.md  # 记忆（.gitignore 排除）
├── profile/README.md                  # 项目规范（可提交）
├── TASK-INDEX.md                      # 任务索引
└── README.md
```

## 目录规则

| 规则 | 说明 |
|------|------|
| **目录命名** | `<中文描述>` 必须描述本任务的目标，禁止复用其他任务的目录 |
| **任务隔离** | 每个 `<中文描述>/` 目录只服务一个明确任务 |
| **禁止非规范路径** | `.devcodex/` 下只允许上述目录树中的一级目录 |
| **scripts/ 触发条件** | 任务目录（requirements/<任务>/ 或 bugs/<任务>/）下有辅助脚本（数据迁移/数据填充/自动化验证等）时创建对应 `scripts/` 子目录；禁止放入业务逻辑或网络请求。`*-接口验证.cjs` 属规范强制产物，存放任务根目录（非 scripts/）|
| **禁止写入源码目录** | 脚本/测试/辅助文件严禁放入项目源码目录 |
| **强制产物首轮完成** | 01/04 在首轮会话结束前必须创建；02/03 按条件触发 |

## 报告路径

```text
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

- 子目录：`analysis/` · `audit/` · `bugs/` · `requirements/` · `optimizations/`
- `NN`：当日序号，从 `01` 起递增
- `--`：双横杠分隔序号与简述

## 记忆路径

```text
.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md
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

## Git Tag 发布规范

> 🔴 每次 release commit 后必须立即打 tag，禁止无 tag 的版本发布。

| 版本类型 | 是否打 Tag | Tag 格式 |
|---------|:--------:|---------|
| MAJOR | 🔴 必须 | `vX.0.0` |
| MINOR | 🔴 必须 | `vX.Y.0` |
| PATCH | 🔴 必须 | `vX.Y.Z` |

**发布步骤（每次 release 必须按序执行）**：

```bash
# 1. 更新 package.json / plugin.json 版本号
# 2. 更新 CHANGELOG.md 和 changelogs/vX.Y.Z.md
# 3. 提交变更
git commit -m "release: vX.Y.Z — <一句话摘要>"
# 4. 打 Tag（与版本号完全一致）
git tag vX.Y.Z
# 5. 推送（commit + tag 同步推送）
git push && git push origin vX.Y.Z
```

**版本号递增规则（Semver）**：
- `MAJOR`（x.0.0）— 工作流或架构破坏性变更（Breaking Change）
- `MINOR`（1.x.0）— 新增工作流、新增 Skill、新增 Instructions
- `PATCH`（1.0.x）— Bug 修复、文字修正、规范小幅改进
