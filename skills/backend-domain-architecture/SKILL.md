---
name: backend-domain-architecture
description: 后端领域架构专家 Owner — 当任务涉及领域模型、业务流程、权限、API、事务、一致性、幂等、兼容、数据边界、服务职责或用户要求从后端/领域专家角度审查时使用；要求用领域语言和业务不变量约束实现。
---

# Backend Domain Architecture Skill

## 定位

本 Skill 负责后端领域架构 Owner 视角。它要求后端设计先表达领域语言、业务流程、不变量和一致性边界，再落到接口、服务、权限、事务、缓存和数据结构，避免把框架样板或测试 fixture 当领域设计。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| API、服务、权限、领域模型、业务流程、数据一致性或事务边界变化 | 必须 |
| 涉及幂等、并发、缓存、队列、长事务、兼容迁移、public types | 必须 |
| 用户指出示例像低阶、route 重复声明、权限/资源模型不专业 | 必须 |
| 纯静态文档或前端视觉调整，后端契约不变 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `BackendDomainArchitectureGate` | 后端方案必须绑定领域语言、边界上下文、业务不变量和一致性策略 | 源码、类型、schema、测试、运行证据 |
| `DomainLanguageGate` | API、服务、文档和测试使用一致的领域词汇 | domainLanguage |
| `BoundedContextGate` | 区分服务职责、模块边界、共享库和历史 route namespace | boundedContext |
| `WorkflowInvariantGate` | 关键业务流程必须写前置条件、状态转换和不可破坏不变量 | workflowInvariants |
| `PermissionModelGate` | 权限、资源、action、route group 或 middleware 由推荐主路径承载 | permissionModel |
| `ConsistencyIdempotencyGate` | 事务、一致性、幂等、重试和兼容演进有明确策略 | transactionConsistency、idempotencyCompatibility |

## 执行步骤

1. 提取领域语言：实体、资源、动作、角色、状态、事件和约束。
2. 划定边界上下文：当前服务、共享库、adapter、legacy/compat、public API 和内部实现。
3. 描述业务流程：入口、前置条件、状态变化、失败分支、回滚和审计。
4. 设计权限模型：认证、授权、资源映射、route group、policy 和默认拒绝边界。
5. 设计一致性：事务范围、读写模型、缓存失效、幂等 key、重试和补偿。
6. 检查兼容性：public types、历史路由、迁移、版本化和消费者影响。

## 输出字段

```markdown
## BackendDomainArchitectureGate

| 字段 | 内容 |
|------|------|
| domainLanguage | 实体、资源、动作、状态、事件和术语 |
| boundedContext | 服务/模块/共享库/legacy/compat/public API 边界 |
| workflowInvariants | 业务流程、状态转换和不可破坏不变量 |
| permissionModel | authN/authZ、resource/action、policy、route group 或 middleware 主路径 |
| transactionConsistency | 事务范围、一致性级别、缓存失效、补偿 |
| idempotencyCompatibility | 幂等、重试、版本兼容、迁移和消费者影响 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 每个 route 重复写权限资源配置 | 使用项目推荐的认证插件、resource mapper、route group 或 preset helper |
| 只描述数据库表，不描述业务不变量 | 补 workflowInvariants 和状态转换 |
| 单项目临时补丁绕过共享库根因 | 评估共享库修复 + 消费项目升级路径 |
| 只按 label 查 legacy，不查 slug/href/title/sidebar/search/generated HTML | 执行语义曝光反查和引用真相抽样 |

## 与其他 Skill 的关系

- `expert-output-quality`：防止后端 fixture 或重复声明被包装成推荐实践。
- `api-verification`：API 行为需要 .http + .cjs 双产物验证。
- `audit-project`：项目工程审查中的资源泄漏、权限、类型和运行证据可叠加本 Skill。
- `release-verification`：public API、types 或兼容变化进入发布验证。
