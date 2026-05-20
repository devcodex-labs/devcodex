---
name: audit-dimensions
description: D1~D25 规范文件审查维度总览 — 规范库/specs 文件专属审查层
---
# Audit Dimensions Skill

## 适用范围

审查目标为**规范文件**（instructions/*.md、skills/**/SKILL.md、agents/*.agent.md、RULES.md 等 AI 指导文档）时加载本 Skill。

## 维度总览（D1~D25）

| 分组 | 维度 | 优先级 |
|------|------|:------:|
| A — 结构规范 | D1 文件结构 · D2 NODE_META/frontmatter 规范 · D3 路由语法正确性 | 🔴 |
| B — 内容质量 | D4 内容完整性 · D5 跨文件一致性 · D6 示例可执行性 | 🔴/🟡 |
| C — 可维护性 | D7 职责边界 · D8 版本标注 · D9 引用准确性 | 🔴/🟡 |
| D — AI 执行性 | D10 指令明确性 · D11 冲突检测 · D12 路由正确性 | 🔴 |
| E — 可扩展性 | D13 扩展点标注 · D14 租户覆盖支持 · D15 向后兼容 | 💡 |
| F — 维度体系 | D16 维度编号唯一 · D17 优先级标注 · D18 AI-first 设计 | 🔴/🟡 |
| G — 运维 | D19 废弃说明 · D20 变更历史 · D21 Markdown 渲染格式 | 🟡/🔴 |
| H — 语义正确性 | D22 产品语义正确性 | 🔴 |
| I — 跨客户端适配 | D23 Claude Code 适配层 · D24 客户端支持矩阵 · D25 记忆/报告 agent 字段 | 🔴 |

## 执行优先级分批

| 批次 | 维度 | 说明 |
|------|------|------|
| 🔴 第一批 | D1·D2·D3·D4·D5·D7·D9·D10·D11·D12·D16·D17·D21·D22·D23·D24·D25 | 强制，发现问题立即标记 |
| 🟡 第二批 | D6·D8·D18·D19·D20 | 建议，不阻塞 |
| 💡 第三批 | D13·D14·D15 | 改进，按 Token 预算执行 |

## 关键检查（D5 跨文件一致性）

新增子类型 spec 后必须核查三项（L1~L3）：
- L1：`routing/SKILL.md` 路由表包含该子类型
- L2：`02-output-paths.instructions.md` 注册该子类型目录
- L3：对应 report 模板的子类型字段包含该子类型

---

## 各维度检查项

### A — 结构规范

**D1 文件结构 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `plugin.json` 注册的所有 `agents/*/` 和 `skills/*/` 文件是否实际存在 |
| 2 | 每个 SKILL.md 是否有 YAML frontmatter（`name` + `description`）|
| 3 | 每个 agent 文件是否有 `name`/`description`/`tools` 三字段 |
| 4 | 所有 `prompts/*.prompt.md` 是否有 `agent`/`description`/`applyTo` frontmatter（注：`agent: agent` 为 VS Code Copilot prompt 的正确字段，非 `mode`）|
| 5 | instructions 目录中是否存在无 `applyTo` 的文件（需添加）|

**D2 frontmatter 规范 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | agent frontmatter 中 `tools:` 列表是否符合 Copilot 平台支持的工具名（filesystem/terminal）|
| 2 | DevCodex Skills 注释（`<!-- DevCodex Skills: ... -->`）中的 skill id 是否全部在 `plugin.json` 里注册 |
| 3 | instructions 文件的 `applyTo` 是否正确（全局用 `**`，工作流专属用具体路径）|
| 4 | Skills 注释里的 id 顺序是否与执行依赖顺序一致（core 类 skill 应排在前）|

**D3 路由语法正确性 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `01-common.instructions.md` §意图路由表是否覆盖所有 8 个意图（dev/fix/analyze/audit/self-fix/resume/other/chat），且与 `routing/SKILL.md` / `intent/SKILL.md` 一致 |
| 2 | `intent/SKILL.md` 的三问法和前置识别是否可由 LLM 无歧义执行 |
| 3 | `routing/SKILL.md` 的子类型路由表是否与各工作流 Skill 声明的子类型一致 |

---

### B — 内容质量

**D4 内容完整性 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | 每个 SKILL.md 是否有实质性内容（非空壳/非占位符）|
| 2 | dev/fix/audit 工作流描述中 CP 流程是否完整（CP1/CP2/CP3 定义、触发条件、模板引用）|
| 3 | `compliance/SKILL.md` 的 FC/SC/RC 三层检查项是否有完整的可执行判断标准 |
| 4 | `cp-gate/SKILL.md` 是否覆盖所有 CP 响应类型（确认/修正/拒绝/追问/模糊）|

**D5 跨文件一致性 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | L1~L3 联动检查（见上方关键检查）|
| 2 | `02-output-paths.instructions.md` 与各工作流 report 模板的产物路径是否一致 |
| 3 | `17-compliance.instructions.md` 的 PC0~PC4 预检查、`15-memory.instructions.md` 的读取顺序与 `01-common.instructions.md` 的路由 / Profile 规则是否对齐 |

**D6 示例可执行性 🟡**

| # | 检查内容 |
|:-:|---------|
| 1 | Skills 中的示例代码块（如 `.http`/`.cjs` 格式）是否可直接执行 |
| 2 | `api-verification/SKILL.md` 的双产物示例是否语法正确 |
| 3 | `memory/SKILL.md` 中的路径模板变量（`<project>`/`<agent>`/`YYYYMMDD`）是否有明确的替换规则 |

---

### C — 可维护性

**D7 职责边界 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | 工作流主规则是否收敛在 `instructions/`，Skill 仅承载详细检查标准 / 模板 / 补充说明，Agent 入口不重复维护同一事实 |
| 2 | `instructions/`、`skills/`、`website` 之间是否存在同一事实多处维护但无权威来源声明的分叉 |
| 3 | `compliance/SKILL.md` 是否包含非合规检查内容（如执行逻辑）→ 应拆出 |

**D8 版本标注 🟡**

| # | 检查内容 |
|:-:|---------|
| 1 | `plugin.json` 的 `version` 字段是否与 `CHANGELOG.md` 最新版本一致 |
| 2 | `RULES.md` 头部的版本号是否与 `plugin.json` 一致 |

**D9 引用准确性 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | 各 SKILL.md 中引用的 prompt 模板路径（`prompts/*.prompt.md`）是否全部存在 |
| 2 | Agent 入口文件中的职责说明是否与 `instructions/` 当前真实执行面一致，未继续引用已下沉或已移除的主逻辑 |
| 3 | `report/SKILL.md` 模板引用是否覆盖所有工作流（dev/fix/analyze/audit） |

---

### D — AI 执行性

**D10 指令明确性 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | 每个 SKILL.md 是否有可操作的执行步骤（不止是"应该做X"，而是"执行步骤：1.X 2.Y"）|
| 2 | compliance SC 层每个检查项是否有明确的判断标准（是/否，而非"合理即可"）|
| 3 | fix 工作流的"修复三步必做"是否有具体的 grep 命令示例或搜索模式 |
| 4 | `memory/SKILL.md` 的 SUMMARY.md 格式是否有可直接填写的表头模板 |

**D11 冲突检测 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `00-safety.instructions.md` 与 `01-common.instructions.md` / 各工作流 instructions 之间是否存在规则冲突 |
| 2 | `instructions/` 各文件之间优先级是否明确，是否有相互矛盾的约束 |
| 3 | `17-compliance.instructions.md` 的预检查 / 合规顺序是否与 `01-common.instructions.md`、`15-memory.instructions.md` 的约束优先级一致 |

**D12 路由正确性 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `intent/SKILL.md` 三问法的每个分支是否都能唯一确定一个目标工作流 |
| 2 | 意图为 `other` 时是否明确路由到 plan 工作流（无兜底缺失）|
| 3 | `token-check/SKILL.md` 的当前状态声明是否与 `plugin.json` tier 配置一致 |

---

### E — 可扩展性

**D13 扩展点标注 💡**

| # | 检查内容 |
|:-:|---------|
| 1 | 新增工作流子类型时需更新的文件是否有注释标注（L1~L3 联动）|
| 2 | `plugin.json` 的 `_note_skills` 字段是否说明了子类型 Skill 注册方式 |

**D14 租户覆盖支持 💡**

| # | 检查内容 |
|:-:|---------|
| 1 | `instructions/tenants/` 目录是否存在并有 README 说明覆盖规则 |
| 2 | 租户 instructions 的 frontmatter 格式是否有示例 |

**D15 向后兼容 💡**

| # | 检查内容 |
|:-:|---------|
| 1 | `CHANGELOG.md` 和 `changelogs/` 中的版本映射是否完整（所有变更都有对应记录）|
| 2 | 现有 `npx devcodex init` 安装的文件路径是否与 `plugin.json` 注册路径一致 |

---

### F — 维度体系

**D16 维度编号唯一 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | D1~D25 编号在本文件内无重复 |
| 2 | `audit-execution-guide/SKILL.md` 的分批表与本文件维度编号一致 |

**D17 优先级标注 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | 每个维度有明确优先级标注（🔴/🟡/💡）|
| 2 | 优先级与执行优先级分批表一致（🔴 维度全在第一批，不遗漏）|

**D18 AI-first 设计 🟡**

| # | 检查内容 |
|:-:|---------|
| 1 | 所有 SKILL.md 是否面向 LLM 执行而非人类阅读设计（指令式 > 描述式）|
| 2 | 条件判断是否使用明确的"如果X则Y"格式，避免模糊的"应当/建议"表述 |

---

### G — 运维

**D19 废弃说明 🟡**

| # | 检查内容 |
|:-:|---------|
| 1 | `CHANGELOG.md` 是否记录了已删除的 8 个独立 agent 文件 |
| 2 | 废弃的触发方式（`@dev`/`@fix` 等旧指令）是否有迁移说明 |

**D20 变更历史 🟡**

| # | 检查内容 |
|:-:|---------|
| 1 | `CHANGELOG.md` 格式是否符合 `02-output-paths.instructions.md` 的 CHANGELOG 维护规范 |
| 2 | MAJOR/MINOR 版本是否有对应 `changelogs/vX.Y.Z.md` 详情文件 |

**D21 Markdown 渲染格式 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | 表格每行是否以 `\|` 开头且以 `\|` 结尾，无多余前缀字符（如 `？`/空格/不可见字符）破坏渲染 |
| 2 | 表格分隔符行（`\|:-:\|---\|`）格式是否正确，列数是否与表头一致 |
| 3 | 代码块是否正确闭合（开 ` ``` ` 必有对应的闭合 ` ``` `） |
| 4 | 标题前后是否有空行（Markdown 渲染要求标题前后各一空行） |
| 5 | 嵌套列表缩进是否统一（2 或 4 空格，不混用 Tab） |
| 6 | 表格前是否有空行（Markdown 渲染要求表格前至少一空行，段落/粗体文本直接跟表格会导致渲染失败） |

---

### H — 语义正确性

**D22 产品语义正确性 🔴**

> 历史教训：ENV_MODE 行为在 11+ 文件中搞反（prod 全量合规 / dev 轻量），根因是规范原型定义错误后被忠实复制，无任何节点质疑"行为分配是否符合模式名称的常规含义"。

| # | 检查内容 |
|:-:|---------|
| 1 | **模式语义一致性**：dev/prod/test 等环境模式的行为分配是否符合其常规产品含义（dev=开发调试/全量检查；prod=生产稳定/最小开销）|
| 2 | **角色/层级语义**：Free/Pro/Enterprise 等层级名称的权限分配是否符合层级递进含义（Free ⊂ Pro ⊂ Enterprise）|
| 3 | **功能开关语义**：enable/disable、skip/enforce、required/optional 等控制标志的实际行为是否与名称语义一致 |
| 4 | **跨文件语义传播**：同一模式/角色名称在所有引用处的行为描述是否语义一致（防止 A 文件说 dev=轻量、B 文件说 dev=全量）|

---

### I — 跨客户端适配（v1.9.2+）

> 历史背景：v1.9.0 引入 Claude Code 适配（`devcodex init --claude`、`CLAUDE.md`、`.mcp.json`、`.claude/settings.json` hooks）后，规范分发面从单一 Copilot 扩展为多客户端，但 audit 维度长期未覆盖适配层，导致 CLAUDE.md 与 `lifecycle.cjs` 实现错位、记忆 `<agent>` 字段歧义等问题。

**D23 Claude Code 适配层 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `CLAUDE.md` 与 `index.js` `cmdInitClaude`/`CLAUDE_SOURCES`/`CLAUDE_SETTINGS_HOOKS` 是否描述同一现实（不出现"文档说 A、实现是 B"）|
| 2 | `CLAUDE.md` 引用的 `.claude/skills/` `.claude/instructions/` 路径是否与 `index.js` 实际写入路径一致 |
| 3 | `hooks/_runtime/lifecycle.cjs` 对 Copilot 与 Claude 双平台的 Bootstrap / CP gate / 危险命令拦截是否对称（不出现单边漏判）|
| 4 | `.mcp.json` 与 `index.js` `CLAUDE_MCP_JSON` 是否一致 |
| 5 | `CLAUDE.md` 是否包含 SC/RC/T 完整索引或显式跳转（避免 Claude 用户必须额外读 17-compliance）|

**D24 客户端支持矩阵 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `README.md` 或官网首页是否给出 Client Support Matrix（明示 Copilot/Claude Code/Cursor/Codex 各等级）|
| 2 | 矩阵描述与实际分发链路（`SOURCES` vs `CLAUDE_SOURCES`）一致 |
| 3 | 未支持客户端（如 Codex）是否明示"无适配"而非默认隐瞒 |

**D25 记忆/报告 `<agent>` 字段 🔴**

| # | 检查内容 |
|:-:|---------|
| 1 | `15-memory.instructions.md`、`CLAUDE.md` `02-output-paths.instructions.md` 三处的 `<agent>` 枚举值是否一致（固定集合，无散值）|
| 2 | `devcodex init` / `devcodex init --claude` 是否分别写入 `"agent": "copilot"` / `"agent": "claude-code"` 到 `.devcodex/profile/config.json` |
| 3 | `.devcodex/.memory/clients/<agent>/` 目录命名是否符合上述枚举 |
| 4 | 报告路径 `.devcodex/reports/<type>/<agent>/YYYYMMDD/` 中 `<agent>` 是否同样符合枚举 |

