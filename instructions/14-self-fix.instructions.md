---
applyTo: "**"
priority: 3
workflowAgent: self-fix
version: "1.0.0"
source: "v4:specs/self-fix/README.md + specs/self-fix/*.md"
---

# 规范自修复规则（14-self-fix）

> 本 Instructions 与 `agents/self-fix.agent.md` 关联，在 self-fix 工作流激活时由平台自动注入。

## 核心约束

### 修复范围边界（严格）

| 工具 | 修复对象 |
|------|---------|
| self-fix（本工作流）| `version/v5/` 下的规范文件（agents/skills/instructions/prompts/RULES.md）|
| dev | 源码/配置文件变更 |
| fix | 源码 Bug 修复 |

> 功能性迭代（新增节点、重写架构）→ 路由到 `@dev`，不是 self-fix

### 修复文件数量限制
- 单次最多修复 **5 个文件**
- 超出 → 建议拆分为多个会话

### 修复分级（必须分级后执行）

| 级别 | 条件 | 处理方式 |
|------|------|---------|
| 自动级（A1~A5 白名单）| 错别字修正/断链修复/表格缺行补充等 | AI 直接修复，无需用户确认 |
| Pending 级（非白名单）| 规范表述/流程/体系变更；新增检查项；修改约束等级 | 记录到 `data/pending-fixes.md`，不在当前会话修改 |

### 自动级修复后验证（三项必须全通过）
1. 目标文件已包含修复内容
2. 关联文件交叉引用已同步（C11）
3. 工具扫描零残留

### 违规记录（T_RECORD 分支）
- 典型表述："记录这次违规"/"登记一下刚才的问题"
- 直接追加到 `data/violations.md`（格式：VL-NNN 行）
- 不走 SCOPE→CLASSIFY→AUTO/PENDING 流程

### 违规登记状态规则
- 临时处置（补录/口头承诺/局部修补）→ 状态 `🔄 处理中`
- 必须三项同时满足才可标 `✅ 已关闭`：
  1. 问题处置完成
  2. 防复发措施写入对应规范
  3. 后续流程验证生效（或用户明确确认）

### 不进入 self-fix 的场景（防递归）
- N13 合规检查失败 → 在当前工作流内联修正后重检（**不进 self-fix**）
- 连续 2 次同类偏差 → `compliance` Skill §7 升级分析处理（**不进 self-fix**）
