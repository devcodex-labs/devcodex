---
agent: agent
description: 修复工作流报告模板，用于 fix 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/bugs/**
---
# 修复报告模板

> **路径**: 优先 `.devcodex/bugs/<问题>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/reports/bugs/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: fix 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [问题名称] 修复报告

> **项目**: <project>
> **类型**: fix
> **子类型**: default / incident / security
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **严重级别**: P0 / P1 / P2 / P3
> **状态**: 进行中 / 已完成
> **事件级别**: P0 / P1 / P2（incident 类型必填）
> **事件时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **响应时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
> **修复时间**: YYYY-MM-DD HH:MM:SS（incident 类型必填）
```

## §1 问题摘要

**现象**：  
**根因**：  
**影响范围**：

## §2 修复方案

**方案描述**：  
**变更文件**：

```
修改：
  src/xxx.ts (修复内容)
```

## §3 CP 确认记录

| CP | 状态 | 用户响应 | 时间 |
|:--:|:----:|---------|------|
| CP1 | ✅ / N/A | 确认问题分析 | HH:MM |
| CP2 | ✅ / N/A | 确认修复方案 | HH:MM |
| CP3 | ✅ / N/A | 确认实施计划 | HH:MM |

## §4 修复三步扫描

| 扫描项 | 结果 | 证据 |
|--------|:----:|------|
| 同类全局扫描 | ✅ / ⚠️ | |
| 数据联动扫描 | ✅ / ⚠️ | |
| grep 零残留复核 | ✅ / ⚠️ | |

## §5 回归验证

| 测试用例 | 结果 |
|---------|:----:|
| 原始重现步骤 | ✅ 已修复 |
| 关联功能回归 | ✅ 正常 |
| api-verification | ✅ 通过 / N/A |

## §6 时间线（incident 类型必填，秒级精度供响应时效审计）

| 时间 | 事件 |
|------|------|
| YYYY-MM-DD HH:MM:SS | 事故发生 |
| YYYY-MM-DD HH:MM:SS | 发现/告警 |
| YYYY-MM-DD HH:MM:SS | 止血完成 |
| YYYY-MM-DD HH:MM:SS | 根因确认 |
| YYYY-MM-DD HH:MM:SS | 修复上线 |

> ⚠️ **incident 必须秒级**：P0 要求 15 分钟内初步方案，秒级时间是后续 SLA 审计依据；P1/P2 可降级为分钟级 `YYYY-MM-DD HH:MM`。

## §7 问题/建议验证

| 问题/建议 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 |
|-----------|--------|----------|------|----------|----------|
| | | | | ✅已验证 / ⚠️待验证 | |

## §8 改进 Action Items（incident 必填）

| 改进点 | 优先级 | 负责人 | 截止时间 |
|--------|:------:|--------|---------|

## §9 后置处理

- [ ] document-sync：✅ 完成
- [ ] CHANGELOG 已更新
