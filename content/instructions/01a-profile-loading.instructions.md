---
applyTo: "**"
description: 意图驱动的 Profile 加载、active-root 路径、目标项目识别与项目现实扩展规范
priority: P5
version: 1.15.5
---
# Profile 加载与项目现实扩展

> 本文件是 `01-common` 的分拆视图，承载 Profile / active-root / 项目识别 / 项目现实扩展细节。

## 适用范围

- 适用于所有工作流（含 analyze / audit / chat），但不等于每轮读取全部 Profile 文件。
- 收到消息后先形成 `IntentSeedV1` 并确定唯一目标项目；随后完成有界计划、定向加载和必要来源回执，才进入项目现实扩展。
- Profile 缺失时 ENV_MODE 默认为 `prod`（保守降级）。
- chat 不豁免 `ContextAcquisitionGate` 和入口检查；低风险 chat 可仅消费 baseline，不应读取无关 Profile 正文。
- 跨会话恢复必须重新验证 context epoch、目标、计划和必要来源新鲜度；摘要 ≠ Profile 证据，恢复也 ≠ 默认全量重读。

## `.devcodex` 读取与写入模型

> `layout.json` 是集中存储开关：当 `<工作区根>/.devcodex/layout.json` 存在且声明 `workspace-namespace` 模式时，进入工作区集中存储模型；不存在时，保持旧的 `<项目根>/.devcodex/` 兼容路径。

### Profile / config 读取

- `config.json` 采用 `workspace base + project overlay`；Auto 精确别名全局默认 `@rocky`，可用 `extensions.devcodex.autoAliases` 替换全局默认别名（省略表示沿用默认，空数组表示关闭默认别名），也可在 `extensions.devcodex.concurrency` 配置 `ConcurrencyPolicy`
- `extensions.devcodex.executionOptimization.mode` 只允许 `safe-auto | full-only`，缺省 `safe-auto`；`full-only` 关闭选择性复用但不关闭正确的完整执行路径
- `extensions.devcodex.concurrency` 缺省为 `mode=auto`：只读准备与隔离验证可按通道上限并行；`mode=serial` 表示全串行；项目只能追加 `locks.additionalSingleWriterScopes`，不得删除核心单写者域或开启并行 mutation
- `config.local.json` 与 `config.json` 同路径模型，可作为用户 / 项目指定的本地 overlay（长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>`），不得覆盖 `mode` / `agent` / `pluginVersion`
- 连接配置来源遵循 S02：默认可直写或沿用项目既有模式；只有用户或项目明确指定 `config.local.json` 时，脚本、测试、数据库 / SSH / MongoDB / 数据操作才从当前 Profile 路径模型下的 `config.local.json` 读取，缺失文件或字段时提醒补齐
- `config.local.json` 可保存 host、port、database、schema、username、内部 URL、连接别名、password、token、apiKey、privateKey、clientSecret、signingKey、connectionPassword、connectionString 等本地字段；`*Env` / `secretRef` 只有在用户指定、项目既有配置或用户指定的发布流程明确要求时才使用
- `README.md`、`01-项目信息.md`、`02-架构约束.md`、`03-代码风格.md` 采用 `project file first + workspace fallback`
- Profile 缺失时仍按 `prod` 保守降级；若用户要求补建 Profile、恢复 dev 模式、初始化 `.devcodex/profile/` 或修复 Profile 缺失，应读取 `profile-bootstrap` 并优先建议/执行 `devcodex profile init`，不得用 AI 推测内容静默替代 Profile 文件真相源。

### ProfileReadChainGate / ServiceNormCoverageGate

<!-- devcodex:include shared/profile/profile-read-chain.md -->

- 先调用 `profile_context_plan`，以 canonical intent、changeTypes、risk、confidence 与明确 selector 形成 `ContextReadPlanV2`（保留 `ContextReadPlanV1` 读取兼容）；计划必须列出 selected / excluded / unclassified、base/project fallback、实际 active-root 与必要理由。
- 计划必须从 baseline 已含的 effective config 形成 `ExecutionOptimizationPlanBindingV1`，并把绑定传给后续 `profile_load` / `profile_skill_plan`；消费者不得为了读取优化开关额外读取 `config.json`。绑定缺失、损坏或未知时 fail-closed 到 `full-only`，转为完整 Profile 文件 / 完整 Skill 读取。
- 绑定只证明 config mode；Context/Profile/Skill 消费者仍须读取同一 active-root 的只读 `ExecutionOptimizationStateV2`，形成 `ExecutionOptimizationFeatureDecisionV1`。feature 为 `off / shadow / rolled-back / sunset`，或状态损坏、超预算、未知 schema、identity/target 无效时，必须分别 bypass computation cache、回退整文件或 `full-skill-read`，禁止只在诊断面显示回滚。
- baseline 可返回 README/index 内容、effective non-local config 和顶层 metadata inventory。`ProfilePlanNoHiddenFullReadProbe` 必须证明规划阶段没有读取 `01~09-*`、`config.local.json` 或其他 selected Profile 正文；存在文件不等于读取文件。
- 计划选中的正文通过 `profile_load({ project, files })` 定向加载。只有与 contextEpoch / invocation `planId` / `planContentId` / activeRoot / sourceId 精确相关且由 `PostToolUse` 观察成功的 `ContextReadReceiptV2`（兼容 `ContextReadReceiptV1`）才能证明 loaded；PreToolUse 只记 attempted。
- `planContentId` 只证明等价计划内容，可跨进程复用解析/索引等 computation metadata；它不能证明正文已交付。正文 delivery reuse 仅限同一 host session、同一 contextEpoch、相同 source identity 且当前模型已有成功 body observation；新会话、压缩/恢复新 epoch、不可观察 session 或任一失效因子变化都必须重新交付所需正文。
- 全量升级仅允许 `explicit-user/project-policy/audit/migration/low-confidence/required-source-missing` 等可审计原因，并写 `fullReadReason`；`config.local.json` 必须另有用户 / 项目明确要求，不能因文件存在自动入选。
- 覆盖 `.devcodex/<project>/profile` 读取链、`.devcodex/workspace/profile` 回退链和 sticky activeProject 生效边界；目标变化、scope/action/risk 漂移、Profile digest 变化或 compact/resume 才触发重新规划，不得每个工具动作都重复加载。
- 复审服务 / 框架规范时列出全部服务集合、docs 自维护链、导航、版本、构建、报告和记忆消费者。
- 从单服务抽公共规范时同步执行 `StrongestProfileSourceGate` / `ServiceSpecificResidueSweep`，以最强 Profile 为基线并清扫服务化残留。

### ProfileGenerationContractGate

- Profile 生成、加载、状态和校验统一使用 `profile-lite` / `profile-standard` / `profile-closed-loop` 契约；首次创建默认 lite，但先由 `devcodex profile plan` 展示推荐档位、目标根和逐文件动作。
- `profile plan` / `--dry-run` 必须零写入；已有 Profile 默认继承档位。升级仅补缺失文件并保留正文，降档必须显式 `--allow-downgrade` 且保留高档文件，执行 `ProfileTierMigrationSafetyGate`。
- `FeatureInventorySchemaGate`：standard/closed-loop 的功能清单来源必须是可定位 Markdown 文件；新生成及当前维护的 closed-loop `06-功能清单.md` 使用 `FeatureInventorySchemaV2` 十四字段表，将发布状态与生命周期状态、证据状态、证据日期、证据引用分离。validator 兼容读取 V1，但不得用 V1 文档存在推断 runtime/released。`01-项目信息.md` 仅保留摘要和链接，不复制规范表。

### 运行态目录写入

- 单项目任务：写入 `<工作区根>/.devcodex/<project>/...`
- 全工作区任务：写入 `<工作区根>/.devcodex/workspace/...`
- 记忆与报告中的 `<agent>` 目录按当前实际宿主确定；`profile/config.json` 的 `agent` 仅作为无法识别宿主时的兜底提示，不能覆盖当前会话事实
- 未启用 `layout.json` 时，继续使用 `<项目根>/.devcodex/...`
- 同一轮执行只能存在一个活动写入域；不得同时向项目旧路径与工作区新命名空间双写
- 涉及 `.devcodex` 读取或写入时，必须能明确说明当前使用的是 `workspace` 还是 `<project>` 命名空间

## 确定目标项目

| 优先级 | 条件 | 结果 |
|:------:|------|------|
| 1 | 用户明确指定项目名称 | 直接使用 |
| 2 | 消息涉及工作区目录 | 映射到项目名 |
| 3 | 🔴 无法确定 | 必须先询问用户；在用户明确回复前，禁止发起任何超出当前文件范围的工作区扫描 |

### 多项目工作区扫描禁令

- 当 cwd 是 monorepo 根目录（包含 ≥ 2 个含 `package.json` 或 `.devcodex/profile/` 的子项目）且未明确 `<project>` 时，AI 必须先询问用户。
- 豁免词：用户消息含 `workspace` / `monorepo` / `全工作区` / `all projects` / `所有项目` 则允许全工作区扫描。
- `lifecycle.cjs` 默认 `safety-only` 下只输出提醒并放行工具，`strict` 模式下才执行 runtime 硬拦截；本条仍是 AI 侧必须遵守的流程约束。
- 当启用 `workspace-namespace` 且缺少 workspace profile 时，运行时提示必须指向真实路径 `.devcodex/workspace/profile/`。
- 若同一宿主会话已识别唯一目标项目，后续“继续 / 确认”等消息可在短 TTL 内沿用 sticky `activeProject` 与项目 `mode`；新会话、TTL 过期、命中多个项目或用户显式选择 workspace 时必须重新判断。
- 完整 `继续<任务名>任务` / `继续 <任务名>` 应先用 `TaskResolutionV1` 的 bounded exact resolver 定位项目，再形成该 active namespace 的 ContextReadPlan；该定位阶段不得预读 Profile 正文，且歧义/完成/stale/scale-blocked 不得错误绑定项目。

## 项目现实扩展（Project Reality Expansion）

执行顺序必须为：

```text
用户消息语义初判（IntentSeedV1）→ 目标项目识别 → profile_context_plan → 定向 Profile 读取 + ContextReadReceiptV2（V1 兼容）→ 项目现实扩展 → 最终意图与工作流路由
```

- 项目现实扩展只能使用已确定项目的 Profile、明确提及文件、当前需求产物和必要只读元信息；不得绕过“项目未识别先询问”的扫描禁令。
- 扩展内容必须至少判断：真实项目范围、可能受影响文件族、适用工作流/子类型是否需要修正、产物落点、验证方式、是否存在多项目/跨服务边界。
- 若扩展后发现初判意图不准确，应在 PC1 中表达为“语义初判 → 项目现实修正后的最终路由”，再进入对应工作流。
- 若扩展不足以稳定判断，不得猜测；应在入口检查处提出最小澄清问题。

## Profile 标准文件

下表定义文件存在性与生命周期要求，不是每轮默认读取集合；实际正文范围以 `ContextReadPlanV2`（V1 兼容）为准。

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库地址 | 是 |
| `02-架构约束.md` | 目录结构/模块边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `04-测试规范.md` | 测试框架/覆盖率 | `profile-standard` 起必需 |
| `05-交付发布规范.md` / `05-发布规范.md` | 版本号/发布流程 | `profile-standard` 起必需 |
| `06-功能清单.md` | `FeatureInventorySchemaV2` 规范功能清单（兼容读取 V1） | standard 默认生成；closed-loop 必需 |
| `07-用户文档与契约规范.md` | 用户文档与公开契约维护规则 | `profile-closed-loop` 必需 |
| `config.json` | 运行模式配置（ENV_MODE）+ agent 兜底标识；Auto 别名全局默认 `@rocky`，可配置 `extensions.devcodex.autoAliases` 替换默认别名；也可配置 `extensions.devcodex.concurrency` 并发策略及可选 `extensions.devcodex.executionOptimization.mode`（缺省 `safe-auto`） | 按需 |
| `config.local.json` | 用户 / 项目指定时使用的本地 overlay：长期连接、本地明文连接信息、env / secretRef 引用、`extensions.<namespace>` 扩展位 | 可选 |

## ENV_MODE 注入

| 情况 | ENV_MODE |
|------|---------|
| `config.json` 存在且 `mode: "dev"` | `dev` |
| `config.json` 不存在 / mode 缺失 | `prod`（保守默认）|
