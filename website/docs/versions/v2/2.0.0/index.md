# v2.0.0 路线图

> **优先级**：P3（规划阶段，不影响 v1.0.0 开发）  
> **状态**：📋 规划中  
> **前置条件**：v1.0.0 正式发布并验证稳定

---

## 目标

v2.0.0 是 DevCodex 的商业化与平台化起点，引入云端存储层，支持：
1. **多租户**：每个团队/用户独立的工作流配置和记忆数据
2. **跨设备同步**：记忆文件不再依赖本地 `.devcodex/.memory/`
3. **可视化管理**：在 DevCodex 控制台查看任务历史、违规记录等
4. **自定义工作流**：租户可在控制台定义自己的 CP 节点、规范约束

---

## v2.0.0 与 v1.0.0 的边界

| 项目 | v1.0.0 | v2.0.0 |
|------|--------|--------|
| 收费策略 | 免费 | 商业化分层（Free / Pro / Enterprise） |
| 产物存储 | 本地 Markdown / 文件系统 | MongoDB + 平台化数据层 |
| 目标 | 规范冻结与开发准备 | 平台化、租户化、商业化 |

---

## 架构决策

### D-001：Skills 薄壳 + workflows/ 内容分离

**日期**：2026-04-04  
**决策**：Skills 目录（`SKILL.md`）只作入口路由，工作流详细内容全部移至 `workflows/<name>/` 目录。  
**原因**：遵循官方扁平目录约束的同时实现内容分离，为 v2.0.0 MCP 动态化迁移预留零成本升级路径。  
**影响**：所有 SKILL.md 改为极简路由格式，新增 `workflows/` 目录结构。

---

### D-002：意图识别后 MCP 替代本地文件读取

**日期**：2026-04-04  
**决策**：v2.0.0 起，意图识别完成后调用 `devcodex_getWorkflow({ intent, tenant_id, token })` 获取工作流内容，替代读取本地 `workflows/` 文件。  
**原因**：支持工作流热更新（无需 `devcodex update`）、租户自定义、服务端授权验证、使用量统计。  
**影响**：`workflows/` 目录整体废弃，SKILL.md 中的注释占位替换为 MCP 调用。

---

### D-003：租户自定义工作流存储在平台

**日期**：2026-04-04  
**决策**：租户自定义的工作流（自定义 CP 节点、规范约束、扩展 Skill）存储在 DevCodex 平台，通过 MCP 按 `tenant_id` 下发。  
**原因**：避免租户直接修改本地规范文件，统一版本管理，支持多成员团队共享同一套工作流配置。  
**影响**：需要 DevCodex 控制台 + 工作流管理 API + 租户数据模型。

---

### D-004：Remote MCP（HTTPS）作为唯一通信协议

**日期**：2026-04-04  
**决策**：v2.0.0 使用 Remote MCP（`https://api.devcodex.dev/mcp`），不支持 Local MCP（本地 Server）。  
**原因**：Local MCP 需用户自行运行 Server，部署成本高，无法支持多设备同步和服务端授权。  
**时间窗口**：Remote MCP 在 VS Code Stable 版本预计 2026 Q3 稳定，与 v2.0.0 开发节奏匹配。  
**影响**：必须联网使用，需在文档中明确说明网络依赖。



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
