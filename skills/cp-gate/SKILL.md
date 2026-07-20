---
name: cp-gate
description: 执行 CP1（需求确认）/ CP2（方案确认）与条件 CP3（实施计划确认）。CP1→CP2 强制按序，CP3 按工作流能力矩阵判定。
---
## 模式判断

CP 门控**不受 ENV_MODE 影响**。dev/prod 均强制保持 CP1→CP2 顺序；CP3 是否 required 由工作流/子类型/风险决定：

| ENV_MODE | CP 行为 |
|----------|--------|
| `prod`（默认）| CP1→CP2 强制按序；命中 CP3 条件时再确认实施计划 |
| `dev` | 同 prod；额外执行完整规范与方案验证，不扩大 CP3 触发面 |

> ⛔ CP 是用户交互机制（确认需求/方案/计划），与规范验证无关。CP1/CP2 必须确认；CP3 未触发时必须记录 `N/A + subtype/risk evidence`，不得伪装成已确认。
> **CP 跳过路径**：显式 `@devcodex-auto`、全局默认 `@rocky`、Profile `config.json` 的 `extensions.devcodex.autoAliases` 替换别名或明确自然语言 auto 授权（如“进入 auto 模式执行”）；这是 Agent 级行为，与 ENV_MODE 无关。

工作流能力的唯一结构化事实源为 `../routing/workflow-capabilities.json`；本文件只拥有确认交互和 CP3 细化条件。

## 全自动模式

> 当用户选择 `@devcodex-auto`、全局默认 `@rocky`、Profile 配置的 auto 替换别名，或在文本宿主中明确自然语言授权 auto（如“进入 auto 模式执行”“全自动继续”“run in auto mode”）时：

- Auto v1.1 正式入口包括显式 `@devcodex-auto`、全局默认 `@rocky`、项目 Profile `extensions.devcodex.autoAliases` 替换别名与明确自然语言 auto 授权；配置了 `autoAliases` 时该列表替换全局默认别名，空数组表示关闭默认别名；模糊提及、询问 auto 规则、普通“继续”或未生效昵称不等价于 auto 授权
- `hook-enforced` 宿主下，CP 自动通过对白名单路径形成无提醒通过；非白名单路径在默认 `safety-only` 下提醒放行，在 `strict` 模式下回确认模式并硬拦截
- `instruction-fallback` 宿主（如 JetBrains / Cursor）只同步 auto 规则说明，不承诺 runtime 级 CP 行为；支持 Hook 的宿主由 `DEVCODEX_HOOK_ENFORCEMENT` 决定提醒或硬拦截
- `auto:` / `/auto` / profile `executionMode` 不属于本轮正式入口
- CP1 / CP2 / CP3 确认**自动通过**（不等待用户确认）
- 以下约束**不可豁免**：[S01](../../instructions/00-safety.instructions.md)（不可逆确认）/ S02 用户 / 项目敏感信息策略 / S03~S07 / [C01](../../instructions/01-common.instructions.md) / [C10](../../instructions/01-common.instructions.md) / [C18](../../instructions/00-safety.instructions.md)。S02 不阻断明文、硬编码或真实秘密写入；它只禁止 AI 未经用户 / 项目要求自行加严、改成 env、`secretRef`、secret manager、`config.local.json` 或占位符。
- 可恢复失败：重试 ≤ 2 次
- 不可恢复失败：切换回确认模式并通知用户 ⚠️

## CP 定义

| CP | 名称 | dev | fix | 目的 |
|:--:|------|:---:|:---:|------|
| CP1 | 需求/问题确认 | 🔴 必须 | 🔴 必须 | 确认 AI 理解与用户一致 |
| CP2 | 方案确认 | 🔴 必须 | 🔴 必须 | 确认技术方案可行后再编码 |
| CP3 | 实施计划确认 | 条件触发 | 条件触发 | 确认任务拆分、顺序、依赖、验证和回滚后开始逐文件执行 |

### CP3 触发条件

| 工作流 | 条件 |
|--------|------|
| dev.default / dev.refactor / dev.database / dev.optimization | 必须 |
| dev.docs | 豁免 CP3；必须在需求级记忆或报告中记录 `CP3: N/A（docs 子类型豁免）` |
| dev.init | 豁免 CP3；必须在需求级记忆或报告中记录 `CP3: N/A（init 子类型豁免）` |
| dev.scenario-test | 必须 |
| dev.plan-review | N/A（自身为方案评审，不递归进入 CP3） |
| fix | ≥5 文件变更 **或** 含高风险操作 |
| fix | 其他场景 → 可选 |
| dev/fix SimpleTaskFastPath | 目标明确、预计 ≤2 文件、无公共 API/Schema/依赖/配置/发布/控制面/台账来源/高风险、无需多轮跟踪时，允许 CP1/CP2 用内联摘要 + 报告/记忆承载，未触发的 `00-需求概况.md` / `00-需求变更概况.md` / `00-问题概况.md` / `01-需求确认.md` / `01-产品需求.md` / `01-需求变更确认.md` / `01-问题确认.md` / `04-实施计划.md` 记为 `N/A + skipReason` |
| ExistingRequirementArtifactOverride | 用户调整/修改/补充既有需求/问题且已有需求或 bug 真相源时，必须先更新已有文件；产品直接提供完整需求时以 `01-产品需求.md` 为 CP1 真相源，产品模板正文只给产品填写完整 PRD，AI / 研发缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中；需求变更优先使用 `00-需求变更概况.md` / `01-需求变更确认.md` 并回写目标需求真相源；SimpleTaskFastPath 只允许不新建完整产物，不能用回复替代文件回写 |
| ArtifactDecisionMatrix | CP1/CP2/CP3/ECR 按任务规模列出关键产物 `create` / `update` / `skip` / `N/A`，判定优先级为已有真相源回写 > 任务触发条件 > SimpleTaskFastPath > 子类型豁免 |

**高风险操作**：DDL 变更 / 共享配置文件、`package.json`、CI 或生产配置变更 / 文件删除 / 直接影响生产环境的修改。env、`secretRef`、secret manager 或 `config.local.json` 仅在用户 / 项目明确指定时作为连接配置入口。

## 执行规则（[C02](../../instructions/01-common.instructions.md) 约束）

1. **严格按序**：CP1 → CP2 → CP3，不得跳过中间步骤
2. **禁止合并**：不得将 CP1+CP2 合并为一次输出
3. **每个 CP 独立确认**：输出后必须等待用户明确响应
4. **用户请求 ≠ CP 确认**：用户说"帮我做X"不等于 CP1 已通过
5. **"继续" ≠ CP3 授权**：任务名续接、stable taskId、Hook/MCP/CLI resolver 命中都只定位任务；必须从 sessions 与绑定 artifact digest 复证 CP。缺失/漂移返回 `stale-confirmation` 并回对应 CP，不能把 `继续<任务名>任务` 当作新确认或自动重开
6. **跨轮次状态保持**：CP 确认状态不因后续轮次消息重置
7. **CP3 内容边界**：CP3 只确认实施计划，不重复技术方案中的架构决策、接口论证和兼容性主说明；必须显式覆盖任务拆分、顺序、依赖、验证方式与回滚策略
8. **产物文件前置创建**：输出 CP 确认请求前，对应产物文件必须已写入磁盘。dev/requirements 必须先判定入口类型：纯新需求且无产品角色 → `00-需求概况.md` + `01-需求确认.md` + `<任务>/.memory/sessions.md`；有产品角色直接提供完整需求 → `01-产品需求.md` + `<任务>/.memory/sessions.md`，产品模板正文只给产品填写完整 PRD，AI / 研发缺口 / 冲突检查记录在 CP1 摘要、`02-技术方案.md` 或报告中，不生成或重写产品需求；需求变更 → `00-需求变更概况.md` + `01-需求变更确认.md` + 回写目标需求真相源；历史目录的 `01-需求概述.md` 仅作兼容。fix/bugs → `00-问题概况.md` + `01-问题确认.md`，也允许使用 `01--问题确认与CP1.md`、`02--技术方案与CP2.md` 这类报告等价承载 CP1/CP2；CP3 → `04-实施计划.md`。命中 `SimpleTaskFastPath` 时，允许不创建需求/bug 目录，用内联 CP 摘要 + 报告/记忆替代，但必须记录 `N/A + skipReason` 和升级回退条件；若命中 ExistingRequirementArtifactOverride，则必须先增量编辑已有真相源，回复内联摘要不得替代文件回写。所有场景必须用 ArtifactDecisionMatrix 说明每个产物是 `create`、`update`、`skip` 还是 `N/A`。
9. **进度文档触发**：`05-实施进度.md` 不是小任务默认必产物；当任务跨 2 轮以上会话、存在明确阻塞、用户要求持续跟踪、CP3 计划拆为多批次、预计修改 ≥10 文件或命中控制面/模板/validate/部署副本联动时，必须在执行前创建并在每批完成后更新。默认前提是已存在 `04-实施计划.md`；docs/init/plan-review 等 CP3 豁免场景可使用已确认文档大纲、任务切片或 ContextHandoffCard 作为等价计划锚点。
10. **CP3 豁免记录**：docs/init/plan-review 等被工作流规则明确豁免 CP3 时，必须写入 `CP3: N/A（<子类型> 子类型豁免）`，让 hook/fallback 能区分“合法豁免”和“遗漏确认”。
11. **确认后前置复审分级**（C19 / `PostConfirmationReviewScopeGate`）：每次用户明确确认后、进入下一阶段前，必须先判定复审强度。低风险单文件、纯文案或 SimpleTaskFastPath 可做轻量复审；命中公共 API/配置、跨模块注册链、运行时安全能力、package/adapter、文档消费者、控制面、多真相源同步、用户要求全面复审或预计多轮收敛时，必须升级为冻结清单驱动的全面复审，复用 `review-checklist` 文件、`dev-plan-review` PR-2~PR-7、ReviewCoverageDelta / ReviewDimensionDeltaGate 和状态新鲜度检查；命中控制面、多文件联动、多真相源同步或模板-示例-校验链时必须追加交叉验证；发现阻断性问题则先修正并回到对应 CP 重新确认，无阻断问题方可推进并显式输出结果。低风险降级必须写 `skipReason`。
12. **审计问题清单转修复的 CP1 映射**：当 fix 源自 audit/analyze 的问题清单时，CP1 必须建立问题 ID 映射，逐项标注 `本轮修复 / 已关闭 / 延后 / 另起任务`，并把验收口径写入 CP1 产物；禁止只列新增问题而漏掉用户已指出或上轮已确认的问题。
13. **执行期 CP3 回退**：若执行过程中实际变更范围触达 CP3 门槛（≥5 文件、高风险、控制面联动），必须暂停执行、补做或重开 CP3，再继续后续修改与验证。
14. **backlog 来源前置真相复核**：当 CP1/问题确认直接来源于 `data/*.md` 的 open/partial 项时，进入正式确认前必须先把候选项分类为 `pure-open` / `residual-tail` / `already-fixed` / `misclassified`；非 `pure-open` 项须先回写状态并修正本轮范围，不得把 stale-open 条目继续按纯 open 统计。
15. **代码事实与唯一推荐**：CP1/CP2/CP3 的重要需求、方案和推荐结论触发 `CodeTruthEvidenceMatrixGate`，至少绑定 repo path、符号/契约、当前行为、反证探针和差距；多方案收敛后触发 `UniqueRecommendationBeforeConfirmGate`，只能保留一个推荐方案或一个明确组合推荐。

## CP 响应处理

| 用户响应 | 处理方式 |
|---------|---------|
| ✅ 确认（"可以"/"没问题"/"确认"） | 进入下一阶段 |
| ✏️ 修正（"X 部分改为 Y"） | 应用修正后重新输出当前 CP，等待再次确认 |
| ❌ 拒绝（"不对"/"重来"） | 回退到当前 CP 重新分析 |
| ？追问 | 回答后重新输出当前 CP，等待确认 |
| 🔀 模糊（含批评/情绪/意图不明）| **不得推进**，必须明确询问再等待显式响应 |

## 确认后前置复审分级

- **适用节点**：每次 CP 确认之后、进入下一阶段之前
- **复审对象**：刚被确认的 CP 产物
- **强度判定**：
  - 轻量复审：低风险单文件、纯文案、无公共契约、无多真相源同步、无发布/控制面/安全能力/文档消费者影响。
  - 全面复审：公共 API/配置、跨模块注册链、运行时安全能力、package/adapter、文档消费者、控制面、多真相源同步、用户要求全面复审、长周期或多轮收敛任务。
- **轻量最小检查**：
  1. 当前产物内部自洽
  2. 与上游已确认内容一致
  3. 不存在会在下一阶段立即触发阻断的缺口
- **全面复审最小检查**：
  1. 创建或复用 `review-checklist` 文件并冻结范围、维度、证据路线和状态字段
  2. 对 CP2 技术方案复用 `dev-plan-review` PR-2~PR-7，不能只写“轻量自洽”
  3. 执行 ReviewCoverageDelta、ReviewDimensionDeltaGate、EvidenceExecutionGate 和 ChecklistStateFreshnessGate
  4. 报告或回复写明触发原因、已跑证据、阻断项和降级项 `skipReason`
- **交叉验证追加条件**：
  - 涉及控制面规则
  - 涉及多文件联动或多真相源同步
  - 涉及模板 / 示例 / 自动校验链联动
- **交叉验证最小覆盖**：
  1. 当前产物
  2. 上游已确认产物
  3. 相关真相源、联动规则或校验探针
- **处理规则**：
  - 无阻断问题：显式输出“前置复审结果：✅ 无阻断，可进入下一阶段”后再推进
  - 发现阻断问题：停止推进，修正当前产物，告知用户，再回到对应 CP 重新确认
  - 连续 2 次仍发现新的阻断问题：提示升级为定向 `audit` 或扩大扫描范围

## ConfirmBindingGate / ClosureEvidenceGate（控制面确认绑定）

> 🔴 **ConfirmBindingGate**：控制面、多文件、Hook/MCP/CLI/分发、或用户要求 digest 绑定时，CP 确认必须绑定 **确认前** 产物全文 `artifactPath + version + artifactSha256`。  
> 🔴 **禁止**确认后仅改产物头部/状态字段再刷新 hash 仍保持同一 ✅（必须标 `stale` 并重确认）。  
> 🔴 **ClosureEvidenceGate**：宣称 closed / 可确认下一 CP / 可实施 时，每条 P0 须双列 `designEvidence` + `runtimeOwners(writer|reader|schema|probe)`；仅有设计段落 → 最高 `partial`，禁止写「可确认 CP3 / 可实施」。  
> 🔴 **ReReviewRuntimeFirstGate**：用户说「已调整 / 再审」时，先绑 hash、先问 runtime 假绿，再做旧 finding 打勾。

控制面推荐写入（digest 扩展表）：

```markdown
### CP 确认记录
| CP | 状态 | artifactPath | version | sha256 | sourceMessage | confirmedAt |
|:--:|:----:|--------------|---------|--------|---------------|-------------|
| CP1 | ✅ | `01-需求确认.md` | v0.4.0 | `ABC…` | 确认 CP1 | 10:30 |
| CP2 | ⏳ | — | — | — | — | — |
| CP3 | ⏹️ | — | — | — | — | — |
```

- MCP：`memory_cp_confirm { requirement, kind, phase, time, artifactPath, artifactVersion, artifactSha256, sourceMessage }`  
  - 传入 path/sha 时服务端会 **对照磁盘重算 hash**，不一致则拒绝写入  
  - 仅 `phase/time` 为 legacy 兼容（非控制面小任务）
- Hook：`readCpConfirmations` 对含 sha 的行执行 `verifyArtifactDigest`；不匹配则视为未确认
- 探针：V100（`validate-closure-evidence-controls`）

## 任务级记忆（sessions.md）CP 确认格式

> 🔴 **hook 读取此格式**：`hooks/_runtime/lifecycle.cjs` 通过读取 `.devcodex/requirements/<任务名>/.memory/sessions.md` 或 `.devcodex/bugs/<任务名>/.memory/sessions.md` 判断 CP 确认状态。legacy 正则为 `| CP[123] | ✅ |`；digest 扩展表在 sha 与磁盘一致时才算 ✅。格式不符或 digest 不匹配则 hook 视为"未确认"；默认 `safety-only` 下输出提醒并放行，`strict` 模式下阻断代码写入工具（Write/Edit/apply_patch）。

每次用户确认 CP 后，立即在对应任务目录的 `.memory/sessions.md` 写入或更新（控制面优先 digest 扩展表；小任务可用 legacy 三列表）：

```markdown
### CP 确认记录
| CP  | 状态 | 时间  |
|:---:|:----:|-------|
| CP1 | ✅   | 10:30 |
| CP2 | ⏳   | —     |
| CP3 | ⏹️   | —     |
```

- `✅` 已确认 · `⏳` 等待确认 · `⏹️` 未开始 · `stale` 正文已变须重确认
- 推荐：使用 MCP 工具 `memory_cp_confirm`（控制面带 digest 字段）
- 无 MCP 时：用 Edit 工具追加/更新此表格
- **禁止**：用 Bash/shell 命令修改此文件（C09：破坏 UTF-8 编码）

## CP 记录格式（报告文件）

报告中「CP 确认记录」表：

```markdown
| CP | 状态 | 用户响应 | 时间 |
|:--:|:----:|---------|------|
| CP1 | ✅ | 确认需求理解正确 | HH:MM |
| CP2 | ✏️→✅ | 修正后确认方案 | HH:MM |
| CP3 | ✅ | 确认实施计划 | HH:MM |
| CP3 | N/A | docs/init/plan-review 子类型豁免 | HH:MM |
```

## CP 通过后变更处理（F-08）

> 详细变更分级规则见 `instructions/10-dev.instructions.md §变更管理`。

| 变更级别 | 判断条件 | 处理方式 |
|:--------:|---------|---------|
| 🟢 微调 | 不影响已确认的接口/行为/范围 | 继续执行，记录偏离原因 |
| 🟡 扩展 | 追加功能点或调整非核心接口 | 回 CP2 补充确认后继续 |
| 🔴 重大 | 影响核心接口/数据模型/范围边界 | 必须回 CP1 重新确认 |

## 模板引用

| 产出物 | 模板 |
|--------|------|
| CP1/CP2/CP3 确认格式 | `prompts/cp-checklist.prompt.md` |

## 用户决策节点（AskUserQuestion / 多选项呈现）

> 🔴 **FC7 强制（v1.9.5+，PI-005 规范化）**：所有用户决策节点必须有且仅有 1 个 🟢 推荐项 + 一句话推荐理由。

适用范围：
- AskUserQuestion 工具调用（多 option）
- CP1 范围选择（如发版 vs 暂停 vs 子集）
- CP2 方案对比（如 A/B/C 实现路径）
- audit/analyze 报告 §决策点（如继续 / 暂停 / 强扫）

### ConfirmationRequest 抽象

用户确认语义必须先表示为宿主无关的 ConfirmationRequest，再由宿主适配层选择按钮、权限提示、Hook 阻断或文本 fallback；这是语义层抽象，不要求 runtime 逐字输出一个同名对象；禁止把按钮 UI 写成全宿主能力。

```text
ConfirmationRequest
- id
- kind: cp_gate | destructive | high_risk | ambiguity | approval
- severity: forbid | require_completion | warn_continue | log_only
- question
- options
- recommendedOption
- evidence
- fallbackText
- auditLogRequired
```

| 能力层级 | 使用场景 | 行为 |
|----------|----------|------|
| `structured_buttons` | Claude Code SDK / VS Code Chat Extension 等明确支持按钮或多选的宿主 | 渲染按钮或结构化多选 |
| `tool_permission_prompt` | Claude SDK / Copilot CLI 等权限审批流 | 暂停等待 allow/deny |
| `hook_block_reason` | Codex/Claude/Copilot hooks strict | 硬拦并输出原因与下一步 |
| `text_confirm` | Cursor/JetBrains/repository instructions fallback | 明确文本等待确认 |
| `audit_only` | 非阻断低风险 | 记录原因后放行 |

### AskUserQuestion 调用模板

```json
{
  "questions": [{
    "question": "选择哪个方案？",
    "header": "方案选择",
    "multiSelect": false,
    "options": [
      {
        "label": "方案 A（推荐）",
        "description": "推荐理由：[实证依据 / 风险权衡 / 性价比 一句话]"
      },
      {
        "label": "方案 B",
        "description": "代价：... 适用场景：..."
      },
      {
        "label": "方案 C",
        "description": "代价：... 适用场景：..."
      }
    ]
  }]
}
```

格式要求：
1. 推荐项必须放**首位**
2. 推荐项标签**必须**含 `(推荐)` 字样
3. 推荐项 description **必须**以"推荐理由："开头
4. 其他选项 description **建议**列出"代价/适用场景"对比信息
5. 不得出现 0 推荐项或 ≥2 推荐项
6. 推荐项可以与用户原始方案相同，但前提是已完成独立比较并能写出“推荐理由：”中的客观依据

### 报告/Markdown 决策点模板

```markdown
**选项**：

| 选项 | 描述 | 推荐 |
|------|------|:---:|
| 🟢 A | 方案 A 描述 / **推荐理由**：... | ⭐ |
| B | 方案 B 描述 / 代价：... | |
| C | 方案 C 描述 / 代价：... | |
```

> 关联：PI-005（维护态记录按 active-root 写入，例如 `.devcodex/<project>/data/process-improvements.md`） · [FC7](../../instructions/17-compliance.instructions.md)

