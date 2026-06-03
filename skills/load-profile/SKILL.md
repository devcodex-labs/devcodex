---
name: load-profile
description: 项目 Profile 加载规范 — 意图识别后独立确定目标项目并加载配置
---
# Load Profile Skill

## 职责

在意图识别完成后，**独立确定目标项目 `<project>`**，并加载对应的项目配置（profile）。可与记忆读取并发执行。

加载完成后必须把 Profile 结果交给“项目现实扩展”步骤，作为最终意图路由、产物落点和验证方式的输入。

## 如何确定 `<project>`

| 优先级 | 条件 | 结果 |
|:------:|------|------|
| 1 | 用户消息明确指定项目名称 | 直接使用 |
| 2 | 消息涉及工作区目录（如 `vext/`、`ai-dev-guidelines/`） | 映射到项目名 |
| 3 | 🔴 无法确定 | **必须先询问用户**："当前请求关联哪个项目？"。在用户明确回复前，**禁止发起任何超出当前文件范围的工作区扫描**（`file_search` / `semantic_search` / `grep_search` / `list_dir` 调用与当前任务无关的、以及项目以外的 `read_file`）。`<project> = null` **不再是合法默认状态** |

> 🔴 **多项目工作区扫描禁令**（v1.9.8+）：当 cwd 是 monorepo 根目录且未明确 `<project>` 时，AI 侧与 Hook 侧同步阐断扫描。豁免词：`workspace` / `monorepo` / `全工作区` / `all projects` / `所有项目`。详见 `lifecycle.cjs` `isMultiProjectWorkspace`。

## 工作区目录映射

| 工作区目录 | `<project>` |
|-----------|------------|
| `ai-dev-guidelines/` | `dev-docs` |
| `devcodex/` | `devcodex` |
| 其他目录 | 目录名（若 profile 存在） |

## Profile 路径约定

默认兼容路径：

```
<项目根>/.devcodex/profile/
```

当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时：

- `config.json`：`<工作区根>/.devcodex/workspace/profile/config.json` 作为 base，`<工作区根>/.devcodex/<project>/profile/config.json` 作为 overlay
- `config.local.json`：与 `config.json` 使用相同的 `workspace base + project overlay` 路径模型，可作为用户 / 项目指定的本地 overlay（长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>`）；脚本、测试、数据库 / SSH / MongoDB / 数据操作只有在用户或项目明确指定时才以它作为连接配置入口
- `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md`：项目命名空间文件优先，缺失回退到 `workspace/profile/`
- `<project>` 未确定时，禁止猜测项目命名空间

## 标准文件（按需加载）

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库地址 | 是 |
| `02-架构约束.md` | 目录结构/模块边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `04-测试规范.md` | 测试框架/覆盖率 | 按需 |
| `05-发布规范.md` | 版本号/发布流程 | 按需 |
| `config.json` | 运行模式配置（ENV_MODE）+ agent 兜底标识 | 按需 |
| `config.local.json` | 用户 / 项目指定时使用的本地 overlay：长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>` | 按需 |

> ⚠️ `config.json.agent` 只用于当前实际宿主无法可靠判断时的 fallback hint。产物路径中的 `<agent>` 必须优先使用当前会话/工具链可验证的实际宿主；profile agent 不得覆盖当前会话事实。
>
> ⚠️ `config.local.json` 不得覆盖 `mode` / `agent` / `pluginVersion`。`ENV_MODE` 仍只由 `config.json` 决定；`config.local.json` 只补充本地私有上下文。
>
> ⚠️ `config.local.json` 若使用项目级扩展，只能放在 `extensions.<namespace>` 下，并且必须在 `01-项目信息.md` 或 Profile README 说明用途、字段语义与使用方式。
>
> ⚠️ `config.local.json` 可保存 host、port、database、schema、username、内部 URL、连接别名、password、token、apiKey、privateKey、clientSecret、signingKey、connectionPassword、connectionString 等本地字段。它不是默认唯一入口；只有用户、项目既有配置或目标平台明确指定时，才读取或新增 `config.local.json`、env、`*Env`、`secretRef` 或 secret manager。
>
> ⚠️ 连接信息默认可直写或沿用项目既有模式；脚本、测试、数据库 / SSH / MongoDB / 数据操作只有在用户或项目明确指定 `config.local.json` 时，才从当前 Profile 路径模型读取，发现文件或字段缺失时提醒用户补齐。

## Profile 缺失处理

| 情况 | 处理 |
|------|------|
| profile/ 或集中布局命名空间存在 | 读取 README.md + 按需读其他文件；存在 `config.local.json` 时一并作为本地 overlay 读取 |
| 二者都不存在 | 提示用户是否自动生成（扫描项目源码推断） |
| 部分文件缺失 | 文档文件可按 `workspace fallback` 继续读取；必须文件仍提示用户补充 |

## 项目现实扩展输出

Profile 读取后，必须形成以下最小结论，供 PC1/PC3 与后续工作流使用：

| 字段 | 说明 |
|------|------|
| 目标项目 | 当前任务绑定的 `<project>` 或 `workspace` |
| 真实范围 | 仅当前项目 / 工作区 / 跨服务 / 文档规范控制面 |
| 意图修正 | 语义初判是否需要修正为其他工作流或子类型 |
| 关联文件族 | 最小相关文件集合或文件族，不得扩大到无界扫描 |
| 产物落点 | requirements / bugs / reports / workspace 命名空间等 |
| 验证方式 | lint / test / typecheck / validate / 文档链接验证 / 发布验证等 |
| `domain` | 受影响模块/领域，如 runtime/hooks/memory/docs/mcp/cli |
| `risk` | destructive/security/high-risk/normal |
| `host-capability` | 涉及 Claude/Codex/Copilot/Cursor/JetBrains 等宿主能力差异时，标注支持与降级边界 |
| `validation-route` | test/lint/typecheck/validate/direct replay/官方文档等验证路线 |
| `confidence` | high/medium/low，并说明不确定来源 |
| `alternatives` | 被排除工作流/子类型及原因 |

若任一字段无法稳定判断，应在入口检查中标注“待澄清”，不得伪造项目事实。

## 跨服务需求 Profile 加载

当读取需求文档时检测到 `影响服务` 字段（跨服务需求），按以下策略加载多个服务的 profile：

| 服务类型 | 加载范围 | 说明 |
|---------|---------|------|
| **入口服务** | 完整加载：`README.md` + `01~03-*.md` + `config.json` | 主执行服务，需完整约束 |
| **关联服务** | 轻量加载：`01-项目信息.md` + `02-架构约束.md` | 仅了解接口契约和架构边界，减少 Token 消耗 |

**优先级**：入口服务 profile > 关联服务 profile > 通用规范（P4）

> ⚠️ 若某关联服务 profile 不存在，记录提示但不阻断；AI 在涉及该服务实施细节时主动提醒用户补充。

## 优先级

项目 profile > 租户规范（P3）> 工作流规范（P4）> 通用规范（P5）

> 🔴 `<project>` 未确定时，任何工作流都必须先询问用户，**禁止猜测、禁止跳过项目询问进入工作流**（与上表优先级 3 一致）。

## ENV_MODE 注入

加载 profile 时，读取 `config.json` 的 `mode` 字段，输出 ENV_MODE 供后续所有 Skill 引用：

| 情况 | ENV_MODE |
|------|---------|
| `config.json` 存在且 `mode: "dev"` | `dev` |
| `config.json` 存在且 `mode: "prod"` | `prod` |
| `config.json` 不存在 | `prod`（保守默认）|
| `mode` 字段缺失或非法值 | `prod`（保守默认）|

加载后在上下文中声明：**`ENV_MODE = dev` 或 `ENV_MODE = prod`**，并在首次回复中标注当前模式。若 profile agent 与当前实际宿主不同，应标注为“profile agent 兜底值与当前宿主不同”，但记忆、报告和产物仍按当前实际宿主落点写入。`config.local.json` 只在用户 / 项目指定时补充本地连接/扩展上下文，不改变这里的 ENV_MODE 结论。
