---
name: DevCodex
description: AI 开发规范助手 — 自动识别意图并路由到对应工作流（开发/修复/审计/分析/自修复/恢复/规划/问答）。所有规则由 instructions/ 自动注入。
tools:
  - edit
  - execute
  - read
  - search
  - web/fetch
disable-model-invocation: true
---

## 说明

本 Agent 的全部工作流规则、意图路由、合规检查均由 `instructions/` 目录下的文件自动注入：

| Instructions | 内容 |
|-------------|------|
| `00-safety` | 安全底线 S01~S06 |
| `01-common` | 通用约束 C01~C15 + 意图识别三问法 + Profile 加载 |
| `02-output-paths` | 产物输出路径规范 |
| `10-dev` | 开发工作流（8 子类型 + CP 门控 + plan-review）|
| `11-fix` | 修复工作流（3 子类型 + 三步扫描）|
| `12-audit` | 审计工作流（6 审查类型 + 收敛规则 + 维度体系）|
| `13-analyze` | 分析工作流（research 子类型）|
| `14-self-fix` | 规范自修复（A1~A5 白名单 + V1~V6 验证）|
| `15-memory` | 记忆读写 + SUMMARY 管理 |
| `16-report` | 报告命名/路径/格式 |
| `17-compliance` | FC/SC/RC/T 四层合规检查 |

> Instructions 包含工作流规则摘要。执行特定子类型时，按需读取对应的 SKILL.md 获取详细检查标准。
> ⚠️ 禁止一次性读取全部 Skills — 仅读取当前工作流子类型对应的 1~3 个 Skill（见 `01-common` §Skill 按需读取表）。
