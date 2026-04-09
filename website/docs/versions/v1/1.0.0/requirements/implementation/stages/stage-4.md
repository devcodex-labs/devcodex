# Stage 4 — ⑤ 前置状态汇总 + ⑥ 开发阶段合规 + ⑦ 路由

> **主流程节点**：⑤ 前置状态汇总 · ⑥ 开发阶段合规检查 · ⑦ 路由到工作流  
> **对应流程图**：[前置状态汇总](/specs/pre-state-summary-flow) · [开发阶段合规检查](/specs/dev-compliance-flow) · [主流程图](/specs/flowcharts)  
> **状态**：✅ 已完成（2026-04-08）

---

## 流程回顾

```
⑤ 前置状态汇总：
  收集前置节点结果 → 标准化为统一状态视图 → 信息足够? → 补齐/标注不确定项

⑥ 开发阶段合规检查（预检查状态输出）：
  意图是否成立 → profile 是否完整 → 产物落点是否明确 → 执行前约束是否齐备
  → 记忆冲突检测 → 具备条件? → 是→路由 / 否→补齐或回退 chat

  v4 对应节点：PRECHECK_OUTPUT（N16）— 检测输出语言并输出预检查状态摘要
  v0.03 对应：compliance §预检查（PC1~PC3）— 仅 dev 模式

⑦ 路由：
  chat → 轻路径（豁免报告，仅记忆）
  resume → 恢复路径（结合历史上下文继续）
  其他 → 标准执行链
```

### ENV_MODE 对预检查的影响

| ENV_MODE | 预检查行为 |
|----------|----------|
| `dev` | 输出预检查状态块（PC1~PC3）；合规检查仅 FC4/FC5 |
| `prod`（默认）| 不输出预检查状态块；合规检查执行全量 FC+SC+RC+T |

> v0.03 `compliance` Skill §0 和 `17-compliance.instructions.md` 均定义此规则。

---

## 待产出文件清单（2 个）

### 1. Agent 前置状态汇总 + 预检查输出段（内联补全）

**中文对应**：Agent 文件内的前置汇总与开发闸门  
**目标文件**：`agents/devcodex.agent.md`（Stage 1 已创建）中追加 ⑤⑥ 段  
**v4 参考**：`v4/specs/common.md` §2（N16 PRECHECK_OUTPUT）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| ⑤ 汇总 | 汇总 ①~④ 输出：规则基线 / 意图 / profile 状态 / 记忆状态 / 产物落点 | |
| ⑥ 检查清单 | 意图成立? / profile 完整? / 落点明确? / 约束齐备? / 记忆冲突? / 变更边界清晰? | 6 项检查 |
| **输出语言检测** | 在 ⑥ 中根据用户消息检测输出语言（中/英/混合），声明后整个会话遵循 | **v4 N16 步骤⑥** |
| **预检查状态块** | dev 模式下输出 PC1(Token轮次)/PC2(待跟进)/PC3(未完成任务) | **v0.03 compliance §预检查** |
| 通过 | 进入 ⑦ 路由 | |
| 不通过 | 尝试补齐 → 仍不够 → 回退 chat 或终止 | |

---

### 2. `skills/routing/SKILL.md`（中文重写）

**中文对应**：工作流路由分发  
**v0.03 参考**：`v0.03/skills/routing/SKILL.md`（48 行）  
**v4 参考**：`v4/specs/routing.md`（131 行）  
**所属流程步骤**：⑦ 路由到工作流

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: routing` / `description: "Route to workflow..."` | |
| **参考文档声明** | 本 Skill 为**人类可读参考**，路由映射逻辑已内联在 Agent 文件中 | **v4 routing.md 声明** |
| 路由表 | intent → workflow 映射（dev/fix/analyze/audit/self-fix/resume/other/chat） | 8 种意图 |
| 授权门控 | 路由确定后调用 token-check 验证层级 | Free 访问 Pro → 提示升级 |
| chat 快速路径 | 三问全指向分析 + 无文件变更 → 跳过 CP 和报告 → CHAT_EXEC→CHAT_MEM→CLOSE | |
| resume 路径 | RESTORE → 读取记忆 → 还原上下文 → 提取原始意图 → 重路由 | |
| **resume 约束** | chat 不产生中断（原始意图为 chat → 重走 N04）；resume 不改变原始意图类型 | **v4 明确** |
| **违规质疑路由** | 用户质疑规范违反 → 强制路由到 audit → 先执行 compliance | **v0.03 特殊规则** |
| dev 子类型路由 | default / refactor / database / init / optimization / scenario-test / docs / plan-review | 8 种 |
| fix 子类型路由 | default / incident / security | 3 种 |
| audit 目标类型路由 | 规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档 | 6 种 |
| analyze 子类型 | default / research | 2 种 |
| **子类型路由文件对照** | 完整列出 intent → sub-type → Skill 文件映射表（与 v0.03 routing SKILL.md 一致）| 含 Skill 路径 |
| **多意图处理** | ≥2 意图→按序逐一路由，每个独立走完整工作流周期→独立报告→再路由下一个 | **v4 routing.md** |
| **工作流内部强制步骤** | dev: plan-review（CP2 后、CP3 前强制）；不参与子类型路由 | **v4 明确区分** |

---

## 文件对照总表

| # | 英文目标文件 | 中文职责 | v0.03 参考 | 流程步骤 |
|:-:|------------|---------|-----------|---------|
| 1 | `agents/devcodex.agent.md`（追加段落）| 前置汇总 + 预检查输出 + 开发闸门 | 部分有 | ⑤⑥ |
| 2 | `skills/routing/SKILL.md` | 工作流路由分发（参考文档）| ✅ 有（48 行）| ⑦ 路由 |

