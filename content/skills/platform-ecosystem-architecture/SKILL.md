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

### CapabilitySurfaceDecision 证据提供者

新增或改变 Rule/Skill、Prompt、MCP Resource/Resource Template/Tool、Task 增强 Tool、CLI 或 Hook 时，本 Skill 只向 `spec-governance#CapabilitySurfaceDecisionGate` 提供宿主能力、发现路径、协议/版本、兼容矩阵、迁移与 fallback 证据。它读取中央 `decisionRef`，不得在本 Skill 重写选择矩阵、另建 canonical decision 或复制 `preferredSurface / runtimeOwner / truthBoundary` 等中央字段；宿主直接证据不足时保持 `UNVERIFIED`。

### DevCodex managed deployment manifest

- 当前宿主配置由 `GlobalHostTargetV1`、`global-host-config.js` 与 `GlobalHostConfigReceiptV1` 的用户级目标、受管内容、runtime generation 和实际加载路径共同证明；`global-adapters apply --dry-run` 预览，授权 apply 按事务更新。`init/update` 的项目 active-root 运行态与宿主配置 owner 分离。
- 生成模板不能代替部署验收：包装 import 必须解析到当前代际 kernel，Skill 根取 receipt 的 `skillsRuntimeRoot`；源文件摘要、配置已写入或旧路径存在均不单独证明当前宿主已加载。
- legacy `init/update` copy map 与 `resolveActiveRuntimeRoot(cwd)/managed/deployment-manifest.json` 仅作明确的历史/迁移核对。其 preview 的 `add/update/unchanged/stale/unowned`、source→destination/hash 和 stale existing 语义保持历史边界，不能把 pre-manifest extras 伪装成 stale，也不让当前 global apply 重写旧父链副本。
- V8 默认对 authoring source package 核源码边界；显式 workspace 范围保留 legacy parity。当前用户级部署另核 receipt/config/实际进程与 native/fixture 证据，不以 V8 代替。

## 执行步骤

1. 列出宿主面和能力面：CLI、Hook、MCP、Skill、Profile、docs、plugin；命中新/变更能力面时读取中央 `decisionRef`。
2. 冻结扩展点契约：输入、输出、生命周期、错误、权限、兼容，并把证据交给 `spec-governance` 单写者。
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
| capabilitySurfaceEvidence | `decisionRef`、宿主/协议/发现/迁移/fallback 证据与未验证边界 |
| evidenceMatrix | 判断 -> 源码 / manifest / README / website / validate / smoke |
```

## 反模式

| 反模式 | 修正 |
|--------|------|
| 只改源文件，不核当前部署 | 执行 source-consumer-sync、当前用户级 receipt/代际/指针与真实加载验证；V8 的源码/legacy 适用范围单列 |
| 扩展点没有生命周期和错误语义 | 补 extensionPointContract |
| 只说“支持多宿主” | 建 hostSurfaceMatrix |
| 公开能力无法被用户发现 | 补 README / website / routing / Profile |

## 与其他 Skill 的关系

- `source-consumer-sync`：平台能力必须同步所有当前消费者和部署副本。
- `host-contract-verification`：Hook/CLI/宿主契约变化需要 direct replay 或 fixture replay。
- `release-verification`：分发面变化进入发布前验证。
