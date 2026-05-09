# 深度审查报告：Stage 0~6 vs v0.03 vs v4

> **审查日期**：2026-04-08  
> **审查范围**：Stage 0~6 实施计划文件 ↔ v0.03（当前生产版本）↔ v4（ai-dev-guidelines 规范层）↔ 已产出文件  
> **审查方法**：逐文件对照 + 规则映射 + 缺口分析

> ⚠️ 历史审查说明：本页是 **2026-04-08** 针对 v1.0.0 Stage 计划面的历史审查记录，保留的是当时的差异判断与闭环动作，不再作为当前规范真相源。

---

## 目录

- [1. 总体评估](#1-总体评估)
- [2. Stage 维度：逐阶段审查结果](#2-stage-维度逐阶段审查结果)
- [3. 横切面问题](#3-横切面问题)
- [4. 已产出文件审查](#4-已产出文件审查)
- [5. v0.03 → v1.0.0 差异汇总表](#5-v003--v100-差异汇总表)
- [6. v4 → v1.0.0 差异汇总表](#6-v4--v100-差异汇总表)
- [7. 建议行动项](#7-建议行动项)

---

## 1. 总体评估

### 覆盖率

| 维度 | 计划 | v0.03 总量 | 覆盖率 | 说明 |
|------|:----:|:---------:|:------:|------|
| Instructions | 11 | 11 | **100%** | 全部覆盖 |
| Skills | 11 | 34 | **32%** | ⚠️ **23 个子类型 Skill 无阶段归属** |
| Agents | 2 | 1 | **200%** | v1 新增 devcodex-auto |
| Data 模板 | 3 | 3 | **100%** | 加入 gap-registry.md |

### 关键发现

| # | 严重度 | 发现 |
|:-:|:------:|------|
| F01 | 🔴 | **23 个 Skill 文件无阶段归属**：Agent 引用 34 个 Skills，Stage 0~6 仅规划 11 个，剩余 23 个（含关键的 dev-plan-review、impact-review、api-verification）未分配到任何 Stage |
| F02 | 🔴 | **安全底线与通用规范完全重复**：S01~S06 和 C01/C03/C04/C05/C06/C10 在两个文件中各写了一遍完整说明 |
| F03 | 🟡 | **violations.md 格式不一致**：v0.03 用六列表格/YAML 块，v4 用十列行内表格，v1 Stage 需选择统一格式 |
| F04 | 🟡 | **产物路径硬编码中文**：`<中文描述>` / `01-需求概述.md` 等文件名硬编码中文，非中文用户不适用 |
| F05 | 🟡 | **违规审计触发时机未在 Agent 中明确**：② 安全检查（主动）和 ⑨ 合规检查（被动）两个触发点未在 Agent 文件中显式区分 |
| F06 | 🟡 | **记忆路径不一致**：v4 用 `.ai-memory/`，v1 用 `.devcodex/.memory/`，虽是有意设计但缺少映射文档 |
| F07 | 💡 | **ENV_MODE 对合规的影响散落多处**：compliance Skill §0、17-compliance.instructions.md、cp-gate Skill 三处各自描述 ENV_MODE，可能不同步 |
| F08 | 💡 | **prompts/ 目录未纳入 Stage 计划**：v0.03 引用了 ~15 个 prompt 模板，但无任何 Stage 规划产出 |

---

## 2. Stage 维度：逐阶段审查结果

### Stage 0 — 冻结 ✅

无问题。已完成。

### Stage 1 — ① 预检查 ✅

| 检查项 | 结果 | 说明 |
|--------|:----:|------|
| 文件列表完整 | ✅ | 7 个文件全部规划 |
| v0.03 对照 | ✅ | 所有 v0.03 内容项均已覆盖 |
| v4 对照 | ✅ | NODE_META、优先级、降级处理均覆盖 |
| 已产出文件 | ✅ | 6 个已创建（00/01/02/intent/load-profile/agent×2）|

**已产出文件与 Stage 规格对照**：

| 文件 | Stage 要求 | 已产出实际 | 差异 |
|------|----------|-----------|------|
| `00-safety` | ✅ 中文（与v0.03一致）| 执行原则改为中文编写 |
| `01-common` | ✅ 中文 + 新增全自动模式 C02 豁免段 | |
| `02-output-paths` | ✅ 中文（与v0.03一致）| |
| `intent/SKILL.md` | ✅ 中文（与v0.03一致）| |
| `load-profile/SKILL.md` | ✅ 中文 | |
| `devcodex.agent.md` | Stage 1 骨架 | ✅ 完整 210 行（含工作流段落）| 超出 Stage 1 范围，已包含 Stage 2/4/5 内容 |
| `devcodex-auto.agent.md` | v1 新建 | ✅ 44 行 | |

### Stage 2 — ② 安全检查

| 检查项 | 结果 | 说明 |
|--------|:----:|------|
| AUDIT_LOG 双写 | ✅ 已补充 | 记忆+violations.md 双写规则 |
| 触发时机 | ✅ 已补充 | 主动（②）+被动（⑨）两个触发点 |
| violations.md 格式 | ⚠️ | 需最终确定十列（v4）vs 六列（v0.03）vs YAML 块（v0.03 实际文件）|
| gap-registry.md | ✅ 已补充 | v0.03 引用但原 Stage 遗漏 |
| Agent 安全检查段 | ✅ | 已在 Agent 中实现 |

### Stage 3 — ③④ 摘要 + 记忆

| 检查项 | 结果 | 说明 |
|--------|:----:|------|
| 三层记忆架构 | ✅ 已补充 | Agent 日记/需求级/项目总 |
| Agent SUMMARY 格式 | ✅ 已补充 | 七列表格 |
| 路径差异 vs v4 | ✅ 已补充 | `.devcodex/.memory/` vs `.ai-memory/` |
| 📨 四列表格格式 | ✅ 已补充 | v0.03 FC1 检查要求 |
| resume 14 天策略 | ✅ | |
| 解析失败处理 | ✅ 已补充 | 重命名 .bak.md |

### Stage 4 — ⑤⑥⑦ 汇总 + 合规 + 路由

| 检查项 | 结果 | 说明 |
|--------|:----:|------|
| ENV_MODE 预检查行为 | ✅ 已补充 | dev→PC1~PC3 / prod→无预检查块 |
| 输出语言检测 | ✅ 已补充 | v4 N16 PRECHECK_OUTPUT |
| 违规质疑路由 | ✅ | 强制路由到 audit |
| 多意图处理 | ✅ 已补充 | v4 routing.md 逐一路由规则 |
| 子类型路由完整性 | ✅ | dev 8 / fix 3 / audit 6 / analyze 2 |
| resume 约束 | ✅ 已补充 | chat 不产生中断 |

### Stage 5 — ⑧ 工作流执行

| 检查项 | 结果 | 说明 |
|--------|:----:|------|
| 文件数 | 🔄 8→9 | dev-default 和 fix-default 拆为独立文件 |
| v0.03 内容完整覆盖 | ✅ | 每个 instruction/skill 的所有内容项已对照 |
| **23 个缺失 Skill** | 🔴 | 明确标注，建议创建 Stage 7 |
| C12 合理性评估 | ✅ 已补充 | dev/fix 均在 CP1 前执行 |
| 代码风格读取 | ✅ 已补充 | dev/fix 进入前读取 profile |
| 重构 vs 优化边界 | ✅ 已补充 | |
| 高风险操作定义 | ✅ 已补充 | fix CP3 触发条件 |
| 修复范围边界 | ✅ 已补充 | self-fix vs dev vs fix 三路 |
| 拒绝级 | ✅ 已补充 | 规范语义变更→拒绝 |
| 防递归 | ✅ 已补充 | 合规失败→内联修正 |
| ENV_MODE CP 行为 | ✅ 已修正 | dev/prod 均强制等待（CP 不受 ENV_MODE 影响） |
| 全自动模式 | ✅ | v1 新增 |

### Stage 6 — ⑨⑩⑪⑫ 合规 + 报告 + 收尾

| 检查项 | 结果 | 说明 |
|--------|:----:|------|
| ENV_MODE §0 | ✅ 已修正 | prod=不执行 / dev=全量 |
| 预检查 PC1~PC3 | ✅ 已补充 | 独立于 FC/SC |
| 强制可见输出 | ✅ 已补充 | 合规状态块（dev/prod 不同格式）|
| analyze 豁免 RC | ✅ 已补充 | |
| 累计修正上限 | ✅ 已补充 | ≥5 次→停止循环 |
| 需求级/项目级报告路径 | ✅ 已补充 | 双层路径 |
| audit/fix 额外头部 | ✅ 已补充 | |
| 跨会话报告 | ✅ 已补充 | 三场景 |
| 报告末尾引用 | ✅ 已补充 | |
| V5 反向质疑三问 | ✅ | |
| 文件总数更新 | ✅ | 26→27（+gap-registry）|
| Stage 7 缺口 | ✅ 已标注 | 23 个 Skill 需补全 |

---

## 3. 横切面问题

### 3.1 安全底线与通用规范重复（F02）

| 安全底线（00-safety）| 通用规范（01-common）| 关系 |
|---------------------|---------------------|------|
| S01 | C01 🔒 S01 | **完全重复**（完整说明各写一遍）|
| S02 | C03 🔒 S02 | **完全重复** |
| S03 | C04 🔒 S03 | **完全重复** |
| S04 | C06 🔒 S04 | **完全重复** |
| S05 | C05 🔒 S05 | **完全重复** |
| S06 | C10 🔒 S06 | **完全重复** |

**v0.03 设计意图**：`01-common` 中标注 `🔒 S0x` 交叉引用。  
**实际效果**：同一条规则的完整说明在两个文件中各写了一遍。

**建议**：`01-common` 中 C01/C03/C04/C05/C06/C10 只保留编号 + 一句引用 "同 S0x，见 `00-safety`"，不再重复完整说明。

### 3.2 产物路径中文硬编码（F04）

`02-output-paths.instructions.md` 中硬编码了中文文件名：

```
├── requirements/<中文描述>/
│   ├── 01-需求概述.md
│   ├── 02-技术方案.md
```

**问题**：英文用户使用时，文件名/目录名应跟随用户语言。

**建议**：在文件顶部增加一条规则：
> 目录名（`<描述>`）和产物文件名以用户输入的主要语言为准。下方示例使用中文；英文用户应使用对应英文命名（如 `01-requirements.md`）。

### 3.3 记忆路径分歧（F06）

| 体系 | 路径根 | 原因 |
|------|--------|------|
| v4 (ai-dev-guidelines) | `projects/<project>/.ai-memory/` | 独立于任何 Plugin，直接在项目中 |
| v1 (devcodex Plugin) | `<项目根>/.devcodex/.memory/` | 在 Plugin 的 `.devcodex/` 伞下 |

两者**内部结构一致**（`clients/<agent>/tasks/YYYYMMDD.md`），差别仅在根路径。

**建议**：在 `02-output-paths.instructions.md` 中增加一段 "路径映射说明"，明确 v4 的 `.ai-memory/` 等价于 v1 的 `.devcodex/.memory/`。

### 3.4 ENV_MODE 分散描述（F07）

ENV_MODE 影响出现在三处：

| 文件 | 影响描述 |
|------|---------|
| `cp-gate/SKILL.md` | dev/prod 均 CP 强制等待（跳过仅限 @devcodex-auto） |
| `compliance/SKILL.md` §0 | prod=不执行 / dev=全量 |
| `17-compliance.instructions.md` | dev→输出PC1~PC3 / prod→无 |

**建议**：在 `01-common.instructions.md` 中增加一个 "ENV_MODE 行为总表"，集中描述 dev/prod 对各 Skill 的影响差异，各 Skill 文件引用该总表。

### 3.5 Prompts 模板未纳入 Stage（F08）

v0.03 引用的 prompts 模板：

```
prompts/cp-checklist.prompt.md
prompts/requirement.prompt.md
prompts/technical-design.prompt.md
prompts/implementation-plan.prompt.md
prompts/problem-analysis.prompt.md
prompts/report-analysis.prompt.md
prompts/report-audit.prompt.md
prompts/report-dev.prompt.md
prompts/report-fix.prompt.md
prompts/memory-session.prompt.md
prompts/agent-summary.prompt.md
prompts/requirement-session.prompt.md
prompts/reply-summary.prompt.md
```

这些模板在 Stage 0~6 中未被规划为产出物。v4 将它们放在 `templates/` 目录下。

**建议**：将 prompts 模板纳入 Stage 7 或创建独立 Stage 8。

---

## 4. 已产出文件审查

### 4.1 已产出文件 vs v0.03 差异

| 文件 | 已产出行数 | v0.03 行数 | 差异 |
|------|:--------:|:--------:|------|
| `00-safety` | 52 | 52 | ✅ 完全一致 |
| `01-common` | 69 | 61 | ✅ 新增全自动模式段（+8行）|
| `02-output-paths` | 83 | 83 | ✅ 完全一致 |
| `intent/SKILL.md` | 88 | 88 | ✅ 完全一致 |
| `load-profile/SKILL.md` | 71 | 71 | ✅ 完全一致 |
| `devcodex.agent.md` | 210 | 187 | ✅ 新增全自动/工作流段落（+23行）|
| `devcodex-auto.agent.md` | 44 | ❌ 不存在 | ✅ v1 新增 |

### 4.2 已产出文件 vs Stage 规格差异

| 文件 | Stage 规定 | 实际 | 说明 |
|------|-----------|------|------|
| 语言 | Stage 1 执行原则写"中文编写" | ✅ 中文 | 与规格一致 |
| Agent 完成度 | Stage 1 要求 TODO 占位 | 已补全 Stage 2/4/5 内容 | 超前实现，不影响 |
| `01-common` 全自动模式 | Stage 1 要求 v1 新增 | ✅ 已实现 | |

---

## 5. v0.03 → v1.0.0 差异汇总表

| # | 差异项 | v0.03 | v1.0.0 | 类型 |
|:-:|--------|------|--------|:----:|
| D01 | Agent 数量 | 1（devcodex） | 2（+devcodex-auto） | 新增 |
| D02 | 全自动模式 | 无 | CP 自动通过 + 失败回退 | 新增 |
| D03 | 路径根 | `.devcodex/` | `.devcodex/`（不变）| 保持 |
| D04 | violations.md 格式 | 六列+YAML 块 | 待确认（建议十列对齐 v4）| 待定 |
| D05 | gap-registry.md | 有 | Stage 2 新增 | 补齐 |
| D06 | 产物路径中文 | 硬编码中文 | 硬编码中文（建议加语言规则）| 遗留 |
| D07 | RULES.md | 用户向导（50行）| 不变 | 保持 |
| D08 | dev-default 阶段数 | 四阶段 | 五阶段（+N3 方案验证）| 对齐 Stage |
| D09 | 📨 对话记录格式 | 四列表格 | 四列表格（Stage 3 已明确）| 保持 |
| D10 | 子类型 Skill 文件 | 34 个 | 11 个（Stage 0~6），需 Stage 7 补 23 个 | 缺口 |

---

## 6. v4 → v1.0.0 差异汇总表

| # | 差异项 | v4 (ai-dev-guidelines) | v1.0.0 (devcodex) | 说明 |
|:-:|--------|----------------------|-------------------|------|
| V01 | 架构 | RULES.md + NODE_META + specs/ | Agent + Instructions + Skills | 不同分发机制，内容一致 |
| V02 | 记忆路径 | `.ai-memory/` | `.devcodex/.memory/` | 有意差异，结构一致 |
| V03 | 产物路径 | `projects/<project>/` | `<项目根>/.devcodex/` | 有意差异 |
| V04 | AUDIT_LOG | 双写（memory + violations.md）+ 十列格式 | 需对齐 | Stage 2 已规划 |
| V05 | NODE_META | 流程图注释驱动 | Agent 文件内联 | 等价实现 |
| V06 | PRECHECK_OUTPUT | N16 节点 | ⑥ 内联 | 等价实现 |
| V07 | routing | N05 `fetch:false`（参考文档）| routing SKILL.md | v4 声明仅参考 |
| V08 | 租户覆盖 | `tenants/<id>/specs/` | `instructions/tenants/<id>/` | 路径不同，机制一致 |
| V09 | 设计原则 | 明确写入 common.md §4 | 未在 Stage 中规划 | 可在 01-common 补充 |
| V10 | tools/ | 辅助脚本（可选） | 未规划 | P2 优先级 |

---

## 7. 建议行动项

### 🔴 必须修复（影响 Agent 功能完整性）

| # | 行动项 | 预估影响 | 状态 |
|:-:|--------|---------|:----:|
| A01 | **创建 [Stage 7](stage-7.md)**：产出 23 个子类型 Skill 文件 + 20 个 prompts 模板 | 否则 Agent 引用的 34 个 Skill 中 23 个不存在 | ✅ 已完成 |
| A02 | **统一 violations.md 格式**：选择十列（v4），在 `data/violations.md` 模板中确定 | 否则安全审计记录不一致 | ✅ 已完成 |

### 🟡 应当修复（影响规范质量）

| # | 行动项 | 预估影响 | 状态 |
|:-:|--------|---------|:----:|
| A03 | **消除 S/C 重复**：`instructions/01-common.instructions.md` 中 C01/C03/C04/C05/C06/C10 改为一句引用 | 减少歧义和维护成本 | ✅ 已完成 |
| A04 | **产物路径增加语言规则**：`instructions/02-output-paths.instructions.md` 顶部增加文件名语言跟随用户语言的规则 | 支持非中文用户 | ✅ 已完成 |
| A05 | **在 Agent 中标注违规审计双触发点**：② 安全检查（主动）+ ⑨ 合规检查（被动）| 消除触发时机歧义 | ✅ 已完成 |
| A06 | **增加路径映射文档**：在 `instructions/02-output-paths.instructions.md` 中说明 v4 `.ai-memory/` 与 v1 `.devcodex/.memory/` 的对应关系 | 跨体系开发者理解 | ✅ 已完成 |

### 💡 建议改进

| # | 行动项 | 预估影响 | 状态 |
|:-:|--------|---------|:----:|
| A07 | **集中 ENV_MODE 行为总表**：在 `instructions/01-common.instructions.md` 增加 dev/prod 对各 Skill 行为差异的统一表 | 减少分散描述不同步风险 | ✅ 已完成 |
| A08 | **并入 [Stage 7](stage-7.md)**：产出 20 个 prompts 模板文件 | 否则 Skill 引用的模板不存在 | ✅ 已完成 |
| A09 | **v4 设计原则搬入 `instructions/01-common.instructions.md`**：将"质量第一效率第二"、强制执行原则等写入通用规范 | 提升 AI 执行合规性 | ✅ 已完成 |

---

## 附录：文件总量统计

| 阶段 | Agents | Skills | Instructions | Data | Prompts | 小计 |
|------|:------:|:------:|:----------:|:----:|:------:|:----:|
| Stage 0 | — | — | — | — | — | 0 |
| Stage 1 | 2 | 2 | 3 | — | — | 7 |
| Stage 2 | (+段落) | — | — | 3 | — | 3 |
| Stage 3 | — | 2 | 1 | — | — | 3 |
| Stage 4 | (+段落) | 1 | — | — | — | 1 |
| Stage 5 | — | 4 | 5 | — | — | 9 |
| Stage 6 | — | 2 | 2 | — | — | 4 |
| **Stage 0~6** | **2** | **11** | **11** | **3** | **0** | **27** |
| [Stage 7](stage-7.md) | — | 23 | — | — | 20 | 43 |
| **总计** | **2** | **34** | **11** | **3** | **20** | **70** |

