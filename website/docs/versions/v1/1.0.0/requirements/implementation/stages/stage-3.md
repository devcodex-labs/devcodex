# Stage 3 — ③ 写入摘要 + ④ 检索记忆

> **主流程节点**：③ 写入摘要 · ④ 检索记忆  
> **对应流程图**：[写入摘要流程图](/specs/summary-flow) · [检索记忆流程图](/specs/memory-retrieval-flow)  
> **状态**：✅ 已完成（2026-04-08）

---

## 流程回顾

```
③ 写入摘要：
  接收安全检查结果 → 提取核心信息 → 标准化表达 → 生成摘要 → 自检 → 输出

④ 检索记忆：
  接收摘要 → 按意图判定深度（轻量/深度）→ 检索 → 命中/未命中
  → 命中 → 合并上下文 → 是否有冲突/未完成任务 → 标记 resume 提示
  → 未命中 → 记录状态 → 继续
```

### 路径差异说明（v1 vs v4）

| 项目 | v4（ai-dev-guidelines）| v1.0.0（devcodex）|
|------|----------------------|-------------------|
| 记忆根 | `projects/<project>/.ai-memory/` | `<项目根>/.devcodex/.memory/` |
| 需求级记忆 | `<需求>/.ai-memory/sessions.md` | `<需求>/.memory/sessions.md` |
| Agent SUMMARY | `.ai-memory/clients/<agent>/SUMMARY.md` | `.memory/clients/<agent>/SUMMARY.md` |

> v1 沿用 v0.03 的 `.devcodex/` 统一根路径，v4 使用独立 `.ai-memory/`。两者**内部结构一致**。

---

## 待产出文件清单（3 个）

### 1. `skills/summary/SKILL.md`（中文重写）

**中文对应**：会话摘要写入  
**v0.03 参考**：`v0.03/skills/summary/SKILL.md`（48 行）  
**v4 参考**：`v4/specs/summary.md`  
**所属流程步骤**：③ 写入摘要

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: summary` / `description: "Write session summary..."` | |
| 写入流程 | 确定日期 → 定位文件 → 判断文件状态 → 确定会话编号 → 写入初始段落 → 后续追加 | |
| 会话编号规则 | 从 01 起递增，两位数，按文件内容确定 | |
| 格式选择 | chat/简单analyze→紧凑 / dev/fix(≥3文件)→完整 / 可升级 | v0.03 五档规则 |
| 必填字段 | 🎯 任务摘要 / 📨 对话记录 | |
| 按需字段 | 📄 关联报告 / 💡 关键决策 / ⚠️ 待跟进 / 📦 编码检查点 | |
| **📨 格式** | 四列表格：`轮次 \| 👤 用户消息 \| 🤖 AI执行 \| 状态` | **v0.03 FC1 检查** |
| Token 防护配合 | C08 各阶段（10轮关注/13轮预警/15轮防护/≥15轮+≥5文件硬性暂停）写入要求 | |
| 约束 | 自动写入(C05/S05) / 增量编辑(C06/S04) / 禁止 Set-Content(C09) | |
| 模板引用 | `prompts/memory-session.prompt.md` | |

---

### 2. `skills/memory/SKILL.md`（中文重写）

**中文对应**：记忆读写  
**v0.03 参考**：`v0.03/skills/memory/SKILL.md`（133 行）  
**v4 参考**：`v4/specs/memory.md`（154 行）  
**所属流程步骤**：④ 检索记忆 + ⑪ 更新记忆

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `name: memory` / `description: "Read and write session memory..."` | |
| 文件路径 | `.devcodex/.memory/clients/<agent>/tasks/YYYYMMDD.md` | v1.0.0 路径 |
| `<agent>` 命名 | 产品标识优先（copilot / claude / cursor），跨编辑器用 `<editor>-<product>`，兜底 unknown-agent | |
| 扫描方式 | ⛔ 禁止 glob/find，必须 list_dir 逐层进入 | |
| 读取策略（日期策略）| 正常→今日+昨日（并发读取） / resume→最近14天 / 不存在→仅昨日 / 解析失败→重命名.bak.md | v0.03 + v4 |
| **三层记忆架构** | ① Agent 日记（每会话必写）/ ② 需求级记忆（路由确定后追加）/ ③ 项目总记忆(SUMMARY.md，有关键决策时) | |
| Agent SUMMARY | `.devcodex/.memory/clients/<agent>/SUMMARY.md`，每会话追加一行索引（SC6 检查）| |
| **Agent SUMMARY 格式** | 七列表格：`日期 \| 会话 \| 类型 \| 摘要 \| 关联报告 \| 关联记忆 \| 状态` | **v0.03 详细定义** |
| 全局 SUMMARY | `.devcodex/.memory/SUMMARY.md`，仅关键决策（SC7 检查）| |
| 需求级记忆 | `<需求目录>/.memory/sessions.md`，按会话追加 | |
| **需求级路径构建** | `requirements/<描述>/.memory/sessions.md` / `bugs/<描述>/` / `optimizations/<描述>/` | |
| 触发时机表 | 首条消息/用户发消息/子任务完成/13轮预警/报告写入后/完成回复/结束前/任务结束 | v0.03 七时机 |
| 写入约束 | 自动写入(C05/S05) / 增量追加(C06/S04) / 禁止终端命令(C09) / 禁止 glob 扫描 | |
| 模板引用 | `prompts/memory-session.prompt.md` / `prompts/agent-summary.prompt.md` / `prompts/requirement-session.prompt.md` | |

---

### 3. `instructions/15-memory.instructions.md`（中文重写）

**中文对应**：记忆规范全局注入  
**v0.03 参考**：`v0.03/instructions/15-memory.instructions.md`（40 行）  
**所属流程步骤**：全局约束（记忆相关）

| 内容项 | 中文说明 | 备注 |
|--------|---------|------|
| frontmatter | `applyTo: "**"` 全局注入 | |
| 路径约定 | `.devcodex/.memory/` 为记忆根目录 | v1.0.0 路径 |
| **新会话 🔄 检测** | 新会话开始时检查今日/昨日记忆中是否有 🔄 状态任务 → 输出提示 | **v1.0.0 新增** |
| resume 触发联动 | 检测到 🔄 + 用户说"继续" → intent 判定为 resume | |
| 触发时机表 | 与 memory Skill 的触发时机一致（何时写），但本文件定义的是"规则"而非"能力" | |
| 写入约束 | 自动写入(C05) / 增量编辑(C06) / 禁止终端命令(C09) / 禁止 glob 扫描 | |
| chat 豁免说明 | chat 工作流豁免**报告**，但**记忆仍须写入**（不豁免 memory）| v0.03 明确 |
| `<agent>` 路径构建规则 | 单编辑器 / 跨编辑器 / 兜底 unknown-agent（含后续迁移规则）| |

---

## 文件对照总表

| # | 英文目标文件 | 中文职责 | v0.03 参考 | 流程步骤 |
|:-:|------------|---------|-----------|---------|
| 1 | `skills/summary/SKILL.md` | 会话摘要写入 | ✅ 有（48 行）| ③ 写入摘要 |
| 2 | `skills/memory/SKILL.md` | 记忆读写（三层架构）| ✅ 有（133 行）| ④ 检索记忆 + ⑪ 更新记忆 |
| 3 | `instructions/15-memory.instructions.md` | 记忆规范全局注入 | ✅ 有（40 行）| 全局约束 |

