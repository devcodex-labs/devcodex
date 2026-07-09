---
name: data-architecture
description: 数据架构专家 Owner — 当任务涉及数据模型、Schema、迁移、索引、查询、生命周期、数据质量、派生指标、分析消费者、跨环境数据或持久化状态时使用；要求把数据结构、演进和消费链设计清楚。
---

# Data Architecture Skill

## 定位

本 Skill 负责数据架构 Owner 视角。它关注数据如何建模、迁移、查询、维护质量、被谁消费，以及生命周期如何闭环。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 数据模型、Schema、migration、索引、查询、缓存、持久化状态、派生指标 | 必须 |
| 涉及跨环境数据补齐、导入导出、数据质量、保留策略或分析消费者 | 必须 |
| 修改 Profile、台账、报告字段或运行态状态结构 | 必须 |
| 纯静态文案或无状态计算 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `DataArchitectureGate` | 数据模型、迁移、索引、生命周期、质量和消费者必须成矩阵 | dataModel、schemaMigration |
| `DataModelBoundaryGate` | 业务实体、关系、字段、约束和稳定键必须明确 | dataModel |
| `MigrationSafetyGate` | 迁移、回滚、dry-run、重复/缺失处理必须可验证 | schemaMigration |
| `QueryIndexGate` | 查询路径、索引、分页和性能边界必须说明 | queryIndexPlan |
| `DataQualityLifecycleGate` | 数据质量、保留、清理、派生消费者必须明确 | dataQuality、lifecycleRetention |

## 执行步骤

1. 建立数据模型和消费者清单。
2. 确定稳定业务键、唯一性、关系、生命周期和保留策略。
3. 设计迁移路线、dry-run、回滚和缺失/重复清单。
4. 评估查询、索引、分页、缓存和性能。
5. 绑定数据质量、派生指标、分析消费者和验证证据。

## 输出字段

```markdown
## DataArchitectureGate

| 字段 | 内容 |
|------|------|
| dataModel | 实体、关系、字段、约束、稳定键 |
| schemaMigration | 迁移、dry-run、回滚、缺失/重复处理 |
| queryIndexPlan | 查询路径、索引、分页、性能边界 |
| lifecycleRetention | 生命周期、保留、清理、归档 |
| dataQuality | 完整性、一致性、重复、异常数据策略 |
| analyticsConsumer | 派生指标、报表、日志、消费者影响 |
| evidenceMatrix | 判断 -> schema / migration / query / tests / samples / docs |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 直接使用源环境 `_id` 写目标环境 | 用稳定业务键或显式映射清单 |
| 只改字段不评估消费者 | 列 analyticsConsumer 和 derived consumer |
| 无 dry-run 的数据迁移 | 补范围、预览、缺失/重复、回滚 |
| 查询无索引和分页判断 | 补 queryIndexPlan |

## 与其他 Skill 的关系

- `dev-database`：数据库 schema 变更使用专门 migration 安全策略。
- `api-contract-architecture`：数据字段进入 public API 时必须同步契约。
- `quality-strategy`：数据质量需要测试和回归矩阵。
