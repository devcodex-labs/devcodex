---
applyTo: "**"
description: 产物输出路径与命名规范，定义 active-root 下的 requirements、bugs、reports 与记忆落点
priority: P5
version: 1.19.0
---
# 产物输出路径规范

> 🔴 所有路径以当前 **`<active-root>`** 为根，与源码目录天然隔离。
> 🔴 `<active-root>` 取值：
> - 旧布局：`<项目根>/.devcodex/`
> - 集中布局单项目：`<工作区根>/.devcodex/<project>/`
> - 集中布局全工作区：`<工作区根>/.devcodex/workspace/`
> 🔴 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，进入集中布局；不存在时保持旧布局兼容。
> 🔴 禁止在当前 active namespace 根下创建规范路径之外的一级目录。
> 🔴 临时产物不属于任务正式产物树：所有布局的唯一写根为 `<工作区根>/.tmp/devcodex/`；无集中布局时项目根即工作区根。旧 `.devcodex/workspace/.tmp/` 与 `<项目根>/.devcodex/.tmp/` 仅作只读迁移输入。
> ⚠️ `init` 命令自动将运行记忆与 canonical `.tmp/` 加入 `.gitignore`；`requirements/`、`bugs/`、`reports/` 等正式产物目录按需提交。

## 语言规则

> 人类可读正文和标题跟随当前 `LanguageContextV1` 决策；默认 canonical 目录名、文件名、编号槽位和稳定 ID 使用 English（例如 `requirements/add-login-feature/01-requirements.md`）。历史中文路径继续可读。只有用户明确要求本地化磁盘文件名时，才可创建受控 alias；语言优先级见 [`00-safety.instructions.md`](./00-safety.instructions.md) §输出语言规则。

## 路径映射说明（v4 ↔ v1）

| 项目 | v4（历史 `ai-dev-guidelines/version/v4/specs/output-paths.md` 规范）| v1（本文件）|
|------|------------|---------|
| 产物根 | `projects/<project>/` | `<active-root>/` |
| 记忆根 | `projects/<project>/.ai-memory/` | `<active-root>/.memory/` |
| 需求级记忆 | `<需求>/.ai-memory/sessions.md` | `<需求>/.memory/sessions.md` |
| Agent SUMMARY | `.ai-memory/clients/<agent>/SUMMARY.md` | `.memory/clients/<agent>/SUMMARY.md` |

> 两者**内部结构完全一致**（`clients/<agent>/tasks/YYYYMMDD.md`），差别仅在根路径。v1 采用 `.devcodex/` 统一伞下路径，v4 使用独立 `.ai-memory/` 根。

## 目录结构

```text
<active-root>/
├── requirements/<中文描述>/          # 需求产物（dev 默认）
│   ├── 00-需求概况.md               # 🔴 条件强制（纯新需求来自用户/运营/老板/客户/内部使用方时；SimpleTaskFastPath 可 N/A）
│   ├── 00-需求变更概况.md           # 🔴 条件强制（调整/修改/补充已确认需求时；纯新需求可 N/A）
│   ├── 01-需求确认.md               # 🔴 条件强制（纯新需求产品事实源；历史兼容别名：01-需求概述.md；SimpleTaskFastPath 可 N/A）
│   ├── 01-产品需求.md               # 🔴 条件强制（有产品角色直接提供完整需求时；产品模板正文只给产品填写完整 PRD，AI / 研发缺口检查另记）
│   ├── 01-需求变更确认.md           # 🔴 条件强制（需求变更确认稿，并回写目标需求真相源）
│   ├── 02-技术方案.md               # ⚠️ 条件（有架构/接口/设计决策时）
│   ├── 实施方案/                    # ⚠️ 条件（多子模块/多阶段实施时，CP2 确认后创建）
│   │   └── *.md                     #   各子模块/阶段实施细节，不含时间线
│   ├── services/                    # ⚠️ 条件（跨服务需求，涉及 ≥2 个服务时，CP2 后创建）
│   │   ├── <入口服务>/              #   入口服务自身的实施细节
│   │   │   └── 实施方案.md          #   📎 头部须含反向引用：> 上级需求: [需求名](../../01-需求确认.md)
│   │   └── <关联服务>/             #   每个关联服务独立子目录
│   │       └── 实施方案.md
│   ├── 04-实施计划.md               # 🔴 强制（SimpleTaskFastPath 命中时可 N/A）
│   ├── 05-实施进度.md               # ⚠️ 条件/强触发（跨轮次、多批次、≥10 文件、阻塞、用户要求跟踪时）
│   ├── 06-关键决策.md               # ⚠️ 条件（多轮确认/范围变更/方案取舍/用户决策/约束传递时）
│   ├── scripts/                     # ⚠️ 条件（有辅助脚本时，可提交）
│   │   └── <用途>.js / <用途>.sh    #   数据迁移/数据填充等共享辅助脚本；默认禁止放业务逻辑或网络请求
│   ├── *-接口验证.http              # 🔴 强制（有接口变更时）
│   ├── *-接口验证.cjs               # 🔴 强制（有接口变更时）
│   ├── .memory/sessions.md       # 🔴 强制（需求级记忆）
│   └── reports/<agent>/YYYYMMDD/    # 🔴 强制（需求级报告）
├── bugs/<中文描述>/                  # Bug 修复产物（fix）
│   ├── 00-问题概况.md               # 🔴 条件强制（Bug 报告方原始输入；SimpleTaskFastPath 可 N/A）
│   ├── 01-问题确认.md               # 🔴 条件强制（fix CP1 问题确认；可由 01--问题确认与CP1.md 报告等价承载）
│   ├── 02-修复方案.md               # ⚠️ 条件（fix CP2；可由 02--技术方案与CP2.md 报告等价承载）
│   ├── 04-实施计划.md               # ⚠️ 条件（fix CP3 触发时）
│   ├── 05-实施进度.md               # ⚠️ 条件/强触发（跨轮次、多批次、≥10 文件、阻塞、控制面联动）
│   ├── 06-关键决策.md               # ⚠️ 条件（范围变更/用户决策/约束传递）
│   ├── .memory/sessions.md          # 🔴 强制（bug 级记忆）
│   └── reports/<agent>/YYYYMMDD/    # 🔴 强制（bug 级报告）
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
| **禁止非规范路径** | 当前 active namespace 根下只允许上述目录树中的一级目录 |
| **scripts/ 触发条件** | 任务目录（requirements/<任务>/ 或 bugs/<任务>/）下有共享辅助脚本（数据迁移/数据填充/自动化验证等）时创建对应 `scripts/` 子目录；默认禁止放入业务逻辑或网络请求。`*-接口验证.cjs` 属规范强制产物，存放任务根目录（非 scripts/）。除用户明确要求写入业务仓库/规范仓库外，需求辅助脚本默认归档到对应任务目录 `scripts/`，并在报告说明用途与执行边界；新增脚本前执行 `OneOffRequirementScriptPlacementGate`，一次性需求脚本、入库脚本、迁移辅助或验证脚本优先放入对应任务目录，只有长期复用、发布、维护或运维入口才进入项目通用 `scripts/` |
| **本地临时脚本豁免** | 仅本地执行、不会提交发布链路的临时脚本/配置必须通过 lifecycle constructor 先分配 `WorkspaceTempManifestV2`，再写入 canonical temp 的 `runs/<project>/<producer>/<run-id>/local-scripts/`；禁止在 requirements、bugs、源码或 active-root 下另建 `.tmp/tmp/temp`。允许直接使用局部常量、敏感信息和网络请求，但不得伪装成共享正式产物；V1 manifest 仅作历史只读输入 |
| **入口类型分类** | CP1 / 问题确认前必须先区分纯新需求、需求变更和 Bug 问题：纯新需求落 `requirements/<需求>/00-需求概况.md`；需求变更落 `requirements/<需求>/00-需求变更概况.md` 并回写目标需求真相源；Bug 落 `bugs/<问题>/00-问题概况.md`。不得把 Bug 或需求变更塞入纯新需求概况 |
| **00-需求概况 触发条件** | 仅当纯新需求来自用户、运营、老板、客户、内部使用方、PRD/Word、原型、截图、会议纪要、聊天记录或后续补充消息时创建/更新；它是需求方原始输入模板，只记录新增能力、背景、痛点、期望结果、样例、附件和不确定点，不写验收、测试、数据库字段或接口 Schema |
| **00-需求变更概况 触发条件** | 当用户调整/修改/补充已确认需求、规则、流程、页面、字段口径、优先级或范围时创建/更新；必须锚定原需求基线、变更前后差异、影响范围、明确不变内容、兼容/迁移/回滚/告知和目标真相源 |
| **00-问题概况 触发条件** | 当用户报告 Bug、异常、报错、线上现象、测试失败或已承诺行为与实际不一致时，在 `bugs/<问题>/` 下创建/更新；报告方只写问题现象、重现步骤、期望/实际、环境版本、账号/数据条件、频率、影响范围和证据，不写根因、修复方案或测试用例 |
| **01-需求确认 触发条件** | dev CP1 的纯新需求产品事实源；无产品角色或研发兼产品时，由 AI 根据 `00-需求概况.md` 或等价原始附件生成草稿，产品补充归一化后由需求方 + 产品双方确认。历史目录中的 `01-需求概述.md` 视为兼容别名；新建目录优先使用 `01-需求确认.md` |
| **01-产品需求 触发条件** | 有产品角色或正式产品团队直接提供完整需求时创建/更新；产品按 `product-requirement.prompt.md` 写完整业务事实源，产品模板正文只给产品填写完整 PRD，AI / 研发缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不生成或重写产品需求；确认后可直接进入 `02-技术方案.md` |
| **01-需求变更确认 触发条件** | 需求变更 CP1 的产品事实源；由 AI / 产品根据 `00-需求变更概况.md` 生成，确认原需求基线、增量差异、不变内容、影响范围和回写目标。确认后必须更新目标 `01-需求确认.md` / 正式需求文件 / website requirement 的变更记录 |
| **01-问题确认 触发条件** | fix CP1 的问题事实源；由 AI / 研发根据 `00-问题概况.md`、日志、复现和代码排查生成，可由 `01-问题确认.md` 或 `reports/<agent>/YYYYMMDD/01--问题确认与CP1.md` 等价承载 |
| **services/ 触发条件（跨服务）** | 需求涉及 ≥2 个服务时在 CP2 后创建；每个 `实施方案.md` 头部**必须**包含反向引用 `> 📎 上级需求：[需求名](../../01-需求确认.md)（入口服务：<服务名>）` 或产品直接提供需求时引用 `../../01-产品需求.md`；历史目录可继续引用 `01-需求概述.md`；**禁止**各服务各自单独建 `requirements/<需求名>/` 目录（碎片化） |
| **04-实施计划 计划层级** | 默认在 CP3 触发时创建 `04-实施计划.md`；小到中型任务可使用“轻计划摘要”，高风险 / 多模块 / 接口或 Schema 变更 / 跨轮次任务使用“完整实施计划”；SimpleTaskFastPath 或 docs/init/plan-review 子类型豁免时可记 `N/A + skipReason` |
| **05-实施进度 触发条件** | 小任务不默认创建；当任务跨 2 轮以上会话、存在明确阻塞、用户要求持续跟踪、CP3 计划拆成多批次、预计修改 ≥10 文件，或命中控制面/模板/validate/部署副本联动时必须创建并持续更新；前提是已存在 `04-实施计划.md`，或 docs/init 等 CP3 豁免场景已有等价任务切片 / ContextHandoffCard |
| **SimpleTaskFastPath** | 目标明确、预计 ≤2 个源码/文档文件、无公共 API/Schema/依赖/配置/发布/控制面/台账来源/高风险操作、无需多轮跟踪时，可不创建需求/bug 目录与 `00-需求概况.md` / `00-需求变更概况.md` / `00-问题概况.md` / `01-需求确认.md` / `01-产品需求.md` / `01-需求变更确认.md` / `01-问题确认.md` / `04-实施计划.md`，改用回复内联 CP 摘要 + 报告/记忆记录 `N/A + skipReason`；执行中任一条件失效必须升级回完整产物链 |
| **ExistingRequirementArtifactOverride** | 用户调整/修改/补充既有需求或问题，且已有 `00-需求概况.md`、`00-需求变更概况.md`、`01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、历史 `01-需求概述.md`、`00-问题概况.md`、`01-问题确认.md`、bug CP 产物、Profile 声明的正式需求文件或 website requirement 时，必须更新已有真相源；SimpleTaskFastPath 只豁免新建完整产物，不能把回复内联摘要当成文件回写 |
| **ArtifactDecisionMatrix** | CP1/CP2/CP3/ECR 需要按任务规模列出关键产物的 `create` / `update` / `skip` / `N/A` 状态、原因、触发条件和升级回退；判定优先级为“已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免”，覆盖入口分类、00/01（含 `01-需求确认.md`、`01-产品需求.md`、`01-需求变更确认.md`、`01-问题确认.md`）/02/04/05/06、目标文档、报告和记忆 |
| **禁止写入源码目录** | 脚本/测试/辅助文件严禁放入项目源码目录 |
| **ArtifactPathGate（槽位语义）** | `requirements/<任务>/02-*` **仅**技术方案语义（如 `02-技术方案.md`）；`04-*` **仅**实施计划语义。功能清单/盘点/遗漏扫/inventory 等分析报告**禁止**占用 02/04 槽位，须写入 `reports/analysis|audit|…/<agent>/YYYYMMDD/`。Hook 对非法槽位 hard deny（错误码 `ARTIFACT_PATH_INVALID`）；见 `scripts/lib/process-enforcement.js` |
| **强制产物首轮完成** | 默认 00/01/04 在首轮会话结束前按 ArtifactDecisionMatrix 处理：需要则创建/更新，命中 SimpleTaskFastPath 或子类型豁免则记录 `N/A + skipReason`；PC0~PC7、Profile、报告、记忆、安全底线和必要验证不可省略；02-技术方案.md、实施方案/ 与 `06-关键决策.md` 按条件触发；services/ 在 CP2 后按需创建；强触发条件命中时 `05-实施进度.md` 必须在执行前初始化 |
| **需求归档（v1.9.3+）** | 已完成且不再活跃的需求目录下创建空文件 `.archived`；CP gate 扫描跳过含此标记的需求，避免历史需求全局阻断 dev 工作流 |

## 临时产物生命周期

```text
<workspace-temp-root>/                 # <workspace>/.tmp/devcodex/
├── runs/<project>/<producer>/<run-id>/
├── cache/<producer>/<cache-key>/
├── backups/<project>/<transaction-id>/
├── leases/<artifact-id>.json
├── quarantine/<timestamp>/
└── manifests/v2/<project-digest>/<partition>/<artifact-id>.json
```

- 新写入必须由 `scripts/lib/workspace-temp-layout.js` 的 resolver 定位，并由 `WorkspaceTempManifestV2` constructor 在 target 前分配 artifactId/owner token/相对 canonical identity；生命周期仅允许 allocated→active→finalized/abandoned。写入前由 lifecycle owner 验证 canonical root/partition 非 reparse；禁止自行拼接 project-local `.tmp`，也不得让该 CLI 路径能力污染 SkillRoute 宿主运行时契约。
- DevCodex 只拥有 `<workspace>/.tmp/devcodex/`；`.tmp` 容器、其他 producer 子目录、工作区根 `tmp/.tmp-*` 与外部传输 spool 不得被本 lifecycle 枚举为 owner、阻断、迁移或删除。
- 可清理对象必须具有有效 `WorkspaceTempManifestV2`、可识别 owner/type/target identity、已到期 TTL、无活动 token-bound lease，且 backup 事务为 `completed`。`WorkspaceTempManifestV1` 仅只读报告，不能登记新对象或自动提升为 V2 authority。
- `devcodex tmp status --json` 零写入盘点；project/partition scope 使用 `WorkspaceTempCursorV1` 分页并分别记录 inventory/orphan completeness。`devcodex tmp maintain` 与兼容的 `tmp prune` 默认 plan-only；scheduler/opportunistic 路径也必须固定 `apply:false`。
- 实际 cleanup 只能由当前调用显式使用 `--apply --project=<id> --partition=<runs|cache|backups|quarantine>`，并且该唯一 scope 没有 cursor、inventory 与 orphan scan 完整；AI 发起仍须先展示 exact targets 并等待 yes/no。apply 必须重新核对 manifest/target/lease CAS；共享或损坏 lease、普通伪造 lock、unknown owner、跨 scope ownership、reparse、路径逃逸、不完整 backup 和 scope 截断一律 fail closed。对象成功删除时只回收其唯一且明确过期的 token-bound lease。
- OS temp 仅限尚无 workspace、全局安装事务或测试隔离；目录必须使用 `devcodex-*` 前缀，并由创建者在 `finally`/收尾阶段清理。

## 报告路径

```text
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

- 子目录：`analysis/` · `audit/` · `self-fix/` · `bugs/` · `requirements/` · `optimizations/` · `scenario-tests/`
- `NN`：当日序号，从 `01` 起递增
- `--`：双横杠分隔序号与简述

> ℹ️ **路径目录 `YYYYMMDD` 保持天级**（避免同天多报告产生过多子目录）；**报告头部"创建日期"使用分钟级 `YYYY-MM-DD HH:MM`**（便于跨会话定位）；`fix.incident` 子类型的报告须含 `事件时间: YYYY-MM-DD HH:MM:SS` 字段（响应时效审计，参见 `prompts/report-fix.prompt.md`）。

## 记忆路径

```text
<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

每天一个文件，文件内以 `## 会话 NN` 分段。

## 产物路径输出格式

用户可见文件交付统一由 `skills/user-visible-output-contract/SKILL.md` 管理。执行链固定为：

`ArtifactDeliveryManifestV1（内部完整）→ UserFacingArtifactSetV1（用户最小必要）→ FinalValidationSummaryV1（dev/fix/self-fix 完成态验证摘要）→ PostCompletionActionSetV1（真实且有授权边界的后续动作）→ DevCodexVisibleEnvelopeV2 → LinkCapabilityDecisionV1 renderer`。V1 仅允许一个兼容窗口的只读解析，新生产者不得写入。

### 内部完整与用户可见分层

- 所有持久化 mutation、恢复证据和审计证据都进入 internal manifest，并满足 planned=observed=internalDelivered；默认隐藏不等于停止写入、验证或参与 ECR。
- 默认用户面只显示待确认文件、实际结果，以及影响结论可信度的 required evidence。
- session、daily、Agent/全局 SUMMARY、task state、checkpoint/runtime state、raw receipt、raw manifest、raw ledger 默认 `internal-only`。
- 用户要求完整交付清单时使用 `all-deliverable`；只有审计、治理调查或用户明确要求内部留痕时使用 `internal-audit`。任何 scope 都必须满足 `listed + remaining = total`。

### 动作标题与语义名称

标题按消息类型只允许：

- `需要你确认的文件`
- `本批交付文件`
- `完成交付文件`
- `阻断证据`

每项必须输出 `displayName + purposeText + userAction`，并满足 **ArtifactPathColumnGate（PF-175）**：每项必须有独立 **路径** 字段/列，默认 workspace-relative portable。路径、文件名、CP 编号、版本或状态不能单独充当名称。当前消费者禁止使用含义不稳定的“主要产物”和“本次会话全部产物”；历史版本文档不回填。

自由文本交付表默认列：

| 语义名称 | 用途 | 路径 | 操作 |
|----------|------|------|------|

### LinkCapabilityDecision 客户端兼容矩阵

能力必须按当前 surface 的可验证证据选择，禁止只按宿主名称硬编码：

| capability mode | 主表示 | 路径列（强制） | 绝对路径 fallback | 证据边界 |
|---|---|---|---|---|
| `clickable` | 单个语义 Markdown 链接（href 可为绝对以便打开） | portable 相对路径 | 默认不进路径列 | Rich 不得在路径列外再写 `绝对路径：` 行 |
| `portable` | 工作区相对 Markdown 链接 | portable | 默认不进路径列 | Markdown 可用但点击能力未知 |
| `plain` | 语义名称 + 路径列 | portable 或短路径 | 默认不 | 终端/日志纯文本 |
| `failed` | 语义名称 + 绝对定位 | 绝对路径 + reason | 显示 | 链接失败或无法定位 |

只有以下情况允许路径列使用绝对路径（或额外 `绝对路径：...`）：用户明确要求、链接实际失败、目标位于工作区外、路径歧义、宿主无法定位。

`ArtifactLinkSet` 保留为可见集合的兼容投影名，不再是真相源；`ArtifactLinkSetDedupeGate` 执行规范化绝对路径去重，按 canonical path 合并同一物理文件。禁止 `file://`，禁止只输出裸文件名，禁止询问“是否需要打开”。

记忆交付链使用 `ArtifactLinkProjectionSetV1` 作为确定性写入投影：写前 `memory_artifact_link_project(operation: "project")`，写后 `operation: "validate-existing"`；daily、SUMMARY 与 CP writer 的结构化 artifact 字段必须返回同口径 readback。document/target 都以 active-root-relative 输入，href 以 document 目录为基准；历史链接未经单独确认只预览、不批量改写。

推荐 Rich 示例（语义链接 + portable 路径列）：

```markdown
#### 完成交付文件
- [最终执行与验证报告](E:/Worker/.devcodex/devcodex/reports/.../12--最终执行报告.md) — 汇总完成范围、验证结果和残余风险；路径：`.devcodex/devcodex/reports/.../12--最终执行报告.md`；操作：查看结论
```

自由文本表示例：

```markdown
#### 完成交付文件

| 语义名称 | 用途 | 路径 | 操作 |
|----------|------|------|------|
| 最终执行与验证报告 | 汇总完成范围与残余风险 | `.devcodex/devcodex/reports/.../12--最终执行报告.md` | 查看结论 |
```

Portable 示例保持同一语义项，链接 target 与路径列均为工作区相对路径：

```markdown
- [最终执行与验证报告](.devcodex/devcodex/reports/requirements/codex/20260719/12--最终执行报告.md) — 汇总完成范围、验证结果和残余风险；路径：`.devcodex/devcodex/reports/requirements/codex/20260719/12--最终执行报告.md`；操作：查看结论
```

Portable/Plain 在同一 semanticDigest 下只改变链接形式，不改变文件集合、顺序、状态、动作或路径列语义。legacy “主要产物 + 绝对路径”文本最多识别为 `unverified-legacy`，不能作为 verified delivery receipt。当且仅当 fallback 激活时，可追加 `绝对路径：E:/...` 并记录 reason。
### MCP profile fallback

若 Copilot / Codex 等非 Claude Code 宿主调用 `profile_load`、`profile_get_mode` 或其他 DevCodex MCP 工具时出现 `TypeError: Cannot read properties of undefined (reading 'invoke')`、工具桥接不可用、MCP server 未连接等错误，视为**宿主 MCP bridge 失败**，不得反复重试同一 MCP 调用。AI 必须立即降级：

1. 优先通过可用文件读取能力读取 `.devcodex/**/profile/`、`SUMMARY.md` 与当日 `tasks/YYYYMMDD.md`；
2. 文件读取也不可用时，说明当前宿主只能 instruction-fallback，并请求用户提供必要上下文或运行 `devcodex doctor`；
3. 在报告或记忆中记录 `mcpFallback=used`、宿主、错误文本与最终恢复路径。

## CHANGELOG / Release 双阶段规范

### 日志分层

| 层级 | 文件 | 用途 | 默认写入时机 |
|------|------|------|-------------|
| 需求轨 | `website/docs/versions/v1/<active-version>/CHANGELOG.md` | 需求/规格变更记录 | 需求定义、需求完成、需求口径变更 |
| 未发布实现轨 | `changelogs/unreleased.md` | 尚未正式发版的实现/修复/规范变更 | 用户未明确要求 `tag` / `release` / `publish` 时 |
| 已发布轨 | 根 `CHANGELOG.md` + `changelogs/releases/vX.Y.Z.md` | 正式已发布版本索引与详细说明 | 用户明确确认 release 后 |

### 默认规则

1. 用户**未明确要求** `tag` / `release` / `publish` 时：
   - 默认只更新 `changelogs/unreleased.md`
   - 不默认 bump `package.json` / `plugin.json`
   - 不默认更新根 `CHANGELOG.md`
   - 不默认打 `git tag`
   - 不默认执行 `publish`
2. 用户**明确确认发版**时，才进入正式 release 流程。
   - 正式 release 前必须执行 `audit-release` RL-1~RL-10 与 `release-verification` R0~R7。
3. 已发布详情统一存放在 `changelogs/releases/`；旧 flat 路径 `changelogs/vX.Y.Z.md` 仅作为历史兼容说明，不再作为当前写入位置。

## Git Tag 发布规范

> 🔴 每次正式 release commit 后必须立即打 tag，禁止无 tag 的版本发布。

| 版本类型 | 是否打 Tag | Tag 格式 |
|---------|:--------:|---------|
| MAJOR | 🔴 必须 | `vX.0.0` |
| MINOR | 🔴 必须 | `vX.Y.0` |
| PATCH | 🔴 必须 | `vX.Y.Z` |

**正式发布步骤（仅在用户明确确认 release 后执行）**：

```bash
# 1. 确认最终版本号（MAJOR / MINOR / PATCH）
# 2. 将 changelogs/unreleased.md 中待发布条目归档到 changelogs/releases/vX.Y.Z.md
# 3. 更新根 CHANGELOG.md（仅正式发布时）
# 4. 更新 package.json / plugin.json 版本号
# 5. 提交变更
git commit -m "release: vX.Y.Z — <一句话摘要>"
# 6. 打 Tag（与版本号完全一致）
git tag vX.Y.Z
# 7. 推送（commit + tag 同步推送）
git push && git push origin vX.Y.Z
```

**版本号递增规则（Semver）**：
- `MAJOR`（x.0.0）— 工作流或架构破坏性变更（Breaking Change）
- `MINOR`（1.x.0）— 新增工作流、新增 Skill、新增 Instructions
- `PATCH`（1.0.x）— Bug 修复、文字修正、规范小幅改进
