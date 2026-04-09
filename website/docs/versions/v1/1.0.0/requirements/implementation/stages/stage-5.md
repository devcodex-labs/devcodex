# Stage 5 — ⑧ 工作流执行

> **主流程节点**：⑧ 工作流执行  
> **对应流程图**：各工作流有独立流程，v1.0.0 不在 `/specs/` 中固化，属于版本化需求  
> **状态**：✅ 已完成（2026-04-08）

---

## 流程回顾

```
路由完成后 → 进入对应工作流：
  dev  → CP1(需求确认)→CP2(方案确认)→plan-review→impact-review→CP3(实施计划)→执行
  fix  → CP1(问题确认)→CP2(方案确认)→执行→三步扫描→CP3(条件触发)
  audit → 多轮收敛（连续 N 轮无新发现）
  analyze → 单轮只读分析
  self-fix → A1~A5 自动修复 / Pending 级记录
  resume → 恢复上下文 → 重路由原始工作流
  plan → 拆解目标 → 执行计划
  chat → 直接回复
```

---

## ⚠️ 覆盖范围说明

**Stage 5 仅覆盖**：主线工作流 Instructions + 核心 Skills（cp-gate/plan/dev-default/fix-default）。

Agent 文件引用的 **34 个 Skills** 中，Stage 5 仅产出 **4 个**。其余 **23 个子类型 Skills**（已在 Stage 1~4/6 中覆盖 7 个）不在本阶段范围内：

| 类别 | 缺失 Skills | 说明 |
|------|------------|------|
| dev 子类型 | dev-refactor / dev-database / dev-init / dev-optimization / dev-scenario-test / dev-docs / dev-plan-review | 7 个，各有独立 v0.03 Skill 文件 |
| fix 子类型 | fix-incident / fix-security | 2 个 |
| audit 相关 | audit-common / audit-dimensions / audit-tech-design / audit-requirements / audit-project / audit-report / audit-document / audit-execution-guide | 8 个 |
| analyze 子类型 | analyze-research | 1 个 |
| self-fix 子类型 | self-fix-auto | 1 个 |
| 执行后 | api-verification / document-sync / impact-review | 3 个，被 dev/fix 执行后引用 |
| 授权 | token-check | 1 个，路由后调用 |

> 📌 **建议**：这 23 个 Skill 文件可作为 **Stage 5b** 或 **Stage 7** 单独实施，否则 Agent 引用的 Skill 列表与实际文件不匹配。

---

## 待产出文件清单（9 个）

### 1. `instructions/10-dev.instructions.md`

**中文对应**：dev 工作流规范  
**v0.03 参考**：`v0.03/instructions/10-dev.instructions.md`（56 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 8 子类型定义 | default / refactor / database(Pro) / init / optimization(Pro) / scenario-test(Pro) / docs / plan-review | |
| CP 流程（C02 约束）| CP1(需求确认) → CP2(方案确认) → plan-review → impact-review → CP3(实施计划) → 执行 | |
| **C12 合理性评估** | 意图识别后、CP1 前必须执行；有更好方案→先提出等确认 | **v0.03 明确** |
| plan-review | 非 docs/plan-review 子类型触发；🔴 阻断时回 CP2 | |
| impact-review | **仅**由 PR-5②"跨模块架构依赖变更"触发；PR-5①→api-verification；PR-5③→dev-database | **v0.03 三路分发** |
| 执行规则 | 逐文件；error 最多 2 次迭代；仍失败→停止标 ⚠️ | |
| 执行后 | 接口变更→api-verification / 源码变更→document-sync / 报告→report / 记忆→memory | |
| C15 架构质量三维评估 | plan-review 含 PR-6 可扩展性/可维护性/易上手性 | |
| **代码风格** | dev 进入前必须读取 `profile/03-代码风格.md`；profile 优先于默认值 | **v0.03 明确** |
| **重构 vs 优化边界** | refactor≡结构变更不改功能；optimization≡功能不变提升性能；模糊时优先 refactor | **v0.03 明确** |

---

### 2. `instructions/11-fix.instructions.md`

**中文对应**：fix 工作流规范  
**v0.03 参考**：`v0.03/instructions/11-fix.instructions.md`（51 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 3 子类型 | default / incident(Pro) / security(Pro) | |
| **C12 合理性评估** | 有更好建议先提出，确认后再执行 | |
| CP 流程 | CP1(问题确认:根因+影响) → CP2(方案确认) → impact-review(条件) → 执行 → CP3(≥5文件或高风险) | |
| **高风险操作定义** | DDL 变更 / 配置文件变更(.env/package.json/CI) / 文件删除 / 直接影响生产环境 | **v0.03 明确** |
| 三步必做（SC3） | ① 同类全局扫描 ② 数据联动扫描 ③ grep 零残留复核 | |
| C15 | CP2 方案须附三维评估 | |
| **代码风格** | fix 进入前必须读取 `profile/03-代码风格.md` | |
| **执行约束** | 编码后必须运行 lint/typecheck/test；error 最多 2 次迭代 | |

---

### 3. `instructions/12-audit.instructions.md`

**中文对应**：audit 工作流规范  
**v0.03 参考**：`v0.03/instructions/12-audit.instructions.md`（39 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 只读约束 | 禁止修改文件；发现问题只输出清单和变更建议 | |
| 6 审查目标类型 | 规范文件 / 技术方案 / 需求文档 / 项目工程(Pro) / 报告 / 通用文档 | |
| **审查目标识别** | 基于用户意图智能识别（不依赖关键词，以覆盖范围和收敛期望为准）| **v0.03 §1~§2** |
| **维度规范加载优先级** | 租户定制(P3) > Plugin 默认(P5) > 01-common 兜底(P5) | **v0.03 明确** |
| 收敛规则 | 连续 N 轮无新发现（定向=2轮，全面=3轮） | |
| **未收敛时** | 自动进入下一轮，不询问用户 | **v0.03 明确** |
| 三项验证 | 每条问题必须附合理性+可实施性+收益 | |
| **维度盲区** | 遇到无对应维度的问题 → 标注 `[维度盲区]` → 写入 `data/gap-registry.md` | **v0.03 明确** |
| 🔴 自动 self-fix | 含 🔴 问题且三列验证全通过 → 直接启动 self-fix；存在 ⚠️ → 建议用户确认 | |

---

### 4. `instructions/13-analyze.instructions.md`

**中文对应**：analyze 工作流规范  
**v0.03 参考**：`v0.03/instructions/13-analyze.instructions.md`（32 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 只读约束 | 禁止修改文件 | |
| 单轮完成 | 输出结论即完成（不进行多轮收敛，区别于 audit） | |
| 子类型 | 技术调研(research) — 按 analyze-research Skill 多步骤执行 / 默认分析 — 单轮直接分析 | **v0.03 明确** |
| 三项验证 | 每条结论附合理性+可实施性+收益（⛔ 缺少任意一项 → SC1 不通过）| |
| **影响评估触发** | 分析结论涉及架构/方案影响时 → 调用 impact-review Skill | **v0.03 明确** |
| 需修改时 | 报告中建议用户重新发送 → 触发 dev/fix | |

---

### 5. `instructions/14-self-fix.instructions.md`

**中文对应**：self-fix 工作流规范  
**v0.03 参考**：`v0.03/instructions/14-self-fix.instructions.md`（51 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| 修改对象 | DevCodex 规范文件（agents/skills/instructions/prompts/RULES.md）| |
| **修复范围边界** | self-fix=规范文件 / dev=源码配置 / fix=源码Bug；功能迭代→路由到 dev | **v0.03 三路边界** |
| A1~A5 自动级 | 错别字/断链/表格缺行/frontmatter缺失/编号错误 → 直接修复 | |
| Pending 级 | 规范表述/流程/体系变更 → 记录到 data/pending-fixes.md | |
| **拒绝级** | 涉及规范语义变更 → 拒绝自动修复，提示用户通过 dev 处理 | **v0.03 明确** |
| 单次上限 | 最多修复 5 个文件，超出建议拆分会话 | |
| **自动级后验证** | ① 目标文件已含修复内容 ② 关联文件交叉引用已同步(C11) ③ 工具扫描零残留 | **v0.03 三项必做** |
| **违规记录（T_RECORD）** | "记录违规"→直接追加 violations.md，不走 SCOPE→CLASSIFY 流程 | **v0.03 明确** |
| **违规关闭三条件** | ① 处置完成 ② 防复发措施写入规范 ③ 后续流程验证生效 | **v0.03 明确** |
| **防递归** | 合规检查失败→当前工作流内联修正（不进 self-fix）；连续 2 次同类偏差→升级分析 | **v0.03 明确** |

---

### 6. `skills/cp-gate/SKILL.md`

**中文对应**：CP 流程门控  
**v0.03 参考**：`v0.03/skills/cp-gate/SKILL.md`（71 行）  
**v4 参考**：`v4/specs/confirmation-points.md`（96 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: cp-gate` / `description: "Checkpoint gate control..."` | |
| **ENV_MODE 模式判断** | dev/prod 均强制等待确认（CP 不受 ENV_MODE 影响，跳过仅限 @devcodex-auto）| **v1.0.0 修正** |
| CP1/CP2/CP3 定义 | 每个 CP 的输入/输出/等待条件 | |
| 确认模式 | 每个 CP 等待用户 yes/no | 默认 |
| **全自动模式** | CP 自动通过；但 S01/C01/C10 不可豁免 | **v1.0.0 新增** |
| 失败回退 | 可恢复→重试≤2次 / 不可恢复→切换回确认模式 | 全自动专属 |
| CP3 触发条件 | fix: ≥5文件或高风险 / dev: 固定触发 | |
| **C02 执行规则** | 7 条：严格按序/禁止合并/独立确认/用户请求≠确认/"继续"≠CP3/跨轮次状态保持/产物文件前置创建 | **v0.03+v4 完整** |
| **CP 响应处理** | ✅确认/✏️修正/❌拒绝/？追问/🔀模糊（不得推进） | **v0.03 五种** |
| **CP 记录格式** | 报告中「CP 确认记录」表（CP/状态/用户响应/时间）| |
| 模板引用 | `prompts/cp-checklist.prompt.md` | |

---

### 7. `skills/plan/SKILL.md`

**中文对应**：plan 工作流（other 意图兜底）  
**v0.03 参考**：`v0.03/skills/plan/SKILL.md`（43 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: plan` / `description: "Planning workflow for unmatched intents..."` | |
| 触发条件 | intent = other | |
| **工作流重评估** | 若请求实质属于 dev/fix/analyze/audit/self-fix → 提示用户建议切换（🔴 不强制）| **v0.03 明确** |
| 流程 | 分析请求 → 重评估 → 制定执行计划 → 用户确认 → 逐步执行 | 4 步 |
| **执行计划格式** | 表格：序号/步骤/产出/风险 | **v0.03 明确** |
| 授权 | Pro | |
| **约束** | 涉及文件修改→C01；无 CP 强制（复杂任务建议分步）；不跳过合规；C12 合理性评估 | **v0.03 四条** |

---

### 8. `skills/dev-default/SKILL.md`

**中文对应**：dev 默认子类型  
**v0.03 参考**：`v0.03/skills/dev-default/SKILL.md`（33 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: dev-default` / `description: "Default dev sub-type..."` | |
| 触发条件 | dev 工作流未匹配其他子类型（新功能/接口实现/业务逻辑）| |
| **五阶段执行** | N1 需求确认(CP1) → N2 技术方案(CP2) → N3 方案验证(plan-review, 🔴阻断回CP2; PR-5②触发 impact-review) → N4 实施计划(CP3) → N5 执行(编码→api-verification→document-sync) | **v0.03 五阶段** |
| 关键规则 | 三 CP 按序/plan-review 强制门禁/impact-review 仅 PR-5②/测试覆盖 | |
| 无豁免 | 完整走 CP1→CP2→CP3 | |

---

### 9. `skills/fix-default/SKILL.md`

**中文对应**：fix 默认子类型  
**v0.03 参考**：`v0.03/skills/fix-default/SKILL.md`（41 行）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: fix-default` / `description: "Default fix sub-type..."` | |
| 触发条件 | Bug/功能异常/报错，未匹配 incident/security | |
| **问题诊断三步（CP1 前）** | S1 重现(稳定重现+记录步骤) → S2 定位(文件/函数/行号) → S3 影响评估(功能/接口/用户) | **v0.03 明确** |
| CP 流程 | CP1(问题定性+根因+影响) → CP2(修复方案+回归测试策略，不需 CP3 直接执行) | |
| 执行阶段 | ① 最小化修复 ② 回归测试 ③ **三步必做**(SC3) ④ api-verification ⑤ impact-review(PR-5②) ⑥ document-sync | **v0.03 六步** |
| 关键规则 | 修复必须附回归测试（emergency 除外）/ 修复范围不得超出问题边界（禁止顺手重构）| **v0.03 明确** |

---

## 文件对照总表

| # | 英文目标文件 | 中文职责 | v0.03 参考 | 流程步骤 |
|:-:|------------|---------|-----------|---------|
| 1 | `instructions/10-dev.instructions.md` | dev 工作流 8 子类型 | ✅ 有（56 行）| ⑧ dev 执行 |
| 2 | `instructions/11-fix.instructions.md` | fix 工作流 3 子类型 | ✅ 有（51 行）| ⑧ fix 执行 |
| 3 | `instructions/12-audit.instructions.md` | audit 多轮收敛 | ✅ 有（39 行）| ⑧ audit 执行 |
| 4 | `instructions/13-analyze.instructions.md` | analyze 单轮只读 | ✅ 有（32 行）| ⑧ analyze 执行 |
| 5 | `instructions/14-self-fix.instructions.md` | self-fix A1~A5 | ✅ 有（51 行）| ⑧ self-fix 执行 |
| 6 | `skills/cp-gate/SKILL.md` | CP 门控 + ENV_MODE + 全自动 | ✅ 有（71 行）| CP1/CP2/CP3 |
| 7 | `skills/plan/SKILL.md` | plan 兜底工作流 | ✅ 有（43 行）| ⑧ plan 执行 |
| 8 | `skills/dev-default/SKILL.md` | dev 默认五阶段 | ✅ 有（33 行）| ⑧ dev-default |
| 9 | `skills/fix-default/SKILL.md` | fix 默认三步诊断 | ✅ 有（41 行）| ⑧ fix-default |

---

## ⚠️ Stage 5 未覆盖的 Skill 文件（23 个）

以下 Skill 文件在 v0.03 中存在且被 Agent 引用，但不在 Stage 0~6 任何阶段的产出清单中：

```
skills/token-check/SKILL.md           ← 授权门控
skills/dev-refactor/SKILL.md           ← dev 子类型
skills/dev-database/SKILL.md           ← dev 子类型 (Pro)
skills/dev-init/SKILL.md               ← dev 子类型
skills/dev-optimization/SKILL.md       ← dev 子类型 (Pro)
skills/dev-scenario-test/SKILL.md      ← dev 子类型 (Pro)
skills/dev-docs/SKILL.md               ← dev 子类型
skills/dev-plan-review/SKILL.md        ← dev 强制门禁
skills/fix-incident/SKILL.md           ← fix 子类型 (Pro)
skills/fix-security/SKILL.md           ← fix 子类型 (Pro)
skills/audit-common/SKILL.md           ← audit 通用规则
skills/audit-dimensions/SKILL.md       ← audit 规范文件
skills/audit-tech-design/SKILL.md      ← audit 技术方案
skills/audit-requirements/SKILL.md     ← audit 需求文档
skills/audit-project/SKILL.md          ← audit 项目工程 (Pro)
skills/audit-report/SKILL.md           ← audit 报告
skills/audit-document/SKILL.md         ← audit 通用文档
skills/audit-execution-guide/SKILL.md  ← audit 执行指南
skills/analyze-research/SKILL.md       ← analyze 子类型
skills/self-fix-auto/SKILL.md          ← self-fix 自动级
skills/api-verification/SKILL.md       ← 执行后验证
skills/document-sync/SKILL.md          ← 执行后同步
skills/impact-review/SKILL.md          ← 执行后评估
```

> **建议创建 [Stage 7](stage-7.md)**（子类型 Skills + Prompts 模板）专门产出这 23 个 Skill 文件 + 20 个 prompts 模板。

