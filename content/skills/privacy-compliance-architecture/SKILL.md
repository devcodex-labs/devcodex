---
name: privacy-compliance-architecture
description: 隐私与合规架构专家 Owner — 当任务涉及个人信息/PII、数据分类、目的限制、同意、最小化、保留删除、数据驻留、跨境、日志脱敏、主体访问导出删除权或隐私审计时使用；要求把数据生命周期和用户权利映射到真实系统路径与证据。
---

# Privacy Compliance Architecture

## 职责

设计从采集、使用、共享、存储、日志、备份到删除的隐私生命周期，并把政策要求落实为系统合同。security 负责攻击面，data 负责模型，growth 负责分析目的；本 Skill 负责隐私权利、目的和合规证据。

## PrivacyComplianceArchitectureGate

| 字段 | 要求 |
|---|---|
| dataClassificationMap | 数据项、敏感度、主体、来源、存储、日志/trace/备份派生面 |
| purposeConsentMatrix | purpose、lawful basis/consent、使用者、撤回、二次用途限制 |
| minimizationBoundary | 必需字段、可选字段、派生字段和禁止采集/传播面 |
| retentionDeletionPolicy | active/archive/log/cache/backup 的期限、触发、例外和可验证删除 |
| residencyBoundary | region、跨区/跨境流、processor/subprocessor 和迁移限制 |
| dataSubjectRightsFlow | access/export/correct/delete/restrict/withdraw 的身份验证、范围和 SLA |
| privacyAuditEvidence | 决策、访问、导出、删除、例外、失败和人工复核证据 |

## 执行流程

1. 以真实数据流建立 inventory，不只看数据库 Schema；包含 prompt、日志、trace、analytics、cache、queue、backup 和第三方。
2. 为每项数据绑定 purpose、最小化、访问者、保留、驻留和删除路径。
3. 区分 consent 与其他合法基础；定义撤回后的新处理、已有数据和下游传播。
4. 设计主体权利流程及身份验证，防止导出/删除接口形成越权。
5. 明确 processor/provider 边界、跨区域传输和供应商退出。
6. 为超期保留、日志泄露、备份删除失败、下游未传播和权限误配设计探针。
7. 把法律/政策适用范围标为 project evidence；证据不足时不得编造法规结论。

## 输出字段

`dataClassificationMap`、`purposeConsentMatrix`、`minimizationBoundary`、`retentionDeletionPolicy`、`residencyBoundary`、`dataSubjectRightsFlow`、`processorMap`、`privacyAuditEvidence`、`verificationRoute`、`evidenceMatrix`。

## 反模式

- 把加密或鉴权等同于隐私合规。
- 只定义数据库删除，不覆盖缓存、搜索、日志、队列和备份。
- 所有采集都写“用户已同意”，却无 purpose、撤回和证据。
- 日志脱敏只 grep 源码，不验证 runtime artifact。
- 复制法规名称或地区结论，没有项目适用证据。
- 为了“合规最佳实践”覆盖用户/项目明确的数据和秘密策略。

## 验证

至少覆盖超期保留、撤回同意、访问/导出/更正/删除、跨区传输、日志/trace 泄露、cache/search/backup 删除、processor 传播、权限越权和审计证据完整性。
