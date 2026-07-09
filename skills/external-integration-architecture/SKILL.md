---
name: external-integration-architecture
description: 外部集成架构专家 Owner — 当任务涉及第三方 API、Webhook、OAuth、回调、provider/connector、配额、重试、降级、供应商锁定、外部故障或集成文档时使用；要求隔离外部边界并设计失败恢复。
---

# External Integration Architecture Skill

## 定位

本 Skill 负责外部集成 Owner 视角。它要求把第三方能力当作不稳定边界处理：认证、回调、配额、重试、降级、审计和退出策略都要可验证。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 第三方 API、OAuth、Webhook、callback、provider、connector、adapter、外部 SDK | 必须 |
| 任务涉及重试、超时、配额、限流、外部失败、降级、供应商锁定或回放 | 必须 |
| 文档或示例描述外部接入流程 | 必须 |
| 纯仓库内部逻辑且无外部系统边界 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `ExternalIntegrationArchitectureGate` | 外部边界、认证回调、配额重试、降级和锁定风险必须成矩阵 | providerBoundary、quotaRetryPolicy |
| `ProviderBoundaryGate` | 外部 payload 不得污染公共业务契约 | adapter、mapper、contract |
| `AuthCallbackGate` | OAuth、签名、回调、重放和状态校验必须设计 | authCallbackModel |
| `QuotaRetryDegradationGate` | 配额、重试、幂等、超时、降级和失败恢复必须明确 | failureDegradation |
| `VendorLockInGate` | 供应商锁定和替换成本必须说明 | lockInExitPlan |

## 执行步骤

1. 区分业务契约、内部 provider adapter、外部 payload。
2. 识别认证、签名、callback、webhook、重放、幂等和审计边界。
3. 设计配额、限流、重试、退避、超时、降级和最终一致性。
4. 记录供应商锁定、替换成本、兼容层和迁移路径。
5. 为成功、失败、部分成功、重复回调和外部不可用建立验证。

## 输出字段

```markdown
## ExternalIntegrationArchitectureGate

| 字段 | 内容 |
|------|------|
| providerBoundary | 业务契约 / adapter / 外部 payload 边界 |
| authCallbackModel | OAuth、签名、callback、webhook、重放防护 |
| quotaRetryPolicy | 配额、限流、超时、重试、退避 |
| webhookIdempotency | webhook 去重、幂等、顺序和重放 |
| failureDegradation | 外部失败、部分成功、降级、恢复 |
| lockInExitPlan | 供应商锁定、替换成本、迁移策略 |
| evidenceMatrix | 判断 -> 官方文档 / 代码 / 测试 / 日志 / 运行时证据 |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 直接把 provider 字段暴露给业务 API | 使用 mapper 和标准 result |
| 只处理 200 响应 | 补配额、超时、重试、部分成功和失败恢复 |
| Webhook 不做幂等和重放处理 | 定义 event id、signature、dedupe、replay 策略 |
| 集成文档只写申请 key | 补 callback、权限、限制、错误和恢复 |

## 与其他 Skill 的关系

- `api-contract-architecture`：外部 adapter 不能反向污染公共 API。
- `security-threat-modeling`：认证、签名、webhook 和密钥边界需要威胁建模。
- `production-readiness-sre`：外部故障、配额和降级进入运行风险矩阵。
