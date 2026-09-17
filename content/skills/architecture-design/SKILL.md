---
name: architecture-design
description: 架构设计文档编排 Owner — 当用户要求架构设计、系统设计、技术架构或可指导开发、Review 与任务拆分的完整方案时使用；要求从业务流程反推节点、状态、数据、一致性、异常补偿、ADR 与实施任务。
---

# Architecture Design Skill

## 目录导航

- [定位](#定位)
- [触发条件](#触发条件)
- [与领域架构 Skill 的关系](#与领域架构-skill-的关系)
- [核心门禁](#核心门禁)
- [执行流程](#执行流程)
- [输出结构](#输出结构)
- [图表要求](#图表要求)
- [反模式](#反模式)
- [完成判定](#完成判定)

## 定位

本 Skill 负责完整架构设计文档的编排 Owner 视角。它把需求、业务流程、模块边界、数据模型、API 契约、一致性、异常补偿、ADR、验证与任务拆分组织成可直接指导开发、Review 和排期的设计产物。

本 Skill 不替代领域架构 Skill 的专业判断。它负责结构、顺序、追踪关系和交付物完整性；领域细节由后端、前端、数据、API、分布式、集成、平台、AI Agent、隐私合规、设计系统、DX 等 Skill 提供判断。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 用户要求架构设计、系统设计、技术架构、概要设计、详细设计或可指导开发/Review/任务拆分的方案 | 必须 |
| 需求从 0 到 1、跨模块、跨角色、跨状态、跨数据流或跨外部系统 | 必须 |
| 方案需要主流程、子流程、节点设计、状态机、数据流、时序、ADR、风险和实施拆分 | 必须 |
| 已有代码小修、单点 bug 修复、纯审计结论或只要求某一领域专家判断 | N/A + skipReason |

## 与领域架构 Skill 的关系

| 领域 | 主要协作 Skill | 本 Skill 的编排责任 |
|------|----------------|--------------------|
| 业务与产品取舍 | `product-strategy` | 把业务目标、角色、对象和成功标准转成架构输入 |
| 后端领域与流程 | `backend-domain-architecture` | 确保业务不变量、权限、事务和幂等映射到节点设计 |
| API 与公开契约 | `api-contract-architecture` | 确保 API 由流程和消费者反推，避免先写接口后补业务 |
| 数据模型与迁移 | `data-architecture` | 确保模型、查询、索引、生命周期和消费者闭环 |
| 前端体验 | `frontend-architecture`、`ux-interaction-architecture` | 确保状态、错误、加载、权限和交互与主流程一致 |
| 分布式与外部系统 | `distributed-systems-architecture`、`external-integration-architecture` | 确保失败、重试、补偿、超时和一致性边界可验证 |
| 平台、AI、合规与 DX | `platform-ecosystem-architecture`、`ai-agent-system-architecture`、`privacy-compliance-architecture`、`developer-experience-architecture` | 确保平台扩展、Agent 合同、合规边界和开发体验进入设计 |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `ArchitectureDesignIntentGate` | 先结构化需求目标、业务场景、角色、业务对象、边界和非目标 | requirementMatrix、boundary |
| `BusinessFlowFirstGate` | 先写主业务流程，再进入模块、类、表、API 或缓存 | mainFlow |
| `FlowDecompositionGate` | 复杂主流程节点必须拆成子流程，并说明触发、输入、输出和终止条件 | subFlows |
| `NodeImplementationGate` | 关键节点必须写职责、前置条件、读写数据、状态变化、依赖、成功/失败和幂等 | nodeDesign |
| `StateMachineGate` | 有状态对象必须写状态、事件、转移条件、终态和非法转移 | stateMachine |
| `DataFlowSequenceGate` | 数据流和时序必须说明谁产生、谁消费、何时持久化、何时可见 | dataFlow、sequence |
| `ModuleBoundaryGate` | 模块职责、依赖方向、共享契约和禁止跨层访问必须清楚 | moduleMap |
| `DataModelConsistencyGate` | 数据模型、唯一键、索引、事务、一致性、缓存和生命周期必须闭环 | dataModel、consistency |
| `ApiContractMappingGate` | API/CLI/事件/Hook/MCP 契约必须由流程节点和消费者反推 | contractMatrix |
| `FailureCompensationGate` | 重试、超时、重复提交、部分成功、外部失败和人工修复路径必须定义 | failureMatrix |
| `ArchitectureDecisionGate` | 关键决策必须写问题、方案、理由、备选项、拒绝原因和代价 | ADR |
| `DevelopmentTaskSplitGate` | 最终任务拆分必须能映射回流程节点、模块、契约和验证项 | taskBreakdown |
| `ArchitectureReviewChecklistGate` | Review 清单必须覆盖流程、状态、数据、契约、一致性、异常、可运维性和风险 | checklist |

## 执行流程

1. 结构化意图：提取目标、用户价值、业务角色、核心对象、范围、非目标、约束和待确认项。
2. 建立主流程：用业务语言描述从触发到终态的主路径，先不落实现类名和数据库表。
3. 拆分子流程：对复杂节点补子流程，明确入口、出口、失败分支和可恢复路径。
4. 设计节点：逐个关键节点写职责、输入、输出、前置条件、状态变化、数据读写、外部依赖、成功/失败和幂等策略。
5. 路由领域 Skill：按实际问题调用相关领域架构 Skill，引用其判断而不是重复发明领域规则。
6. 建模与契约：在流程和节点稳定后，定义模块、数据模型、API/事件/CLI/Hook/MCP 契约和兼容策略。
7. 写 ADR：记录会影响扩展性、复杂度、成本、风险或长期维护的关键决策。
8. 完成落地：输出验证策略、风险、待确认项、任务拆分和 Architecture Review Checklist。

## 输出结构

架构设计文档必须包含 `## 目录导航`。若某节不适用，保留标题并写明 `N/A + skipReason`；不要删除结构导致 Review 无法定位缺口。

```markdown
## 目录导航
## 1. 架构目标与成功标准
## 2. 需求理解与业务场景
## 3. 角色、权限与核心业务对象
## 4. 系统边界与非目标
## 5. 当前上下文与约束
## 6. 整体架构图
## 7. 系统主流程
## 8. 子流程设计
## 9. 核心节点详细设计
## 10. 状态机设计
## 11. 数据流设计
## 12. 时序设计
## 13. 模块架构与依赖方向
## 14. 数据模型、索引与生命周期
## 15. API、事件、CLI、Hook 或 MCP 契约
## 16. 一致性、事务、缓存与幂等
## 17. 异常、重试、补偿与人工修复
## 18. 权限、安全、隐私与审计
## 19. 性能、容量与可扩展性
## 20. 可观测性与运维策略
## 21. ADR 决策记录
## 22. 风险、取舍与待确认项
## 23. 开发任务拆分与里程碑
## 24. Architecture Review Checklist
```

## 图表要求

- 主流程优先使用 Mermaid `flowchart TD`，节点名称使用业务动作。
- 有状态对象时使用 `stateDiagram-v2` 或状态转移表，必须包含非法转移处理。
- 跨系统调用、异步事件、补偿和回调使用 `sequenceDiagram` 或时序表。
- 图表必须和正文节点编号互相引用；不要为了形式完整添加无信息量图表。

## 反模式

| 反模式 | 修正 |
|--------|------|
| 从需求直接跳到 controller/service/repository/table/API | 先补主流程、子流程和节点设计 |
| 只说“使用 Redis/MQ/定时任务/缓存”但不说明业务触发与失败恢复 | 补 ADR、数据可见性、一致性和补偿策略 |
| 流程图只有大框，没有关键节点的输入、输出、状态和数据读写 | 补 `NodeImplementationGate` |
| API 先行，业务流程和消费者后补 | 用 `ApiContractMappingGate` 反推契约 |
| 写“根据实际情况处理异常” | 明确失败矩阵、重试边界、人工修复和告警 |
| 为了显得完整引入不必要的分布式组件 | 写取舍，证明必要性或删除该复杂度 |

## 完成判定

完成的架构设计必须回答：做什么、为什么做、谁参与、主流程怎么走、关键节点怎么实现、状态如何变化、数据如何流动、契约如何消费、失败如何恢复、一致性如何保证、替代方案为何不选、开发任务如何拆分、Review 如何验收。
