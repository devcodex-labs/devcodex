# Stage 6 — ⑨⑩⑪⑫ 合规 + 报告 + 收尾

> **主流程节点**：⑨ 执行阶段合规检查 · ⑩ 输出报告 · ⑪ 更新记忆 · ⑫ 完成前合规检查  
> **对应流程图**：[主流程图](/specs/flowcharts) · [合规检查框架](/specs/compliance-framework)  
> **状态**：✅ 已完成（2026-04-08）

> ⚠️ 历史阶段说明：本页记录的是 **v1.0.0 / 2026-04-08** 的 Stage 6 设计与审查结果。当前报告路径、文件数量和 Hooks 分发面已在后续版本演进；若与当前 `16-report.instructions.md`、`17-compliance.instructions.md` 或 `README.md` 冲突，以当前文件为准。

---

## 流程回顾

```
⑨ 执行阶段合规检查（FC）：
  工作流执行完毕 → 检查执行链是否完整 → 是否遗漏必要扫描/验证

⑩ 输出报告：
  按工作流类型选择模板 → 填写头部+正文 → 写入报告文件

⑪ 更新记忆：
  追加/更新今日记忆文件 → 更新 Agent SUMMARY → 按需更新全局 SUMMARY
  → 按需更新需求级记忆

⑫ 完成前合规检查（RC + T）：
  报告已输出? → 记忆已更新? → 审计记录已落盘? → 状态已闭环? → 确认完成
```

---

## 待产出文件清单（4 个）

### 1. `skills/compliance/SKILL.md`

**中文对应**：合规检查（三层体系）  
**v0.03 参考**：`v0.03/skills/compliance/SKILL.md`（147 行）  
**v4 参考**：`v4/specs/compliance.md`（148 行）  
**所属流程步骤**：⑨ FC + ⑫ RC（也供 ⑥ 开发闸门调用）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: compliance` / `description: "Three-layer compliance check..."` | |
| **§0 ENV_MODE 模式判断** | prod=不执行合规检查（规范已验证）/ dev=全量 FC+SC+RC+T | **v1.0.0 修正** |
| **S01~S06 不受 ENV_MODE 影响** | 无论 dev/prod 均强制执行安全底线 | |
| **预检查（PC1~PC3）独立性** | 独立于 FC/SC，dev 模式同样强制；PC1 Token轮次 / PC2 待跟进 / PC3 未完成任务 | **v0.03 明确** |
| **强制可见输出** | dev 模式：FC4/FC5 状态块 / prod 模式：FC+SC 状态块（chat 豁免）| **v0.03 强制** |
| FC 形式合规（6 项）| FC1 记忆完整(📨 必须四列表格) / FC2 报告写入 / FC3 CP按序 / FC4 文件名合规 / FC5 产物路径已输出 / FC6 行数检查 | |
| SC 实质合规（13 项）| SC1~SC13（见 v0.03 完整表）| |
| RC 恢复性检查（4 项）| RC1~RC4（非阻塞；chat 豁免全部；**analyze 豁免 RC 层**）| **v0.03 analyze 豁免** |
| 报告二次验证（V1~V6）| V1 来源 / V2 验证列 / V3 真实性 / V4 推测标注 / **V5 反向质疑三问** / V6 分级比例 | |
| T 任务完成验证（T1~T9）| T1~T9（见 v0.03 完整表）| |
| 自修复触发 | FC/SC 不通过→立即修正重检（**累计≥5次未全通过→停止循环，输出摘要标⚠️**）/ 连续2次偏差→升级分析 | **v0.03 增加上限** |
| **全自动模式**差异 | FC/SC 失败时自动修正（不暂停等待用户），但 S01~S06 仍阻断 | **v1.0.0** |

---

### 2. `instructions/17-compliance.instructions.md`

**中文对应**：合规检查规范全局注入  
**v0.03 参考**：`v0.03/instructions/17-compliance.instructions.md`（70 行）  
**所属流程步骤**：全局约束

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `applyTo: "**"` 全局注入 | |
| **预检查（仅 dev 模式）** | 收到消息后、执行前输出 PC1~PC3 状态块 | **v0.03 明确** |
| **预检查状态块格式** | Token 轮次 / 待跟进事项 / 未完成任务 | v0.03 三行格式 |
| 执行时机 | 所有工作流节点执行完毕后、回复发送前（chat 豁免） | |
| FC/SC/RC/T 概述 | 引导调用 compliance Skill | |
| 不通过处理 | 修正后重检，直至通过（累计≥5次→输出摘要标⚠️→写入记忆→用户决策）| **v0.03 增加上限** |
| **执行顺序** | PC1~PC3(dev) → FC → SC → RC → V1~V6 → T1~T9 | **v0.03 明确顺序** |

---

### 3. `skills/report/SKILL.md`

**中文对应**：报告生成  
**v0.03 参考**：`v0.03/skills/report/SKILL.md`（90 行）  
**v4 参考**：`v4/specs/report.md`  
**所属流程步骤**：⑩ 输出报告

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: report` / `description: "Generate workflow report..."` | |
| **需求级路径（优先）** | `<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md` | v0.03 双层路径 |
| **项目级路径（兜底）** | `.devcodex/reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md` | |
| 子目录规则 | 当前：dev→requirements / dev(optimization)→optimizations / dev(scenario-test)→scenario-tests / fix→bugs / analyze→analysis / audit→audit / self-fix→self-fix | **已按当前规则收口** |
| 编号规则 | NN 当日序号，01 起递增（扫描同目录取 max+1），**双横杠**分隔（FC4 检查）| |
| 头部必填 | 项目 / 类型 / 子类型（无时省略）/ 日期 / Agent / 状态 | |
| **audit 额外头部** | 审查目标类型 / 审查范围 / 收敛状态 | **v0.03 明确** |
| **fix 额外内容** | CP 确认记录表 + 三步扫描结果 | **v0.03 明确** |
| 模板选择 | dev→report-dev / fix→report-fix / audit→report-audit / analyze→report-analysis | |
| 行数限制 | ≤ 500 行（C13）；超出拆分 | |
| 三项验证 | 每条问题/建议必须附合理性+可实施性+收益 | |
| chat 豁免 | chat 工作流不生成报告 | |
| **跨会话报告** | 同任务跨会话→独立报告文件 / 修复后再审→引用原始路径 / Token 恢复→标注"恢复自会话 NN" | **v0.03 三场景** |
| 写入后验证 | 必须执行 compliance §5 V1~V6 二次验证 | |
| **报告末尾** | 引用本次会话记忆路径 + 回复末尾输出产物路径双行格式 | **v0.03 明确** |

---

### 4. `instructions/16-report.instructions.md`

**中文对应**：报告规范全局注入  
**v0.03 参考**：`v0.03/instructions/16-report.instructions.md`（62 行）  
**所属流程步骤**：全局约束

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `applyTo: "**"` 全局注入 | |
| 适用范围 | 必须写入报告：dev/fix/analyze/audit/self-fix；豁免：chat | **v0.03 明确** |
| **双层路径规则** | 需求级优先 / 项目级兜底（唯一信源） | |
| 路径约定 | `.devcodex/reports/` 为报告根 | |
| 写入约束 | 自动写入(S05) / 增量编辑(S04) / 禁止仅在对话中输出(FC2) / 禁止覆盖已有报告 | |
| **命名规则** | `NN--<简述>.md`（双横杠，FC4 检查）/ `<简述>` 2~5 词连字符分隔 | **v0.03 明确** |
| 报告回读验证 | 写入后必须执行 V1~V6 二次验证 | |
| **头部必填项** | 项目/类型/子类型/日期/Agent/状态 六项（FC2 检查）| **v0.03 明确** |
| **产物路径输出** | 回复末尾双行（`file:///` + 纯文本路径），FC5 检查 | |

---

## 文件对照总表

| # | 英文目标文件 | 中文职责 | v0.03 参考 | 流程步骤 |
|:-:|------------|---------|-----------|---------|
| 1 | `skills/compliance/SKILL.md` | 三层合规检查 FC/SC/RC + T1~T9 + ENV_MODE | ✅ 有（147 行）| ⑨⑫ |
| 2 | `instructions/17-compliance.instructions.md` | 合规检查全局注入 + 预检查 | ✅ 有（70 行）| 全局约束 |
| 3 | `skills/report/SKILL.md` | 报告生成（双层路径）| ✅ 有（90 行）| ⑩ |
| 4 | `instructions/16-report.instructions.md` | 报告规范全局注入 | ✅ 有（62 行）| 全局约束 |

---

## Stage 6 完成后的整体效果

Stage 0~6 全部完成后，以下文件将存在于 v1.0.0 根目录：

```
agents/
  devcodex.agent.md          ← Stage 1 创建，Stage 2/4 补全
  devcodex-auto.agent.md     ← Stage 1 创建
skills/
  intent/SKILL.md            ← Stage 1
  load-profile/SKILL.md      ← Stage 1
  summary/SKILL.md           ← Stage 3
  memory/SKILL.md            ← Stage 3
  routing/SKILL.md           ← Stage 4
  cp-gate/SKILL.md           ← Stage 5
  plan/SKILL.md              ← Stage 5
  dev-default/SKILL.md       ← Stage 5
  fix-default/SKILL.md       ← Stage 5
  compliance/SKILL.md        ← Stage 6
  report/SKILL.md            ← Stage 6
instructions/
  00-safety.instructions.md  ← Stage 1
  01-common.instructions.md  ← Stage 1
  02-output-paths.instructions.md ← Stage 1
  10-dev.instructions.md     ← Stage 5
  11-fix.instructions.md     ← Stage 5
  12-audit.instructions.md   ← Stage 5
  13-analyze.instructions.md ← Stage 5
  14-self-fix.instructions.md ← Stage 5
  15-memory.instructions.md  ← Stage 3
  16-report.instructions.md  ← Stage 6
  17-compliance.instructions.md ← Stage 6
data/
  violations.md              ← Stage 2
  pending-fixes.md           ← Stage 2
  gap-registry.md            ← Stage 2
```

**共计**：2 Agent + 11 Skills + 11 Instructions + 3 data = **27 个文件**

### ⚠️ 缺口：23 个子类型 Skill 文件

Agent 引用的 34 个 Skills 中，Stage 0~6 仅覆盖 **11 个**。剩余 **23 个** 子类型/辅助 Skills + **20 个** prompts 模板需要在 **[Stage 7](stage-7.md)** 中补全。

加上 Stage 7 后总文件数：2 + 34 + 11 + 3 + 20 = **70 个文件**。

