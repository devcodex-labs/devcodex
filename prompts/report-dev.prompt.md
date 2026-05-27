---
agent: agent
description: 开发工作流报告模板，用于 dev 工作流执行完成后输出标准报告
applyTo: .devcodex/**/reports/requirements/**
---
# 开发报告模板

> **路径**: 优先 `.devcodex/**/requirements/<需求>/reports/<agent>/YYYYMMDD/NN--<name>.md`；无任务上下文时回退到 `.devcodex/**/reports/requirements/<agent>/YYYYMMDD/NN--<name>.md`
> **触发**: dev 工作流完成后，由 `report/SKILL.md` 驱动生成
> **字段约束**: 每条遗留问题/建议必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围），详见 [`17-compliance.instructions.md`](../instructions/17-compliance.instructions.md) §1 输出验证

---

```markdown
# [功能名称] 开发报告

> **项目**: <project>
> **类型**: dev
> **子类型**: default / refactor / database / init / optimization / scenario-test / docs / plan-review
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: <agent-id>
> **状态**: 进行中 / 已完成
> **关联需求**: [路径]
> **关联方案**: [路径]
> **Release 状态**: 未进入 / 待用户确认 / 已执行
> **日志落点**: `changelogs/unreleased.md` / `CHANGELOG.md + changelogs/vX.Y.Z.md`
```

## §1 执行摘要

> 一段话描述本次开发的核心内容和结果。

## §2 完成内容

| 任务 | 文件变更 | 说明 |
|------|---------|------|
| T-01 | | |

## §3 文件变更清单

```
新增：
  src/xxx.ts

修改：
  src/yyy.ts (变更说明)

删除：
  (无)
```

## §4 接口变更

> 无接口变更时填"无"。

| 接口 | 变更类型 | 说明 |
|------|---------|------|

## §5 Breaking Changes

> 无 BC 时填"无"。

## §6 测试验证

| 类型 | 结果 | 覆盖率 |
|------|:----:|:------:|
| 静态/类型检查 | ✅ 通过 / N/A | — |
| 单元测试 | ✅ 通过 | X% |
| api-verification | ✅ 通过 / N/A | — |

## §7 后置处理

- [ ] api-verification：✅ 通过 / N/A
- [ ] impact-review：✅ 完成 / N/A
- [ ] document-sync：✅ 完成
- [ ] release-status：未进入 / 待用户确认 / 已执行

## §7.5 ECR 执行闭环复审

| ECR 项 | 检查对象 | 结果 | 证据 |
|--------|----------|:----:|------|
| ECR-1 | CP1/CP2/CP3、报告、daily tasks、SUMMARY | ✅/⚠️ | |
| ECR-2 | 需求条款 / 问题 ID → diff/commit 文件 | ✅/⚠️ | |
| ECR-3 | CP3 步骤 → 测试/部署/验证证据 | ✅/⚠️ | |
| ECR-4 | 报告声明 → 测试/探针/官方文档 | ✅/⚠️ | |
| ECR-5 | memory daily → SUMMARY | ✅/⚠️ | |
| ECR-6 | git dirty 边界 | ✅/⚠️ | |
| ECR-7 | 控制面任务 validate / direct replay / host-contract probe | ✅/N/A | |

## §8 遗留问题

| 问题/建议 | 优先级 | 合理性 | 可实施性 | 收益 | 验证状态 | 影响范围 | 后续处理 |
|-----------|:------:|--------|----------|------|----------|----------|----------|
| | | | | | ✅已验证 / ⚠️待验证 | | |
