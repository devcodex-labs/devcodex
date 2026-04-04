# v2.0.0 路线图

> **优先级**：P3（规划阶段，不影响 v1.0.0 开发）  
> **状态**：📋 规划中  
> **前置条件**：v1.0.0 正式发布并验证稳定

---

## 目标

v2.0.0 引入云端存储层，支持：
1. **多租户**：每个团队/用户独立的工作流配置和记忆数据
2. **跨设备同步**：记忆文件不再依赖本地 `.devcodex/.memory/`
3. **可视化管理**：在 DevCodex 控制台查看任务历史、违规记录等
4. **自定义工作流**：租户可在控制台定义自己的 CP 节点、规范约束

---

## MongoDB 数据模型（初步规划）

### 集合：sessions（记忆迁移）

```json
{
  "_id": ObjectId,
  "tenantId": "string",
  "agentId": "copilot | cursor | claude",
  "date": "2026-04-04",
  "sessionNo": 1,
  "task": "任务描述",
  "status": "active | completed",
  "checkpoints": [],
  "pendingFollowUp": "string | null",
  "reportPaths": ["string"],
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```

### 集合：tenants（租户配置）

```json
{
  "_id": ObjectId,
  "tenantId": "string",
  "name": "string",
  "plan": "free | pro | enterprise",
  "customWorkflows": {
    "dev": { "cpRequired": true, "autoMode": false },
    "fix": { "triageRequired": true }
  },
  "customInstructions": "string",
  "createdAt": ISODate
}
```

### 集合：violations（违规审计）

```json
{
  "_id": ObjectId,
  "tenantId": "string",
  "sessionId": ObjectId,
  "rule": "S02",
  "description": "硬编码 API Key",
  "status": "open | resolved",
  "createdAt": ISODate
}
```

### 集合：usageStats（用量统计）

```json
{
  "_id": ObjectId,
  "tenantId": "string",
  "date": "2026-04-04",
  "workflow": "dev",
  "subtype": "default",
  "tokenRounds": 8,
  "completed": true
}
```

---

## v1.0.0 架构预留要求

为确保 v2.0.0 存储层替换时不需要重写所有 Skill，v1.0.0 必须遵守以下原则：

| 原则 | 说明 |
|------|------|
| 记忆操作统一入口 | 所有记忆读写必须通过 `memory` Skill，不直接操作文件 |
| 报告操作统一入口 | 所有报告写入通过 `report` Skill |
| data/ 操作统一 | violations/pending-fixes/gap-registry 通过各 Skill 的 append 接口 |
| 路径可配置 | 存储根路径从 profile 读取，不硬编码 `.devcodex/` |

---

## v2.0.0 开发准备事项（v1.0.0 稳定后开始）

- [ ] 确定 MongoDB 托管方案（Atlas / 自建）
- [ ] 设计认证方案（API Key / OAuth）
- [ ] 设计 CLI 同步命令（`devcodex sync` / `devcodex push-memory`）
- [ ] 设计租户控制台（Web UI）
- [ ] 制定本地 → 云端迁移工具
- [ ] 制定数据隐私与合规方案（GDPR 等）

---

## 时间节点

| 里程碑 | 前置条件 |
|--------|---------|
| v1.0.0 发布 | 本路线图开始执行 |
| v1.x 稳定（≥3 个月）| 开始 v2.0.0 原型 |
| v2.0.0 beta | MongoDB 集成 + 多租户基础功能 |
| v2.0.0 正式 | 自定义工作流 + 控制台 |
