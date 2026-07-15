---
name: profile-bootstrap
description: Profile 计划与分档生成 — 先预览目标根、推荐档位和文件动作，再按统一契约生成可追踪的 .devcodex/profile/ 草稿
---

# Profile Bootstrap Skill

## 适用范围

- 触发：`devcodex profile plan` / `devcodex profile init` CLI 调用，或用户要求创建、升级、降档、修复 Profile
- 不触发：`devcodex init` / `devcodex init --claude` 完成后仅 **提示** "下一步运行 devcodex profile init"，不自动生成（避免覆盖用户已有 Profile）
- workspace-namespace：当 `<workspace>/.devcodex/layout.json` 启用后，在工作区根执行 `devcodex profile init` 应治理 `.devcodex/workspace/profile/`；在明确项目上下文执行时治理 `.devcodex/<project>/profile/`。运行时多项目 warning 必须提示 `.devcodex/workspace/profile/`，不得继续指向 legacy `.devcodex/profile/`。
- Profile 初稿或复审必须考虑 `ProfileReadChainGate` / `ServiceNormCoverageGate`：记录 workspace base、project overlay、config.local overlay、fallback、全部服务集合、docs 自维护链、导航、版本、构建、报告和记忆消费者；从单服务抽公共 Profile 规则时执行 `StrongestProfileSourceGate` / `ServiceSpecificResidueSweep`。
- 公开包、SDK、CLI、多模块、文档站、public API 或 runtime 配置明显的项目，Profile 初稿/复审必须执行 `FeatureInventoryProfileGate` / `FeatureInventorySchemaGate`：`06-功能清单.md` 是默认唯一规范清单，使用 `FeatureInventorySchemaV1`，覆盖能力 ID、能力组、公开面、配置入口、主要消费者、文档入口、验证路线、事实来源、维护责任和发布状态；扫描不能证明的字段写 `unverified` / 待人工确认，不得编造成已发布事实。
- 执行 `ProfileGenerationContractGate` / `ProfileTierStandardGate` / `ProfileLifecycleClassificationGate`：生成器、CLI、加载器、validator、Prompt 和公开文档必须消费同一档位契约。首次创建默认仍以 `profile-lite` 为目标，但必须展示基于 package/目录/脚本证据的推荐档位；用户通过 `--tier` 明确选择后才升级。
- 执行 `ProfileTierMigrationSafetyGate`：默认继承已检测档位；升级只补缺失文件并保留已有正文；未带 `--allow-downgrade` 时拒绝降档；显式降档只改档位声明并保留高档文件；`--dry-run` / `profile plan` 对目录、文件和备份必须零写入。
- 执行 `AllDevCodexProfileValidationGate`：workspace-namespace、规范维护项目或用户要求全项目校验时，生成/复审后运行 `node scripts/validate-all-profiles.js --workspace <workspace-root>` 或记录不可执行原因。
- 执行 `ProfileReleaseTruthAuthorityMatrixGate`：DevCodex Profile 草稿或同步不得从历史 changelog/versioned docs 推断当前版本；以 package/plugin 为 release authority，对账 project 01/05/07 与标明 DevCodex 规范版本的 workspace 01。发现 current claim 漂移时生成修订动作并让 validator 非零，历史 release 与 `06` 分能力状态保持原语义。

## 三档生成策略

| 档位 | Bootstrap 行为 | 后续补齐 |
|------|----------------|----------|
| `profile-lite` | 默认生成 `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md`、`config.json` | 人工复核后定稿 |
| `profile-standard` | 生成 lite 全部文件 + `04-测试规范.md` + `05-发布规范.md` + `06-功能清单.md`；未验证事实保持显式未确认 | 由真实脚本、CI、发布流程和源码证据复核 `FeatureInventorySchemaV1` |
| `profile-closed-loop` | 生成 standard 全部文件 + `07-用户文档与契约规范.md`；适用于规范维护、SDK/CLI/文档站/public API 等完整闭环项目 | 持续维护活文档，必要时补条件 / 本地文档 |

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
  "agent": "copilot | claude-code | codex"
}
```

- `mode` 默认 `dev`（仅 `devcodex profile init --prod` 时设为 prod）
- `agent` 从当前宿主证据推断；无法识别时才回退为 `copilot`

## CLI 行为

## Node.js 默认基线

- 生成或复核 Node.js 项目 Profile 时，`engines.node` 缺失或低于 `>=18` 应标注为待人工确认的风险。
- 新项目或新包默认建议 `Node 版本：>=18`；低于 v18 只能作为项目例外，并须在 `01-项目信息.md` 写明业务理由、兼容风险和验证证据。
- CI matrix、README 运行时说明和 Profile 的 Node 基线应保持一致。

### `devcodex profile plan` / `devcodex profile init --dry-run`

先输出目标 Profile 根、已检测档位、请求档位、推荐档位、目标档位、mode 和逐文件动作；不得创建目录、写文件或创建备份。推荐路径是先运行 plan，再运行相同参数的 init。

### `devcodex profile init`

| 步骤 | 动作 |
|------|------|
| 1 | 检查目标 Profile 根是否存在 → legacy 为 `.devcodex/profile/`，workspace-namespace 工作区根为 `.devcodex/workspace/profile/`，明确项目为 `.devcodex/<project>/profile/`；不存在则创建 |
| 2 | 检测现有档位；未显式指定 `--tier` 时继承现有档位，首次创建默认 `profile-lite`，同时输出证据驱动的推荐档位 |
| 3 | 按统一生成契约逐文件检查：已存在 → 跳过；缺失 → 生成；升级时只更新 README 档位声明并保留正文 |
| 4 | 输出生成/跳过/档位更新/备份计数，并提示人工复核所有 `unverified` 字段 |
| 5 | 退出码 0（即使全部 skip） |

### `devcodex profile init --force`

| 步骤 | 行为差异 |
|------|---------|
| 2 | 继承当前档位并覆盖该档位的已有文件；每个文件先备份为 `<file>.bak.{timestamp}` |

### 档位迁移

- 升级：`devcodex profile plan --tier profile-standard` 预览，确认后以 `profile init` 执行；只补目标档位缺失文件，README 仅更新档位声明。
- 降档：必须显式同时传 `--tier <lower-tier> --allow-downgrade`；高档文件保留，避免不可逆信息损失。
- 未知参数、缺少 `--tier` 值或非法档位必须友好失败，退出码为 1，不输出内部堆栈。

### `devcodex status` 扩展

输出新增一行：

```text
profile        complete  (profile-standard; files 6/6; semantic 2/2; config present)
profile        partial   (profile-standard; files 5/6; semantic 1/2; config missing)
profile        missing   (files 0/4; semantic 0/1; config missing — run: devcodex profile plan)
```

## 与其他规范的对齐

| 关联点 | 说明 |
|--------|------|
| `15-memory.instructions.md` | `agent` 字段必须使用固定枚举 |
| `02-架构约束.md` 项目级文件 | 本 Skill 生成的是 **模板初稿**，定稿规则不变（须人工填入业务约束） |
| Profile 缺失行为 | Profile 缺失时 ENV_MODE 默认 prod；本 Skill 推动用户尽早完成 dev 模式启用 |

## ⛔ 禁止

- ⛔ 已有 Profile 文件存在时禁止默认覆盖（须 `--force` 才覆盖且必须先备份）
- ⛔ `profile plan` / `--dry-run` 禁止写目录、文件或备份；未显式授权禁止降档
- ⛔ 功能清单禁止用关键词命中或无事实来源的占位行冒充完成；`01-项目信息.md` 不得复制 `06-功能清单.md` 的完整规范表
- ⛔ 自动扫描默认不主动读取 `.env` / `.env.local` 等文件；用户或项目明确要求读取时可按指定范围读取并写入 Profile 说明
- ⛔ 生成内容须明确标注"由 `devcodex profile init` 自动生成，需人工复核"
