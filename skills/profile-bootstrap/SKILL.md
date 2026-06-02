---
name: profile-bootstrap
description: Profile 自动生成 — 扫描 package.json / CHANGELOG.md / 顶层目录 / 配置文件，产出 .devcodex/profile/ 三件套初稿，避免 ENV_MODE 静默降级到 prod
---

# Profile Bootstrap Skill

## 适用范围

- 触发：`devcodex profile init` CLI 调用
- 不触发：`devcodex init` / `devcodex init --claude` 完成后仅 **提示** "下一步运行 devcodex profile init"，不自动生成（避免覆盖用户已有 Profile）
- workspace-namespace：当 `<workspace>/.devcodex/layout.json` 启用后，在工作区根执行 `devcodex profile init` 应治理 `.devcodex/workspace/profile/`；在明确项目上下文执行时治理 `.devcodex/<project>/profile/`。运行时多项目 warning 必须提示 `.devcodex/workspace/profile/`，不得继续指向 legacy `.devcodex/profile/`。

## 产出三件套

### `01-项目信息.md`

数据源：

| 来源 | 字段 |
|------|------|
| `package.json` | name / version / description / repository / engines.node |
| `CHANGELOG.md` 首行表格 | 当前版本 / 当前阶段标题 |
| `.git/HEAD` 或 `git symbolic-ref HEAD` | 当前分支 |
| `git config remote.origin.url` | 仓库 URL（兜底） |

写入模板：

```markdown
# 01 — 项目信息

> 由 `devcodex profile init` 于 {YYYY-MM-DD} 自动生成，需人工复核后定稿。

## 基础信息
- 项目名：{name}
- 当前版本：{version}
- 描述：{description}
- Node 版本：{engines.node}
- 仓库：{repository.url}

## 当前阶段
- 主版本分支：{branch}
- 阶段摘要：{CHANGELOG 顶部摘要}
```

### `02-架构约束.md`

数据源：

| 来源 | 字段 |
|------|------|
| 顶层目录扫描（深度 ≤2，跳过 `node_modules`/`.git`/`dist`/`build`） | 目录树 |
| `lerna.json` / `pnpm-workspace.yaml` / `package.json#workspaces` | monorepo 识别 |
| `tsconfig.json` 中的 `references` | 子项目关系 |
| 顶层 `services/` 或 `packages/` 目录存在 | 服务/包结构 |

写入模板：

```markdown
# 02 — 架构约束

> 由 `devcodex profile init` 于 {YYYY-MM-DD} 自动生成，需人工复核后定稿。

## 项目结构（自动扫描）

\`\`\`
{目录树，深度2}
\`\`\`

## 架构特征
- 组织模式：{single | monorepo:lerna | monorepo:pnpm | monorepo:npm}
- 服务拆分：{有 services/N | 无}
```

### `03-代码风格.md`

数据源：

| 来源 | 推断 |
|------|------|
| `.eslintrc*` / `eslint.config.*` | ESLint 启用 + 主要规则集 |
| `.prettierrc*` / `prettier.config.*` | Prettier 启用 + 主要选项 |
| `tsconfig.json` | TypeScript strict / target / module |
| `.editorconfig` | indent / charset |
| `package.json#scripts` | lint / format / test 命令 |

写入模板：

```markdown
# 03 — 代码风格

> 由 `devcodex profile init` 于 {YYYY-MM-DD} 自动生成，需人工复核后定稿。

## 静态检查
- ESLint：{启用 + extends 摘要 | 未启用}
- Prettier：{启用 + 主要选项 | 未启用}
- TypeScript：{strict {bool} / target {ES2022} | 未启用}

## 编辑器
- 缩进：{2/4 space | tab}
- 字符集：{utf-8}

## 工程命令
- lint: `{package.json scripts.lint | 未定义}`
- format: `{package.json scripts.format | 未定义}`
- test: `{package.json scripts.test | 未定义}`
```

### `config.json`

```json
{
  "mode": "dev",
  "agent": "copilot | claude-code"
}
```

- `mode` 默认 `dev`（仅 `devcodex profile init --prod` 时设为 prod）
- `agent` 从调用方上下文推断：`devcodex init --claude` 后续调用 → `claude-code`，否则 `copilot`

## CLI 行为

## Node.js 默认基线

- 生成或复核 Node.js 项目 Profile 时，`engines.node` 缺失或低于 `>=18` 应标注为待人工确认的风险。
- 新项目或新包默认建议 `Node 版本：>=18`；低于 v18 只能作为项目例外，并须在 `01-项目信息.md` 写明业务理由、兼容风险和验证证据。
- CI matrix、README 运行时说明和 Profile 的 Node 基线应保持一致。

### `devcodex profile init`

| 步骤 | 动作 |
|------|------|
| 1 | 检查目标 Profile 根是否存在 → legacy 为 `.devcodex/profile/`，workspace-namespace 工作区根为 `.devcodex/workspace/profile/`，明确项目为 `.devcodex/<project>/profile/`；不存在则创建 |
| 2 | 对四个产出文件逐一检查：已存在 → 跳过并提示 `[skip] 01-项目信息.md (existing)`；不存在 → 生成 |
| 3 | 输出生成清单 + 提示"已生成 N 个 Profile 草稿，请人工复核后定稿" |
| 4 | 退出码 0（即使全部 skip） |

### `devcodex profile init --force`

| 步骤 | 行为差异 |
|------|---------|
| 2 | 已存在文件强制覆盖（先备份为 `<file>.bak.{YYYYMMDD-HHmmss}`）|

### `devcodex status` 扩展

输出新增一行：

```
profile        complete  (4/4 files)
profile        partial   (2/4 files: missing 02, 03)
profile        missing   (0/4 files — run: devcodex profile init)
```

## 与其他规范的对齐

| 关联点 | 说明 |
|--------|------|
| `15-memory.instructions.md` | `agent` 字段必须使用固定枚举 |
| `02-架构约束.md` 项目级文件 | 本 Skill 生成的是 **模板初稿**，定稿规则不变（须人工填入业务约束） |
| Profile 缺失行为 | Profile 缺失时 ENV_MODE 默认 prod；本 Skill 推动用户尽早完成 dev 模式启用 |

## ⛔ 禁止

- ⛔ 已有 Profile 文件存在时禁止默认覆盖（须 `--force` 才覆盖且必须先备份）
- ⛔ 自动扫描不得读取 `.env` / `.env.local` 等密钥文件（避免泄漏到生成文件中）
- ⛔ 生成内容须明确标注"由 `devcodex profile init` 自动生成，需人工复核"
