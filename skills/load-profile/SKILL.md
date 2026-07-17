---
name: load-profile
description: 项目 Profile 加载规范 — 先形成语义意图种子与唯一目标，再按计划加载最小充分配置
---
# Load Profile Skill

## 职责

在 `IntentSeedV1` 形成后，**独立确定目标项目 `<project>`**，再按 `ContextReadPlanV1` 加载最小充分的项目配置（profile）。计划确定后的只读 Profile 与记忆查询可按并发策略执行。

必要来源形成 `ContextReadReceiptV1` 后，必须把 Profile 结果交给“项目现实扩展”步骤，作为最终意图路由、产物落点和验证方式的输入。

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

```text
<项目根>/.devcodex/profile/
```

当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时：

- `config.json`：`<工作区根>/.devcodex/workspace/profile/config.json` 作为 base，`<工作区根>/.devcodex/<project>/profile/config.json` 作为 overlay；Auto 精确别名全局默认 `@rocky`，可用 `extensions.devcodex.autoAliases` 替换全局默认别名（省略表示沿用默认，空数组表示关闭默认别名），也可在 `extensions.devcodex.concurrency` 配置 `ConcurrencyPolicy`
- `extensions.devcodex.concurrency` 缺省为 `mode=auto`：只读准备与隔离验证可按通道上限并行；`mode=serial` 表示全串行；项目只能追加 `locks.additionalSingleWriterScopes`，不得删除核心单写者域或开启并行 mutation
- `config.local.json`：与 `config.json` 使用相同的 `workspace base + project overlay` 路径模型，可作为用户 / 项目指定的本地 overlay（长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>`）；脚本、测试、数据库 / SSH / MongoDB / 数据操作只有在用户或项目明确指定时才以它作为连接配置入口
- `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md`：项目命名空间文件优先，缺失回退到 `workspace/profile/`
- `<project>` 未确定时，禁止猜测项目命名空间

### ProfileReadChainGate / ServiceNormCoverageGate

所有工作流的 Profile 获取都必须执行 `ProfileReadChainGate`；服务 / 框架规范复审、跨服务需求、workspace-namespace 或 Profile 同步任务还必须执行 `ServiceNormCoverageGate`：

- 调用 `profile_context_plan`，以 canonical intent、changeTypes、risk、confidence 和明确 selector 生成 `ContextReadPlanV1`；计划必须列出 baseline / selected / excluded / unclassified、base/project fallback 和实际 active-root。
- `ProfilePlanNoHiddenFullReadProbe` 必须证明计划阶段只返回 README/index、effective non-local config 与顶层 metadata inventory，没有预读 `01~09-*`、`config.local.json` 或其他 selected 正文。
- selected 正文通过 `profile_load({ project, files })` 定向读取；只有 contextEpoch / planId / activeRoot / source 精确关联且 `PostToolUse` 观察成功的 `ContextReadReceiptV1` 才能证明加载完成。
- 全量升级必须记录 `fullReadReason`，仅限用户/项目明确要求、audit/migration、低置信或必要来源缺失；`config.local.json` 还须用户/项目明确指定，不能因文件存在自动读取。
- 覆盖 `.devcodex/<project>/profile` 读取链、`.devcodex/workspace/profile` 回退链和 sticky activeProject 生效边界；实质 identity / scope / action / risk / digest 漂移或 compact/resume 时重新规划。
- 复审服务 / 框架规范时列出全部服务集合、docs 自维护链、导航、版本、构建、报告和记忆消费者。
- 从单服务抽公共规范时同步执行 `StrongestProfileSourceGate` / `ServiceSpecificResidueSweep`，以最强 Profile 为基线并清扫服务化残留。

### ProfileTruthReconciliationGate

Profile 加载只证明“声明已读取”，不能证明声明仍为当前真相。项目级 analyze / audit 在形成结论前必须执行分级真相对账：

| mode | 触发 | 最小范围 |
|------|------|----------|
| `targeted` | 项目级 analyze、根因/合理性/方案分析 | 只核对与当前问题相关的版本、目录、脚本、能力、宿主、测试/发布或配置声明 |
| `full` | 任意 audit | 复用 `audit-common` PFresh-1~PFresh-6，并反查 repo shape 与声明档位、生命周期文件完整性 |
| `N/A` | 低风险、单文件、与项目事实无关的局部分析 | 必须写 `skipReason`；不得用 N/A 规避项目级分析 |

加载后先把 `profileTrustState` 标为 `unreconciled`；对账完成后只能进入 `aligned`、`drift-detected` 或 `partially-unverifiable`。每条相关声明写入 `ProfileTruthMatrix`：

| 字段 | 要求 |
|------|------|
| `profileClaim` | Profile 原声明与来源文件 |
| `actualSources` | 当前代码、配置、package、运行证据、正式需求/发布事实 |
| `status` | `aligned / stale-profile / stale-code-or-doc / intentional-exception / unverifiable` |
| `conclusionAuthority` | 当前结论采用的事实源及理由；当前状态默认以已验证代码/配置/运行证据为准 |
| `correctionRoute` | 当前结论如何矫正、需要哪个 dev/fix/self-fix 更新 Profile、或为何保持例外 |

Profile 可以约束目标态和项目政策，但不得覆盖已验证的当前实现事实。analyze/audit 保持只读：发现漂移时立即矫正本轮结论并记录交接，不得直接修改 Profile 源文件；后续源文件修订必须进入独立 dev/fix/self-fix 与 `ProfileImpactCheck`。

### ProfileReleaseTruthAuthorityMatrixGate

DevCodex 自维护、Profile 生成/复审、workspace base 同步和发布事实变更必须区分发布权威、当前消费者与历史证据：

| 层 | 事实源 / 处理 |
|---|---|
| release authority | `package.json` 与 `plugin.json` 的一致版本；正式发布状态再由 tag、CI、registry 证据补充 |
| current project consumers | project `01` 当前版本/阶段、`05` 当前发布事实、`07` 当前发布基线/版本语义/当前分发 |
| workspace current consumer | 明确标注“DevCodex 工作区规范版本”的 workspace `01` 当前版本/阶段 |
| historical / per-feature | `changelogs/releases/**`、versioned docs、`06` 单能力 releaseState；不得按当前全局版本批量改写 |

加载时把每条明确 current claim 写入 authority matrix；版本不一致时 `profileTrustState=drift-detected`，validator 至少返回 warning/non-zero，不得把“文件存在”视为通过。只读工作流报告漂移并采用 release authority 修正结论；获授权的 dev/fix/self-fix 才同步 Profile。普通项目的自身版本不得错误对比 DevCodex package 版本。

### MemoryCannotSatisfyBootstrapGate

Codex / 宿主内置 Memories、模型长期偏好、上一轮摘要或用户口头记忆只能作为导航提示，不能满足 DevCodex bootstrap、Profile 加载、Context Rehydration、CP 确认、报告结论或验证证据。

- 新线程、resume、summary 恢复、compact 后继续、跨项目切换或用户提到“你应该记得”时，仍必须重新建立当前 active namespace 的计划并取得必要文件真相源回执；使用 bounded Profile plan、memory status/query（有限投影覆盖 Agent SUMMARY / daily tasks）与 handoff 指向的精确 report / review checklist / source，禁止固定全读 Profile、SUMMARY、今日/昨日 tasks。
- 若内置 Memories 与文件真相源冲突，以文件真相源为准；报告或 PC 块说明冲突和采用依据。
- 若无法完成文件真相源读取，只能标记阻塞或降级，不能把 Memories / 模型回忆写成 `verified`、`loaded`、`passed` 或 CP / release 证据。
- 当用户询问是否启用宿主 Memories 时，结论必须同时说明本门禁：开启也不降低文件读取门槛；无法保证该门禁时默认不建议作为正式 DevCodex 运行模式。

### FeatureInventoryProfileGate

公开包、SDK、CLI、多模块仓库、文档站、public API、可配置 runtime 或跨项目规范维护任务需要稳定功能清单时，必须执行 `FeatureInventoryProfileGate`：

- Profile 中应有可追踪 feature inventory 或精确说明其当前 Markdown 来源；关键词命中、临时清单或不存在的路径不能证明来源有效。
- `profile-closed-loop` 使用 `06-功能清单.md` 作为规范真相源；新生成/当前维护内容符合 `FeatureInventorySchemaV2`：V1 十字段基础上增加生命周期状态、证据状态、证据日期和证据引用。validator 兼容读取 V1，但 V1 投影不得宣称已验证或已发布。`01-项目信息.md` 只能保留摘要和链接，不得复制完整规范表。
- feature inventory 不能由复审清单临时拼接；复审清单只记录本轮验证状态，Profile 或正式文档记录稳定能力面。
- 功能增删、默认行为变化、公开 API 或文档站能力变化时，报告需写 `ProfileRuntimeContractSyncGate` 与 `ProfileImpactCheck` 是否同步。

### ProfileGenerationContractGate / ProfileTierMigrationSafetyGate / FeatureInventorySchemaGate

- Profile 生成、加载、状态展示和校验必须消费同一三档契约；不得由 Skill、CLI、Prompt 或 validator 各自维护不一致的文件集合。
- `devcodex profile plan` / `profile init --dry-run` 先显示目标根、现有档位、推荐档位、目标档位和逐文件动作，且必须零写入。
- 未显式指定 `--tier` 时继承现有档位；首次创建默认 lite 并单独给出推荐档位。升级只补缺失文件并保留已有正文；降档必须有 `--allow-downgrade`，且保留高档文件。
- `devcodex status` 分开报告 `files`、`semantic` 与 `config`，避免把 config 的条件状态混入必需文件计数。

## ProfileTierStandardGate / ProfileLifecycleClassificationGate

Profile 标准分三档，`conditional-required` 只表示文件级条件触发，不是项目档位。加载 Profile 时必须先判断档位，再决定缺失项是阻断、警告还是 N/A：

| 档位 | 适用项目 | 必需文件 |
|------|----------|----------|
| `profile-lite` | 小型项目、工具脚本、单一后端服务、早期草稿 | `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md`，`config.json` 按需 |
| `profile-standard` | 有稳定测试/发布要求、多人协作或公开包的项目 | `profile-lite` 全部文件 + `04-测试规范.md` + `05-交付发布规范.md` 或 `05-发布规范.md` + feature inventory 来源说明 |
| `profile-closed-loop` | DevCodex 规范维护、SDK/CLI/文档站/public API、多模块或需要完整开发闭环的项目 | `profile-standard` 全部文件 + `06-功能清单.md` + `07-用户文档与契约规范.md`，必要时按条件补 `08-*` / `09-*` |

文件生命周期必须写清：

| 生命周期 | 含义 | 例子 |
|----------|------|------|
| 稳定基线 | 项目事实变化才更新 | `01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md` |
| 活文档 | 功能、API、CLI、Hook、测试、发布、文档站变化时持续更新 | `04-测试规范.md`、`05-交付发布规范.md`、`06-功能清单.md`、`07-用户文档与契约规范.md` |
| 条件 / 本地文档 | 命中连接、服务、数据、外部系统或本地 overlay 才维护 | `config.local.json`、`08-*`、`09-*` |

`AllDevCodexProfileValidationGate`：当任务涉及 Profile 标准、workspace-namespace、规范维护项目、发布前检查或用户要求“校验 `.devcodex` 所有项目”时，必须执行全项目 Profile 校验，至少覆盖 `.devcodex/workspace/profile` 与 `.devcodex/<project>/profile` 的读取链。推荐命令：

```bash
node scripts/validate-all-profiles.js --workspace <workspace-root>
```

## 标准文件（按需加载）

下表是档位存在性契约，不是每轮默认正文读取集合；具体读取由 `ContextReadPlanV1` 决定。

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引，声明 `profile-lite` / `profile-standard` / `profile-closed-loop` 档位 | 是 |
| `01-项目信息.md` | 技术栈/仓库地址 | 是 |
| `02-架构约束.md` | 目录结构/模块边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `04-测试规范.md` | 测试框架/覆盖率 | `profile-standard` 起必需 |
| `05-交付发布规范.md` / `05-发布规范.md` | 版本号/发布流程 | `profile-standard` 起必需 |
| `06-功能清单.md` | `FeatureInventorySchemaV2` 功能清单规范源（兼容读取 V1）；standard 默认生成，closed-loop 必需 | `profile-standard` 生成；`profile-closed-loop` 必需 |
| `07-用户文档与契约规范.md` | README、站点文档、quick start、API/CLI/Hook/宿主契约维护规则 | `profile-closed-loop` 必需 |
| `config.json` | 运行模式配置（ENV_MODE）+ agent 兜底标识；Auto 别名全局默认 `@rocky`，可配置 `extensions.devcodex.autoAliases` 替换默认别名；也可配置 `extensions.devcodex.concurrency` 并发策略 | 按需 |
| `config.local.json` | 用户 / 项目指定时使用的本地 overlay：长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>` | 条件 / 本地 |

> ⚠️ `config.json.agent` 只用于当前实际宿主无法可靠判断时的 fallback hint。产物路径中的 `<agent>` 必须优先使用当前会话/工具链可验证的实际宿主；profile agent 不得覆盖当前会话事实。
>
> ⚠️ Auto 精确别名全局默认 `@rocky`。`config.json.extensions.devcodex.autoAliases` 只接受精确 `@alias` token，并用于替换全局默认别名：省略表示沿用 `@rocky`，空数组表示关闭默认别名；普通“继续”、模糊提及或询问 auto 规则不算授权。
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
| profile/ 或集中布局命名空间存在 | `profile_context_plan` 返回 README/index、effective non-local config 与 metadata inventory，再按 selected files 定向读取；`config.local.json` 仅在用户 / 项目明确指定时读取 |
| 二者都不存在 | 提示用户是否自动生成（扫描项目源码推断） |
| 部分文件缺失 | 文档文件可按 `workspace fallback` 继续读取；必须文件仍提示用户补充 |

## 项目现实扩展输出

必要 Profile 来源取得 Post 成功回执后，必须形成以下最小结论，供 PC1/PC3 与后续工作流使用：

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
| **入口服务** | 独立 plan：baseline + 当前 action/risk 所需正文 | 主服务也不得无理由固定全读 `01~03-*` |
| **关联服务** | 独立 plan：通常只选择接口契约、项目事实或架构边界中的必要项 | 未选择来源写 excluded reason，不按身份预读整套 |

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
