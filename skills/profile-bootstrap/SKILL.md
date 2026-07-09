---
name: profile-bootstrap
description: Profile 自动生成 — 扫描 package.json / CHANGELOG.md / 顶层目录 / 配置文件，产出 .devcodex/profile/ 三件套初稿，避免 ENV_MODE 静默降级到 prod
---

# Profile Bootstrap Skill

## 适用范围

- 触发：`devcodex profile init` CLI 调用
- 不触发：`devcodex init` / `devcodex init --claude` 完成后仅 **提示** "下一步运行 devcodex profile init"，不自动生成（避免覆盖用户已有 Profile）
- workspace-namespace：当 `<workspace>/.devcodex/layout.json` 启用后，在工作区根执行 `devcodex profile init` 应治理 `.devcodex/workspace/profile/`；在明确项目上下文执行时治理 `.devcodex/<project>/profile/`。运行时多项目 warning 必须提示 `.devcodex/workspace/profile/`，不得继续指向 legacy `.devcodex/profile/`。
- Profile 初稿或复审必须考虑 `ProfileReadChainGate` / `ServiceNormCoverageGate`：记录 workspace base、project overlay、config.local overlay、fallback、全部服务集合、docs 自维护链、导航、版本、构建、报告和记忆消费者；从单服务抽公共 Profile 规则时执行 `StrongestProfileSourceGate` / `ServiceSpecificResidueSweep`。
- 公开包、SDK、CLI、多模块、文档站、public API 或 runtime 配置明显的项目，Profile 初稿/复审必须考虑 `FeatureInventoryProfileGate`：生成或标注 feature inventory 的来源、能力组、公开面、配置入口、文档入口、验证路线和维护责任；缺少时写待人工确认，而不是把临时复审清单当稳定 Profile。
- 执行 `ProfileTierStandardGate` / `ProfileLifecycleClassificationGate`：`devcodex profile init` 默认只生成 `profile-lite` 的最小稳定基线；当项目存在稳定测试/发布要求、公开包、SDK、CLI、文档站、public API、多模块或规范维护职责时，提示升级为 `profile-standard` 或 `profile-closed-loop`，并列出缺失文件。
- 执行 `AllDevCodexProfileValidationGate`：workspace-namespace、规范维护项目或用户要求全项目校验时，生成/复审后运行 `node scripts/validate-all-profiles.js --workspace <workspace-root>` 或记录不可执行原因。

## 三档生成策略

| 档位 | Bootstrap 行为 | 后续补齐 |
|------|----------------|----------|
| `profile-lite` | 默认生成 `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md`、`config.json` | 人工复核后定稿 |
| `profile-standard` | 不自动臆造测试/发布事实；提示补 `04-测试规范.md` 与 `05-交付发布规范.md` / `05-发布规范.md` | 由项目真实脚本、CI、发布流程和 FeatureInventoryProfileGate 来源补齐 |
| `profile-closed-loop` | 不自动生成完整闭环正文；仅在规范维护、SDK/CLI/文档站/public API 等项目中建议升级 | 补 `06-功能清单.md`、`07-用户文档与契约规范.md`，必要时补条件 / 本地文档 |

生命周期分类：

- 稳定基线：项目事实变化才更新。
- 活文档：功能、API/CLI/Hook、测试、发布、文档站、配置或用户文档变化时同步更新。
- 条件 / 本地文档：命中本地连接、数据、服务、外部系统或 overlay 时维护；`conditional-required` 不作为项目档位。

## 产出 profile-lite 初稿

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
- ⛔ 自动扫描默认不主动读取 `.env` / `.env.local` 等文件；用户或项目明确要求读取时可按指定范围读取并写入 Profile 说明
- ⛔ 生成内容须明确标注"由 `devcodex profile init` 自动生成，需人工复核"
