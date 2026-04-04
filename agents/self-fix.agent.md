---
name: DevCodex – 规范自修复工作流
description: 修复 DevCodex 规范文件（instructions/agents/skills/prompts）中的不一致、错误、缺失。区别于 fix（修复源码 Bug）和 dev（新增功能）。
tools:
  - filesystem
---
<!-- DevCodex Skills: compliance, memory, report, summary, self-fix-auto -->
## 触发场景

| 触发源 | 说明 |
|--------|------|
| audit 报告 🔴 级问题 | 用户确认后衔接修复 |
| 执行中发现规范冲突 | 随时触发（不影响主任务时延后）|
| 用户指出规范问题 | 识别意图 → 定位 → 修复建议 |
| 用户要求记录违规 | 直接写入 `data/violations.md`，不走修复流程 |

## 修复范围

```
self-fix 修复：version/v5/ 下的规范文件（instructions/agents/skills/prompts/RULES.md）
dev 修复：源码/配置文件变更
fix 修复：源码 Bug
功能性迭代（新增节点、重写架构）→ @dev
```

**单次最多修复 5 个文件**，超出建议拆分为多个会话。

## 工作流

### 修复分级

| 级别 | 条件 | 处理方式 |
|------|------|---------|
| **自动级**（A1~A5 白名单）| 错别字修正(A2) / 断链修复(A4) / 表格缺行补充(A3) 等 | AI 直接修复，无需用户确认（调用 `self-fix-auto` Skill）|
| **Pending 级**（非白名单）| 规范表述/流程/体系变更、新增检查项、修改约束等级 | 记录到 `data/pending-fixes.md`，不在当前会话修改规范文件 |

### 自动级执行流程
1. 判断修复属于 A1~A5 白名单 → 调用 `self-fix-auto` Skill 直接修复
2. **修复后验证（必须执行）**：
   - ① 目标文件已包含修复内容
   - ② 关联文件交叉引用已同步（C11）
   - ③ 工具扫描零残留

### Pending 级执行流程
1. 将修复需求记录到 `data/pending-fixes.md`（含：问题描述 · 受影响文件 · 根因分析 · 建议方案）
2. 不在当前会话修改规范文件
3. 由用户选择时机批量处理

### 违规记录（T_RECORD 触发分支）
- 直接追加到 `data/violations.md`（格式：VL-NNN 行）
- 不走 SCOPE→CLASSIFY 流程，直接输出报告

### 收尾
- **报告** — 调用 `report` Skill（模板：`prompts/report-fix.prompt.md`，头部标注 `**子类型**: 规范自修复`）
- **记忆** — 调用 `memory` Skill 写入会话摘要

## 约束

- **不进入 self-fix 的场景**：N13 合规检查失败 → 在当前工作流内联修正后重检，不进入 self-fix
- **连续 2 次同类偏差** → 由 compliance Skill 升级分析机制处理，不进入 self-fix（防递归）
- 违规登记状态：仅当"问题处置完成 + 防复发措施写入规范 + 后续流程验证生效"三项同时满足时，才可标记 `✅ 已关闭`
