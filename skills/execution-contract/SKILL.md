---
name: execution-contract
description: 执行契约规范 — 为长流程、多文件、Auto 或控制面任务生成/校验 ExecutionContract，约束范围、路径、产物、验证路线、偏离分级与恢复策略
---
# Execution Contract Skill

## 职责

在任务进入执行前，为需要强边界的工作生成或校验 ExecutionContract。它不是新的工作流子类型，而是 dev/fix/auto/release 等流程可调用的支撑型 Skill。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| Auto 执行模式 | 🔴 必须 |
| 控制面 / 规范源 / 模板 / validate / 部署副本变更 | 🔴 必须 |
| 预计修改 ≥10 文件或多批次执行 | 🔴 必须 |
| 涉及发布、tag、publish、registry 后验收 | 🔴 必须 |
| 普通单文件文档小修 | N/A |

## Contract 字段

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `scope` | ✅ | 本次任务目标、排除范围和禁止事项 |
| `allowedPaths` | ✅ | 允许修改的路径集合；Auto 不得仅依赖静态白名单 |
| `requiredArtifacts` | ✅ | 必须产出的需求、方案、计划、进度、报告、测试、changelog 等 |
| `validationRoute` | ✅ | 引用 `test-router`、`release-verification` 或当前 CP3 验证矩阵 |
| `deviationPolicy` | ✅ | 绿色/黄色/红色偏离分级与处理方式 |
| `rollbackPlan` | ✅ | 失败恢复路径、回滚锚点或重新确认条件 |
| `progressArtifact` | 条件 | 多批次、预计 ≥10 文件、跨轮次或用户要求持续跟踪时必须写 `05-实施进度.md` |

## 偏离分级

| 级别 | 判定 | 处理 |
|------|------|------|
| 🟢 绿色 | 不改变目标、范围、接口、路径边界的局部实现微调 | 记录原因后继续 |
| 🟡 黄色 | 新增联动文件或验证动作，但不改变需求范围 | 更新计划/进度/报告后继续 |
| 🔴 红色 | 新增依赖、改 Hook runtime 权限模型、改 CLI 语义、改发布动作或扩大需求边界 | 停止执行，回 CP2 或 CP1 |

## Auto 消费规则

- Auto 仍是 Agent/Hook 执行模式，不是普通 Skill。
- `execution-contract` 只提供可复审契约，不豁免 S01~S07、C01、C10、C18。
- Auto 修改路径必须同时满足静态白名单和当前 Contract 的 `allowedPaths`。
- Contract 缺少 `allowedPaths`、`requiredArtifacts` 或 `validationRoute` 时，不得进入无人值守执行。

## 输出格式

```markdown
## ExecutionContract

| 字段 | 内容 |
|------|------|
| scope | |
| allowedPaths | |
| requiredArtifacts | |
| validationRoute | |
| deviationPolicy | |
| rollbackPlan | |
| progressArtifact | |
```

## 验证

- 执行前：CP2/CP3 或修复方案中存在 Contract 字段。
- 执行中：每个 Batch 对照 `allowedPaths` 和 `requiredArtifacts`。
- 执行后：ECR-2/ECR-3/ECR-7 引用 Contract 与验证证据。
