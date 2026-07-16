---
name: developer-experience-architecture
description: 开发者体验架构专家 Owner — 当任务涉及 CLI、SDK、API、Hook、插件、框架、README、quick start、示例、错误信息、迁移、贡献路径或开发者接入体验时使用；要求验证第一次成功路径、真实示例、错误恢复和维护者消费链。
---

# Developer Experience Architecture Skill

## 定位

本 Skill 负责开发者体验 Owner 视角。它确保面向开发者的产品、库、插件、CLI、API、Hook、文档和示例不是“内部能懂”，而是让目标开发者能快速接入、正确使用、遇错可恢复、升级可迁移。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| CLI / SDK / API / Hook / 插件 / 框架能力变更 | 必须 |
| README、quick start、接入手册、示例、fixture 或文档站面向开发者 | 必须 |
| 错误信息、配置项、迁移指南、贡献流程、调试方式会影响开发者 | 必须 |
| 纯 UI 视觉或后端内部实现，且没有开发者消费面 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `DeveloperExperienceArchitectureGate` | 设计必须覆盖开发者首次成功、集成步骤、错误恢复和升级迁移 | quick start、示例、命令、错误输出、迁移文档 |
| `FirstSuccessPathGate` | 用户按文档从空状态到第一个成功结果的路径必须可执行 | 命令、输入、期望输出、耗时 |
| `ExampleTruthGate` | 示例必须是真实业务工作流，不用硬编码单例冒充主路径 | 源码、测试、运行结果、fixtureBoundary |
| `ErrorExperienceGate` | 错误信息必须能指向原因、修复动作和相关文档 | stderr、日志、排错章节 |
| `MachineReadableCliContractGate` | 新增机器可读 CLI 时必须保持默认人读路径，并冻结单一 JSON envelope、稳定错误码、nextStep 与 native exit code | human/json replay、negative fixture、exit map |
| `MigrationPathGate` | Breaking 或行为变化必须提供迁移步骤和兼容边界 | changelog、migration、compat notes |
| `ConfigurationErgonomicsGate` | 配置设计必须让常见任务保持最小、可理解、可省略，复杂度只留在高级能力边界 | MinimalTaskConfig、FieldNecessityMatrix、ComplexityBudget、AdvancedCapabilityBoundary、OptionalFieldOmissionProbe |

## 执行步骤

1. 明确开发者画像：新用户、现有维护者、集成方、插件作者、框架消费者或发布方。
2. 跑通或推导 first success path：安装、配置、最小命令、示例输入、成功输出。
3. 检查集成步骤是否依赖本机绝对路径、私有工作区、隐藏文档或未声明前置条件。
4. 审查示例：是否符合生产推荐路径、是否说明 fixture/mock/demo 边界。
5. 审查错误体验：失败时是否可定位、可恢复、可继续验证。
6. 若 CLI 提供 `--json`，验证 stdout 只有一个可解析 JSON 文档；合同错误 exit=2、运行检查失败 exit=1、成功 exit=0，默认人读输出不得被 JSON 字段泄漏污染。
7. 执行 `ConfigurationErgonomicsGate`：为最高频任务给出最小配置，逐字段证明必要性，冻结复杂度预算，分离高级能力，并验证可选字段真实省略后仍能完成任务。
8. 对版本或契约变化补迁移路径、兼容策略和文档入口。

## ConfigurationErgonomicsGate

| 产物 | 要求 |
|------|------|
| `MinimalTaskConfig` | 从空状态完成最高频任务所需的最小字段、默认值和成功结果 |
| `FieldNecessityMatrix` | 每个公开字段的用户任务、必填理由、默认/推导来源、错误语义和移除影响 |
| `ComplexityBudget` | 首次成功所需字段数、嵌套深度、概念数和额外步骤预算；超预算必须有真实消费者证据 |
| `AdvancedCapabilityBoundary` | 高级、安全、性能、企业或 provider 特有能力与主路径分离，不污染最小配置 |
| `OptionalFieldOmissionProbe` | 删除所有可选字段后运行等价命令 / API / 示例，验证默认路径、错误和文档承诺一致 |

可推导、可默认、只服务内部实现或只为未来扩展预留的字段不得默认公开为必填。字段数量本身不是唯一指标，但“每个字段都有实现用途”也不能替代用户任务价值证明。

## 输出字段

```markdown
## DeveloperExperienceArchitectureGate

| 字段 | 内容 |
|------|------|
| developerPersona | 目标开发者画像和前置能力 |
| firstSuccessPath | 从空状态到第一个成功结果的步骤、命令和期望输出 |
| integrationSteps | 接入步骤、配置、依赖和环境要求 |
| exampleTruth | 示例是否真实业务工作流；fixture/mock/demo 边界 |
| errorExperience | 常见失败、错误信息、排错入口和恢复动作 |
| machineReadableCli | human/json 兼容、envelope、errorCode/nextStep、exit map 与 spawn 证据 |
| migrationPath | 版本变化、兼容策略、迁移步骤 |
| configurationErgonomics | 最小配置、字段必要性、复杂度预算、高级边界和省略探针 |
| docsEntryPoints | README / 文档站 / API / changelog / examples 可点击入口 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| quick start 只展示硬编码 happy path | 补真实业务输入、失败路径和恢复方式 |
| 示例文件能跑但不是推荐接入方式 | 标注 exampleTruth / fixtureBoundary，并给生产主路径 |
| 错误信息只说 failed | 输出原因、下一步和文档入口 |
| JSON 模式混入 banner/progress 文本或仍以 exit 0 报错 | stdout 只输出 envelope，并按合同/检查失败映射 native exit code |
| 文档链接写死本机路径或 `.devcodex` 私有路径 | 改为仓库相对路径、公开 URL 或说明不可分享边界 |
| 把所有底层能力都暴露为配置 | 保留 MinimalTaskConfig，把低频/高级能力放入显式 advanced boundary |

## 与其他 Skill 的关系

- `expert-output-quality`：示例和 fixture 必须区分生产推荐路径与验证边界。
- `readme-authoring` / `user-manual-authoring`：README 与接入手册需采用 first success path。
- `release-verification`：发布前必须验证 package / install / smoke 对开发者可用。
- `test-router`：把 DX 验证映射为 command smoke、pack、example、docs link 和 migration probe。
