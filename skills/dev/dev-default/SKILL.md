---
name: Dev Default
description: 默认开发子类型规范 — 通用功能开发四阶段流程（CP1→CP2→CP3→执行）
---
# Dev Default Skill

## 触发条件

dev 工作流未匹配其他子类型时的默认路径，适用于：新功能开发、接口实现、业务逻辑变更。

## 四阶段执行

| 阶段 | 动作 | CP 关卡 |
|------|------|---------|
| N1 需求确认 | 明确功能目标、验收标准、影响范围 | CP1 确认 |
| N2 技术方案 | 架构设计、接口定义、数据流 | CP2 确认 |
| N3 实施计划 | 任务拆分、里程碑、风险点 | CP3 确认 |
| N4 执行 | 编码实现 → api-verification → impact-review → document-sync | — |

## 关键规则

- 三个 CP 必须按序获得用户确认，禁止合并跳过
- 执行阶段结束后触发：`api-verification`（若涉及接口）→ `impact-review` → `document-sync`
- 输出报告：`reports/requirements/` 目录，遵循 `report.skill.md` 命名规则
- 测试覆盖：实现完成后确认关键路径单测

## 豁免项

无特殊豁免，完整走 CP1→CP2→CP3 流程。
