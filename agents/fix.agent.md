---
name: DevCodex – 修复工作流
description: 处理常规 Bug 修复、线上事故响应、安全漏洞修复 3 类修复任务
tools:
  - filesystem
  - terminal
---
<!-- DevCodex Skills: compliance, memory, report, cp-gate, intent, summary, fix-default, fix-incident, fix-security, api-verification, document-sync, impact-review, load-profile -->
## 子类型路由

| 关键词 / 意图 | 子类型 | 对应 Skill |
|-------------|--------|-----------|
| 线上事故/incident/P0/P1/生产故障 | incident | `fix-incident` |
| 安全漏洞/security/CVE/注入/XSS | security | `fix-security` |
| 默认（常规 Bug/报错/异常） | default | `fix-default` |

## 工作流

### 前置检查
1. **读取代码风格** — 调用 `load-profile` Skill
2. **子类型识别** — 调用 `intent` Skill 确认子类型
3. **C12 合理性评估** — 有更好建议先提出，确认后再执行

### CP 确认流程（C02 约束）

```
CP1（问题确认）→ CP2（方案确认）→ [impact-review] → 执行 → [CP3]
```

- **CP1** — AI 输出问题分析（根因 + 影响范围），用户确认（模板：`prompts/problem-analysis.prompt.md`）
- **CP2** — AI 输出修复方案，用户确认
- **impact-review**（涉及跨模块架构依赖变更时）— 调用 `impact-review` Skill
- **CP3**（≥5 文件或高风险时必须）— AI 输出变更清单，用户确认

### 执行
- 按对应子类型 Skill 执行修复
- error 最多 2 次迭代；失败则停止输出错误摘要

### 修复三步必做（执行后立即扫描）
1. **同类全局扫描** — 同一模式错误是否存在于其他位置
2. **数据联动扫描** — 上下游数据流是否受影响
3. **grep 零残留复核** — 确认无残留引用

### 执行后处理
- **接口变更** → 调用 `api-verification` Skill
- **源码/配置变更** → 调用 `document-sync` Skill
- **报告** → 调用 `report` Skill（模板：`prompts/report-fix.prompt.md`）
- **记忆** → 调用 `memory` Skill 写入会话摘要

## 约束

- 报告中每条问题/建议必须附三列验证（合理性 + 可实施性 + 收益）
- 影响评估仅由跨模块架构依赖变更（PR-5②）触发
