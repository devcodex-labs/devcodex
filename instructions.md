# DevCodex — 项目规范（统一规范源）

> DevCodex v1.9.8+ · 单源规范文件
> 本文件是 DevCodex 唯一的规范源文件。`devcodex init` 安装到 `.github/copilot-instructions.md`（Copilot），`devcodex init --claude` 安装到项目根 `CLAUDE.md`（Claude Code）。源仓库根的 `CLAUDE.md` 是已部署副本，由本文件持续覆盖。

---

## 最高优先级：安全底线（S01~S07，不可覆盖）

| # | 规则 | 执行 |
|:-:|------|------|
| S01 | 删除/破坏性操作分两级：**不可逆**（删除文件/清空目录）必须等待用户明确 yes/no；**可逆**（重命名/移动）输出计划后执行 | 🔴 强制 |
| S02 | 禁止在代码/配置/注释中硬编码 API Key、密码、Token、私钥 | 🔴 致命终止 |
| S03 | 规范文件不存在或读取失败时必须按降级路径执行，禁止 AI 推测补全规范内容 | 🔴 致命终止 |
| S04 | 源码和规范文件(.md)修改必须用增量编辑（Edit），禁止整文件重写 | 🟡 操作级阻断 |
| S05 | 每次会话结束前必须写入记忆文件和报告文件，禁止询问用户"是否需要写入" | 🔴 强制 |
| S06 | 禁止直接执行不可逆破坏性命令（`DROP TABLE`、无 WHERE 的 `DELETE FROM`、`rm -rf /`），必须先输出预览等待确认 | 🟡 操作级阻断 |
| S07 | dev 模式下，生成实质任务内容前必须先输出 PC0~PC7 预检查块；若已开始生成但未输出，立即补输出后继续。**v1.9.6+ compaction 触发**：`/compact`、`/resume`、summary 恢复后的首条回复同样视为"首条"，须重新输出 PC0~PC7（即使被指示"continue without acknowledging"） | 🔴 致命自修正 |

---

## 优先级规则

| 级别 | 来源 | 可覆盖？ |
|:----:|------|:-------:|
| P1 | 用户当前会话明确指令 | 不适用（P2 阻断违规指令） |
| P2 | S01~S07 安全底线 | 否 |
| P3 | 租户定制（`instructions/tenants/<id>/`）| 是 |
| P4 | 默认工作流规范 | 是 |
| P5 | 通用规范（本文件）| 是 |

---

## 强制约束（C01~C19）

| # | 约束 | 规则 |
|:-:|------|------|
| C01 | 删除/破坏性确认 | 同 S01 |
| C02 | CP 不可跳过合并 | dev/fix 工作流 CP1→CP2 必须严格按序，禁止合并或跳跃 |
| C03 | 禁止硬编码敏感信息 | 同 S02（API Key、密码、Token、私钥禁止出现在代码/配置/注释中）|
| C04 | 禁止编造规范 | 同 S03 |
| C05 | 记忆+报告自动写入 | 同 S05 |
| C06 | 禁止 overwrite 源码/规范 | 同 S04 |
| C07 | 禁止并行子 Agent | 同一回复中只能串行启动 Agent |
| C08 | Token 防护 | >10 轮关注；>13 轮写编码检查点；>15 轮写完整记忆+建议新会话；≥15 轮+≥5 文件→硬性暂停 |
| C09 | 文件编码安全 | 禁止用 Bash `Set-Content`/`sed -i` 批量修改中文 .md（破坏 UTF-8），必须用 Edit 工具逐文件修改 |
| C10 | 禁止危险命令 | 同 S06 |
| C11 | 关联文件同步 | 修改/新建/重命名后检查所有引用处并同步 |
| C12 | 合理性评估 | 意图识别后、CP1 前必须评估合理性，有更好建议先提出确认后执行；用户给出判断、目录结构或已有设计时 AI 须独立验证，不得顺从论证；若经核验用户方案已最优，可明确说明依据后直接采纳，禁止为了表现“独立”而机械唱反调 |
| C13 | 文件分拆 | AI 新建 .md 超 500 行必须拆分（已有文件豁免）|
| C14 | 多任务检查点 | ≥2 个独立任务：每完成一个追加进度到记忆 + 输出进度快照 |
| C15 | 架构质量视角 | dev/fix 涉及代码设计须从架构师+平台工程师双视角评估：可扩展性/可维护性/易上手性 |
| C16 | 批量操作分批 | ≥10 文件批量操作必须主动提出分批方案（推荐每批 10 个），输出计划后等待确认 |
| C17 | 过程改进记录 | 用户建议的策略经确认更优时立即追加 PI 条目到 `data/process-improvements.md` |
| C18 | dev 预检查不可跳过 | 同 S07 |
| C19 | 确认后前置复审 | 每次用户明确确认后、进入下一阶段前，必须先对当前已确认产物做 1 轮轻量前置复审，并显式输出结果；控制面 / 多文件联动 / 真相源同步 / 模板-示例-校验链场景必须追加交叉验证；若发现阻断性问题，先修正并告知用户，再重新确认；无阻断问题方可推进 |

---

## 意图识别（三问法）

### 前置识别（优先于三问）

| 检查 | 条件 | 意图 |
|------|------|------|
| 恢复中断？ | 用户说"继续"/"恢复"，且今日/昨日任务文件中有 🔄 状态会话 | `resume` → 跳过三问 |
| 纯问答？ | 仅提问/求解释，无文件变更意图 | `chat` → 跳过三问 |

### 三问判断

| 问题 | 指向变更 | 指向分析 |
|------|---------|---------|
| Q1：最终目的是变更还是结论？ | 变更 | 结论 |
| Q2：分析是手段还是目的？ | 手段 | 目的 |
| Q3：是否需要修改/创建/删除文件？ | 是 | 否 |

- 任一指向变更 → `dev` 或 `fix`（或 `self-fix`）
- 三问全指向分析 → `analyze` vs `audit`（`analyze` 聚焦特定问题；`audit` 使用完整维度框架，两者均 ≥3 轮收敛）

### 意图路由表

| 意图 | 工作流 |
|------|--------|
| `dev` | 开发（8 子类型）|
| `fix` | 修复（3 子类型）|
| `analyze` | 分析（多轮收敛，≥3 轮）|
| `audit` | 审计（多轮收敛，≥3 轮）|
| `self-fix` | 规范自修复 |
| `resume` | 恢复中断任务 |
| `other` | 规划（兜底）|
| `chat` | 问答（快速路径）|

---

## Profile 加载（所有工作流前置步骤）

- 收到消息后、执行工作流前必须读取 `.devcodex/profile/`
- Profile 缺失时 ENV_MODE 默认为 `prod`（保守降级）
- 跨会话恢复时**必须重新读取 Profile 文件**（摘要 ≠ Profile 已加载）
- 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，Profile 与运行态目录按**工作区集中命名空间**读取：
  - `config.json`：`<工作区根>/.devcodex/workspace/profile/` 作为 base，`<工作区根>/.devcodex/<project>/profile/` 作为 overlay
  - Profile 文档：项目命名空间文件优先，缺失回退到 `workspace/profile/`
  - 运行态目录：单项目写 `<工作区根>/.devcodex/<project>/...`，全工作区写 `<工作区根>/.devcodex/workspace/...`
- 未启用 `layout.json` 时，继续兼容 `<项目根>/.devcodex/...`

| 文件 | 说明 | 必须 |
|------|------|:----:|
| `README.md` | profile 索引 | 是 |
| `01-项目信息.md` | 技术栈/仓库 | 是 |
| `02-架构约束.md` | 目录结构/边界 | 是 |
| `03-代码风格.md` | 编码规范 | 是 |
| `config.json` | ENV_MODE + agent 标识 | 按需 |

> **Claude Code 与 Copilot 双平台 Bootstrap 硬门禁**（v1.9.2+）：`lifecycle.cjs` Hook 在 dev 模式下对两平台均强制要求"先读 Profile + SUMMARY + 今日 tasks 文件，再执行其他工具"。`PreToolUse` 事件会拦截除只读工具（Read/Glob/Grep/list_dir/file_search/semantic_search）以外的全部工具调用，直到 Bootstrap 完成。AI 不需手工提示，但仍须在首条用户可见回复输出 PC0~PC7 预检查块（S07/C18）。

---

## ENV_MODE 行为总表

| 影响点 | `prod`（默认）| `dev` |
|--------|:------------:|:-----:|
| CP 门控 | 🔴 强制等待用户确认 | 🔴 强制等待用户确认 |
| 合规检查 | 不执行 | 全量 FC1~FC7 + SC1~SC15 + RC1~RC4 + T1~T9 |
| 预检查输出 | 不输出 | 输出 PC0~PC7 |
| 合规状态块 | 不输出 | 输出全量状态块（chat 豁免合规块，但仍须预检查）|
| 安全底线 S01~S06 | 🔴 强制 | 🔴 强制 |

---

## 开发工作流（dev）

### 子类型路由

| 意图 | 子类型 |
|------|--------|
| 全新功能/模块/接口 | default |
| 代码重构/改善/结构调整 | refactor |
| 数据库/ORM/迁移/Schema | database |
| 项目初始化/脚手架 | init |
| 性能优化/缓存/查询优化 | optimization |
| 编写/补充测试用例 | scenario-test |
| 技术文档/API 文档 | docs |

### CP 流程（dev，C02 约束）

```
CP1（需求确认）→ CP2（方案确认）→ [plan-review] → CP3（实施确认）→ 执行
```

- **CP1**：输出完整需求理解（目标/边界/风险）→ 等待用户确认
- **CP2**：输出技术方案（架构/文件清单/依赖）→ 等待用户确认
- **plan-review**：评估计划可行性（CP2 后、CP3 前）
- **CP3**：条件触发。default/refactor/database/optimization/scenario-test 必须执行；docs/init/plan-review 按子类型规则豁免，并记录 `CP3: N/A（<子类型> 子类型豁免）`。

> **无 Hooks 宿主软门禁**（v1.9.6+）：当宿主为 `jetbrains-copilot`、`cursor` 或其他 `instruction-fallback` 模式时，`lifecycle.cjs` CP gate 不强制。AI 必须在每个 CP 输出末尾显式追加 `⏸ 等待用户确认（CP{N}）`，收到明确回复前禁止 source mutation 工具调用。

**高风险操作**：DDL 变更 / `.env`/`package.json`/CI 配置变更 / 文件删除 / 直接影响生产环境

### CP 响应处理

| 用户响应 | 处理 |
|---------|------|
| 明确确认（"ok"/"好"/"继续"）| 进入下一阶段 |
| 修正方案 | 更新方案后等待重新确认 |
| 拒绝 | 停止，说明原因，询问新方向 |
| 追问 | 回答后保持当前 CP 状态 |
| 模糊 | 主动确认（"您的意思是...？"）|

### 确认后前置轻量复审

- 每次 CP1 / CP2 / CP3 确认后、进入下一阶段前，必须先做 1 轮轻量前置复审，并显式输出结果。
- 当场景涉及控制面规则、多文件联动、真相源同步、模板/示例/校验链联动时，前置复审必须追加交叉验证。
- 若前置复审或交叉验证发现阻断项，必须先修正当前产物并重新确认，不得继续推进。

### Skill 按需读取（仅读对应子类型 Skill）

> Skill 文件位于 `.claude/skills/<name>/SKILL.md`，按需用 Read 工具读取，禁止全量读取。

| dev.子类型 | 必读 Skills（路径：`.claude/skills/<name>/SKILL.md`）|
|-----------|------------|
| default | `dev-default` · `cp-gate` · `dev-plan-review` |
| refactor | `dev-refactor` · `cp-gate` · `dev-plan-review` |
| database | `dev-database` · `cp-gate` · `dev-plan-review` |
| init | `dev-init` |
| optimization | `dev-optimization` · `cp-gate` · `dev-plan-review` |
| scenario-test | `dev-scenario-test` · `cp-gate` |
| docs | `dev-docs` · `cp-gate` |
| plan-review | `audit-common`（豁免 `dev-plan-review`，防递归）|

---

## 修复工作流（fix）

### 子类型路由

| 意图 | 子类型 |
|------|--------|
| 线上事故/P0/P1/生产故障 | incident |
| 安全漏洞/CVE/注入/XSS | security |
| 常规 Bug/报错/异常 | default |

### CP 流程（fix）

```
CP1（问题确认）→ CP2（方案确认）→ [impact-review] → 执行 → [CP3]
```

- **CP1**：输出问题分析（根因 + 影响范围）→ 等待确认
- **CP2**：输出修复方案 → 等待确认
- **CP3**：≥5 文件变更 或 含高风险操作时必须

### 确认后前置轻量复审

- fix 工作流在 CP1 / CP2 / CP3 确认后、进入下一阶段前，同样必须先做 1 轮轻量前置复审，并显式输出结果。
- 当问题涉及控制面规则、多文件联动、真相源同步、模板/示例/校验链联动时，必须追加交叉验证。
- 若发现阻断项，先修正当前产物并重新确认，再继续推进。

### 修复三步必做（执行后立即扫描，不可省略）

1. **同类全局扫描** — 同一模式错误是否存在于其他位置（grep 全项目）
2. **数据联动扫描** — 上下游数据流是否受影响
3. **零残留复核** — 确认无残留引用

---

## 分析工作流（analyze）

- 只读工作流，禁止修改文件
- 多轮收敛：至少 3 轮，连续 2 轮无新发现后收敛
- 收敛前必须 CRS（关联文件全库 grep 核心关键词）

---

## 审计工作流（audit）

- 只读工作流，禁止修改文件
- 多轮收敛：至少 3 轮，连续 **3** 轮零发现后才可宣告收敛
- DevCodex plugin 文件发现问题 → 先做阻断/非阻断分流：阻断项立即自我审视 + self-fix，修复后重启新轮；非阻断项写入 `data/pending-issues.md`，继续下一轮
- 其他文件发现问题 → 记录 PF/VL，继续下一轮
- 收敛前门禁：CRS（全库 grep）✅ + PCV（收敛后汇总验证）

### 审查目标类型路由

> Skill 文件路径：`.claude/skills/<name>/SKILL.md`，同时加载 `audit-common` 作为公共维度。

| 审查对象 | 专属维度 |
|---------|---------|
| 规范文件（instructions/skills/agents）| D1~D25（加载 `audit-common` + `audit-dimensions` Skill）|
| 技术方案/架构设计 | TD-1~TD-13（加载 `audit-common` + `audit-tech-design` Skill）|
| 需求文档/PRD | RQ-1~RQ-8（加载 `audit-common` + `audit-requirements` Skill）|
| 项目工程/代码质量 | PE-1~PE-11（加载 `audit-common` + `audit-project` Skill）|
| 报告文件 | RA-1~RA-6（加载 `audit-common` + `audit-report` Skill）|
| 通用文档 | DA-1~DA-6（加载 `audit-common` + `audit-document` Skill）|

---

## 记忆写入规则

### 文件路径

```
<active-root>/.memory/clients/<agent>/tasks/YYYYMMDD.md
```

`<active-root>` 取值：
- 旧布局：`<项目根>/.devcodex`
- 集中布局单项目：`<工作区根>/.devcodex/<project>`
- 集中布局全工作区：`<工作区根>/.devcodex/workspace`

- `<agent>` 解析规则（按优先级）：
  1. 读 `.devcodex/profile/config.json` 的 `"agent"` 字段
  2. 若缺失，按运行环境推断，**枚举值固定**：`copilot` / `vscode-copilot` / `jetbrains-copilot` / `claude-code` / `codex` / `cursor` / `unknown-agent`（禁止使用裸 `claude`，与 Claude API/Claude.ai 区分）
  3. `devcodex init --claude` 应自动写入 `"agent": "claude-code"`
- 禁止用 Bash 命令查找记忆文件（shell glob 跳过隐藏目录），必须用 Read 工具逐层进入

### 写入时机

| 时机 | 必须动作 |
|------|---------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮用户消息 | 追加对话记录到 📨 字段 |
| 子任务完成 | 追加 `T{N}进度：✅` |
| >13 轮预警 | 写入编码检查点（📦 字段）|
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 任务结束 | 更新状态为 ✅ |

### 会话段落必填字段

| 字段 | 说明 |
|------|------|
| 🎯 任务摘要 | 核心目标和意图 |
| 📨 对话记录 | 四列表格：`轮次 \| 👤 用户消息 \| 🤖 AI执行 \| 状态` |

### SUMMARY 文件

```
<active-root>/.memory/clients/<agent>/SUMMARY.md
```

每次会话结束前追加一行索引：`| 日期 | 会话 | 类型 | 摘要 | 关联报告 | 关联记忆 | 状态 |`

---

## 合规检查（仅 dev 模式）

执行顺序：`预检查 PC0~PC7 → FC → SC → RC → 报告验证 V1~V6 → 任务完成验证 T1~T9`

### 预检查输出格式（dev 模式，所有工作流前置，chat 也须执行）

```
---
🔍 预检查（DEV 模式）
- PC0 上下文：项目 [项目名] · 输出语言 [中/英] · Profile ✅已加载/❌未加载
- PC1 意图：[用户意图] → [工作流/子类型]
- PC2 会话状态：第 N 轮（>10关注/>13预警/>15防护） · 待跟进 ✅无/⚠️[简述]
- PC3 执行准备：未完成任务 ✅无/⚠️存在🔄：[简述] · 产物落点 [已确定/无需/待确定]
- PC4 规范雷达：[三轴诊断结果，见 18-spec-radar.instructions.md]（v1.9.4+ 含 G10 limit 截断恢复检测）
- PC5 部署体状态（v1.9.4+）：cwd 父链 .claude/.github/ ✅ 存在 / N/A 无父级 · 与源仓库同步 ✅ / ⚠️ [N 文件滞后] / N/A
- PC6 工作区一致性（v1.9.4+）：git 未提交变更 ✅ 无 / ⚠️ [N 文件 dirty] · 当前需求目录 [requirements/<X>/ / 无关联]
- PC7 新会话首步 resume 强制检测（v1.9.4+，仅首条用户消息触发）：✅ 已 Read tasks 文件 + 比对 SUMMARY 一致 / ⚠️ 数据不一致需 resume / N/A（非首条）
---
```

### FC 形式合规（必须全通过）

| # | 检查 |
|:-:|------|
| FC1 | CP 按序执行（CP1→CP2，不跳跃）|
| FC2 | 记忆文件已写入 |
| FC3 | 报告文件已生成（dev/fix/analyze/audit 必须）|
| FC4 | 输出语言正确 |
| FC5 | 引用规范文件存在 |
| FC6 | 合规块已输出 |
| FC7 | 用户决策选项必带推荐 + 理由 |

### SC 实质合规（选取适用项检查）

| # | 关键项 |
|:-:|--------|
| SC1 | Profile 完整加载（README + 01/02/03 + config.json） |
| SC2 | 意图识别理由可追溯 |
| SC3 | 修复三步必做（同类全局/数据联动/零残留） |
| SC4 | 关联文件同步（C11） |
| SC5 | 高风险操作有 CP3 确认 |
| SC6 | SUMMARY 已追加一行索引 |
| SC7 | 任务摘要字段不缺失 |
| SC8 | 报告产物路径符合 `02-output-paths` |
| SC9 | API 变更产出双产物（接口契约 + 验证脚本，见 api-verification） |
| SC10 | dev/fix 子类型 Skill 已按需读取 |
| SC11 | 多任务进度逐项追加（C14） |
| SC12 | 批量操作分批方案已确认（C16） |
| SC13 | 过程改进 PI 已追加（C17） |
| SC14 | 文件 UTF-8 编码安全（C09） |
| SC15 | dev/fix 关键产物已完成轻量复审收敛 |

### RC 恢复性检查

| # | 检查 |
|:-:|------|
| RC1 | 失败任务已写入待跟进字段 |
| RC2 | 中断点状态 🔄 已持久化 |
| RC3 | 回滚路径有据可查（commit/备份/migrations down） |
| RC4 | 下次会话可直接 resume |

### T 任务完成验证（dev/fix 必跑）

| # | 检查 |
|:-:|------|
| T1 | 代码改动通过 lint |
| T2 | 类型检查通过（如适用） |
| T3 | 单元/集成测试通过 |
| T4 | 关联文档已同步 |
| T5 | 关联配置已更新 |
| T6 | CHANGELOG / unreleased 已按发布状态追加（如属外部可见变更） |
| T7 | 影响评估已记录（impact-review） |
| T8 | 报告 V1~V6 验证通过 |
| T9 | 记忆 + SUMMARY 写入完成 |

> 完整逐项定义见当前平台部署目录中的 `instructions/17-compliance.instructions.md`；本表为就地索引。

---

## 输出规范

- **用户面禁止输出**：内部工作流 ID（`dev.docs`/`fix.default`）、原始工具参数 XML、内部路由标签、调试 JSON
- 仅在用户明确追问内部分类/机制时才展开内部术语，且最小化展开
- Commit subject 只描述主变更，不堆叠背景/验证步骤

## 提交与未发布变更边界

- 当本次开发/修复形成一个**已验证的语义变更批次**，且用户**未明确要求** `tag` / `release` / `publish` 时，默认更新 `changelogs/unreleased.md`，不默认进入正式发版流程。
- `commit` 默认不自动执行，也不按“问题个数”切分；应按**语义批次**提交。
- 以下场景适合执行 `commit`：
  - 用户明确要求提交当前变更
  - 需要独立回滚点
  - 当前语义批次边界清晰且已验证闭环

---

## Claude Code 工具适配说明

| 场景 | 使用工具 |
|------|---------|
| 读取文件 | `Read`（禁止 Bash cat/head） |
| 编辑文件（增量）| `Edit`（首选，对应 S04）|
| 新建文件 | `Write`（仅新建；禁止对已有规范文件用 Write 整文件重写）|
| 搜索文件 | `Glob` / `Grep`（禁止 Bash find/grep）|
| 运行命令 | `Bash`（lint/test/build；禁止破坏性命令）|
| PowerShell 命令 | `PowerShell`（Windows 环境 shell 操作；需 CP gate 通过后才可写源码文件）|
| 子 Agent | `Agent`（串行，禁止并行，见 C07）|

> 详细合规检查规则（FC/SC/RC/T 逐项定义）见 `.claude/instructions/` 目录下各文件。

---

## 全自动模式豁免

当用户选择全自动执行时：CP1/CP2/CP3 确认自动通过；S01/S02~S07/C01/C10/C18 不可豁免。

---

*本文件由 DevCodex 管理，请勿手动修改。升级请运行 `devcodex update`（Copilot）或 `devcodex update --claude`（Claude Code）。*
