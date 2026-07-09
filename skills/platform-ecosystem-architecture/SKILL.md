---
name: platform-ecosystem-architecture
description: 平台生态架构专家 Owner — 当任务涉及 CLI、Hook、多宿主、插件、扩展点、能力发现、部署副本、兼容矩阵、迁移、版本分发或生态治理时使用；要求把平台能力设计成可发现、可扩展、可兼容、可发布。
---

# Platform Ecosystem Architecture Skill

## 定位

本 Skill 负责平台生态 Owner 视角。它关注 DevCodex 这类 CLI + Hook + Skill + Profile + 多宿主项目的扩展点、兼容矩阵和迁移成本。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| CLI、Hook、MCP、plugin、Skill、Profile、部署副本、多宿主能力变化 | 必须 |
| 涉及扩展点、能力发现、兼容矩阵、迁移、版本分发或生态文档 | 必须 |
| 任务会改变公开目录结构、安装路径、插件 manifest 或宿主契约 | 必须 |
| 单项目内部业务实现且无平台扩展面 | N/A + skipReason |

## 核心门禁

| Gate | 要求 | 证据 |
|------|------|------|
| `PlatformEcosystemArchitectureGate` | 平台能力必须有宿主矩阵、扩展点、发现机制、兼容和迁移路线 | hostSurfaceMatrix、compatibilityMatrix |
| `ExtensionPointContractGate` | 扩展点输入输出、生命周期和约束必须稳定 | extensionPointContract |
| `CapabilityDiscoveryGate` | 用户和 Agent 必须能发现能力入口 | README、website、routing、plugin |
| `HostCompatibilityGate` | Copilot / Claude Code / Codex / fallback 差异必须明确 | hostSurfaceMatrix |
| `DistributionMigrationGate` | 发布、部署副本和迁移路径必须可验证 | releaseDistributionImpact |

## 执行步骤

1. 列出宿主面和能力面：CLI、Hook、MCP、Skill、Profile、docs、plugin。
2. 冻结扩展点契约：输入、输出、生命周期、错误、权限、兼容。
3. 设计能力发现路径：README、website、routing、Profile、validate。
4. 建立兼容矩阵和迁移策略：当前版本、历史路径、部署副本、fallback。
5. 将发布和部署影响纳入 TestRoute。

## 输出字段

```markdown
## PlatformEcosystemArchitectureGate

| 字段 | 内容 |
|------|------|
| hostSurfaceMatrix | 宿主/客户端/部署副本矩阵 |
| extensionPointContract | 扩展点契约、生命周期、限制 |
| capabilityDiscovery | 能力发现入口和用户路径 |
| compatibilityMatrix | 兼容矩阵、fallback、历史路径 |
| migrationPath | 迁移步骤、弃用窗口、用户影响 |
| releaseDistributionImpact | package/plugin/docs/deploy copy 发布影响 |
| evidenceMatrix | 判断 -> 源码 / manifest / README / website / validate / smoke |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 只改源文件，不同步宿主副本 | 执行 source-consumer-sync 和 V8 |
| 扩展点没有生命周期和错误语义 | 补 extensionPointContract |
| 只说“支持多宿主” | 建 hostSurfaceMatrix |
| 公开能力无法被用户发现 | 补 README / website / routing / Profile |

## 与其他 Skill 的关系

- `source-consumer-sync`：平台能力必须同步所有当前消费者和部署副本。
- `host-contract-verification`：Hook/CLI/宿主契约变化需要 direct replay 或 fixture replay。
- `release-verification`：分发面变化进入发布前验证。
