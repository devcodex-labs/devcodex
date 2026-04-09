---
mode: agent
description: 修复工作流报告模板，用于 fix 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/bugs/**
---
# 修复报告模板

> **路径**: `reports/bugs/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: fix 工作流完成后，由 `report/SKILL.md` 驱动生成

---

```markdown
# [问题名称] 修复报告

> **日期**: YYYY-MM-DD HH:MM
> **项目**: <project>
> **子类型**: default / incident / security
> **严重级别**: P0 / P1 / P2 / P3
> **状态**: 已修复 / 验证中 / 待验证
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

## §3 回归验证

| 测试用例 | 结果 |
|---------|:----:|
| 原始重现步骤 | ✅ 已修复 |
| 关联功能回归 | ✅ 正常 |
| api-verification | ✅ 通过 / N/A |

## §4 时间线（incident 类型必填）

| 时间 | 事件 |
|------|------|
| HH:MM | 事故发生 |
| HH:MM | 发现/告警 |
| HH:MM | 止血完成 |
| HH:MM | 根因确认 |
| HH:MM | 修复上线 |

## §5 改进 Action Items（incident 必填）

| 改进点 | 优先级 | 负责人 | 截止时间 |
|--------|:------:|--------|---------|

## §6 后置处理

- [ ] document-sync：✅ 完成
- [ ] CHANGELOG 已更新
