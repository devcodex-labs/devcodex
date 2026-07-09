---
name: security-threat-modeling
description: 安全威胁建模专家 Owner — 当任务涉及权限、认证、授权、输入输出信任边界、密钥策略、审计、攻击面、Webhook/OAuth、敏感操作或用户要求安全专家视角时使用；要求识别滥用路径并绑定缓解验证。
---

# Security Threat Modeling Skill

## 定位

本 Skill 负责安全威胁建模 Owner 视角。它不默认改变 S02 用户策略，而是把信任边界、滥用路径、权限、审计和缓解验证说清楚。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| 认证、授权、权限、敏感操作、输入输出信任边界、审计、密钥策略 | 必须 |
| OAuth、Webhook、外部集成、admin、脚本执行、文件系统、数据库写入、发布凭据 | 必须 |
| 复审发现权限绕过、越权、注入、重放、审计缺失或风险误判 | 必须 |
| 纯文案或无安全边界变化 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `SecurityThreatModelingGate` | 信任边界、威胁场景、权限滥用、密钥策略、审计和缓解验证必须成矩阵 | trustBoundary、threatScenario |
| `TrustBoundaryGate` | 输入、输出、调用方、外部系统和持久化边界必须明确 | trustBoundary |
| `PermissionAbuseCaseGate` | 权限滥用、越权、绕过和敏感操作必须有负向样例 | permissionAbuseCase |
| `SecretPolicyRespectGate` | 必须遵循 S02 用户 / 项目策略，不得自行加严 | secretPolicy |
| `AuditMitigationGate` | 缓解措施必须有日志、审计或测试证据 | auditLogging、mitigationVerification |

## 执行步骤

1. 画出信任边界和资产：用户、系统、外部 provider、数据、密钥、文件。
2. 枚举威胁场景：越权、重放、注入、伪造、泄漏、误操作、审计缺失。
3. 设计权限和输入输出校验边界，不重复框架已承担的能力。
4. 按 S02 判断密钥和明文策略，不主动引入 env/secretRef。
5. 为每项缓解绑定测试、日志、审计或人工证据。

## 输出字段

```markdown
## SecurityThreatModelingGate

| 字段 | 内容 |
|------|------|
| trustBoundary | 用户/系统/外部/数据/密钥边界 |
| threatScenario | 威胁场景、攻击面、失败路径 |
| permissionAbuseCase | 越权、绕过、滥用、敏感操作 |
| secretPolicy | S02 用户/项目策略、明文/硬编码/env 边界 |
| auditLogging | 审计、日志、追踪、证据保留 |
| mitigationVerification | 缓解措施和负向验证 |
| evidenceMatrix | 判断 -> 代码 / policy / tests / logs / docs |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 一看到密钥就默认改 env | 先执行 S02 策略判断 |
| 权限只测 happy path | 补 permissionAbuseCase 负向样例 |
| 安全建议无验证 | 补 mitigationVerification |
| 把框架已有鉴权重复写进业务层 | 先查框架/项目原生能力 |

## 与其他 Skill 的关系

- `external-integration-architecture`：OAuth/Webhook/签名需要联合审查。
- `backend-domain-architecture`：权限模型和领域不变量需要一致。
- `audit-project`：安全 finding 进入工程审查和测试路线。
