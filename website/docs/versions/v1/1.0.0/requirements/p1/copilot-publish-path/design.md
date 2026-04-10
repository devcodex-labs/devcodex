# GitHub Copilot 发布路径评估（Marketplace / MCP）— 技术方案

> **需求来源**：[GitHub Copilot 发布路径评估（Marketplace / MCP）需求概况](./index)
> **状态**：🔄 待确认

---

## 方案概述

本方案将 DevCodex 的发布路径拆成三个候选方向进行评估，并在当前项目形态基础上给出明确推荐：

1. **历史 Copilot Extensions 路径**：仅作为历史兼容/背景说明，不作为当前推荐实施路线。
2. **GitHub Marketplace App 路径**：官方仍支持，但它面向 GitHub App / OAuth App 分发，不适合当前 DevCodex 直接原样上架。
3. **MCP / 现有包分发路径**：当前不作为实施路线，只作为后续演进方向记录。

结论先行：**当前 DevCodex 不适合直接定义为 GitHub Marketplace App；本轮应继续维持现有包分发，不进入 MCP 模式实施，但需在方案中清晰记录 MCP 的后续演进方向。**

---

## 官方事实与项目现状

### 1. 官方事实

| 事实 | 依据 | 含义 |
|------|------|------|
| GitHub Copilot Extensions（基于 GitHub App）已于 2025-11-10 全量 sunset | GitHub 官方 changelog `Sunset notice: GitHub App-based Copilot Extensions` | 旧 Copilot Extensions 路线不能作为 2026 新发布主路径 |
| 新建 server-side Copilot Extensions 自 2025-09-24 起已被阻止 | 同一官方 changelog | 当前不能再按旧模型创建新的服务端 Copilot Extensions |
| GitHub Marketplace for apps 仍然存在完整发布流程 | GitHub Docs `About GitHub Marketplace for apps`、`Requirements for listing an app`、`Submitting your listing for publication` | Marketplace App 上架本身仍受支持 |
| GitHub 推荐 GitHub App 作为官方集成方式 | `About GitHub Marketplace for apps` | 若走 Marketplace，需要先成为真正的 GitHub App / OAuth App 产品 |

### 2. 当前项目现状

| 项目事实 | 依据 | 含义 |
|------|------|------|
| DevCodex 当前是 npm 包 + CLI 分发模式 | `package.json` 中 `bin.devcodex`、`publishConfig.registry=https://npm.pkg.github.com` | 当前主要交付形态是包安装，不是 GitHub App |
| `plugin.json` 是 DevCodex 内部元数据，不是 GitHub 官方 Marketplace manifest | `plugin.json` 注释已明确 `NOT a GitHub Copilot official format` | 不能把现有 `plugin.json` 直接当成上架元数据 |
| 当前仓库没有 GitHub App 必备形态，如 App 设置、Webhook 接收服务、安装后端、Marketplace 计费事件处理 | 仓库结构与源码现状 | 当前不满足 Marketplace App 的产品前提 |
| `.mcp.json` 中 MCP server 仍是占位且全部 disabled | `.mcp.json` | MCP 方向是规划中，不是现成可发布成品 |

---

## 候选路径评估

### 路径 A：历史 GitHub Copilot Extensions / 插件市场

**结论**：不推荐，且不应作为实施目标。

原因：

- 官方已经 sunset，且新建能力已关闭。
- 即使存在历史文档或旧概念，也不能作为 2026 的有效发布主路径。
- 继续围绕该路径设计工程改造，会导致方案失效。

### 路径 B：GitHub Marketplace App

**结论**：官方支持，但当前 DevCodex 不适合直接走这条路。

该路径要求产品首先是一个 GitHub App / OAuth App，而不只是一个本地 CLI 包。按照官方流程，至少需要：

1. 一个可被安装的 GitHub App 或 OAuth App。
2. 面向用户的应用功能入口。
3. 隐私政策、支持链接、描述、图像、定价等 listing 资料。
4. 若是付费方案，还需要组织验证、计费与 `marketplace_purchase` 事件处理。

当前 DevCodex 的问题在于：

- 它主要运行在用户本地项目中，通过 `init/update` 复制规则文件。
- 它没有 GitHub App 的安装-授权-回调模型。
- 它没有 SaaS 服务或 GitHub 平台内运行面。

因此，**如果不先把 DevCodex 产品形态升级为 GitHub App/SaaS，直接讨论 Marketplace 上架没有落点。**

### 路径 C：现有包分发 + MCP 演进方向

**结论**：当前不实施，仅保留为后续演进方向。

当前按用户要求，不把这一路线作为本轮实施目标，只做方向性记录：

#### 当前阶段：继续现有包分发

- 保持 npm / GitHub Packages 分发。
- 保持 `README`、文档站、仓库发布页作为主要发现与安装入口。
- 这是与当前项目形态完全一致、最少返工的发布方式。

#### 后续演进方向：条件成熟后再评估 MCP

- 将当前规则、记忆、鉴权等能力逐步外置为真正可运行的 MCP server。
- 再对接 GitHub 当前推荐的 MCP 生态，而不是复活已弃用的 Copilot Extensions。
- 该路线与仓库内 v2 文档中“Remote MCP / MCP 动态化迁移”的演进方向一致。
- 但本轮不进入 MCP server 开发、部署或接入实施。

---

## 推荐方案

### 推荐结论

采用 **“当前继续包分发，MCP 只保留为后续演进方向”** 的路线：

1. **当前主发布路径**：继续以 npm / GitHub Packages / 仓库文档站分发 DevCodex。
2. **后续演进方向**：未来若产品形态与投入优先级允许，再将 DevCodex 演进为真正的 MCP 服务。
3. **不作为当前主目标**：GitHub Copilot Extensions 历史路径。
4. **仅在产品形态改变后再考虑**：GitHub Marketplace App 上架。

### 不推荐直接走 Marketplace 的原因

| 原因 | 说明 |
|------|------|
| 产品形态不匹配 | 当前是 CLI/规则包，不是 GitHub App |
| 工程缺口大 | 缺少安装模型、Webhook 服务、计费/支持/隐私材料 |
| 发布收益不成立 | 即使完成 listing，用户价值链也与当前安装方式不一致 |

---

## 最小改造建议

### 若未来转向 MCP

至少补齐：

1. 可运行的 MCP server，而非占位 `.mcp.json`。
2. 清晰的工具/资源协议定义。
3. 鉴权与租户模型落地。
4. 客户端接入说明与部署方式。

### 若要转向 GitHub Marketplace App

至少补齐：

1. GitHub App 产品模型与安装流程。
2. 后端服务与 webhook 处理。
3. 用户支持、隐私政策、应用描述、图像等 listing 资产。
4. 若付费，还需组织验证与 Marketplace 计费事件处理。

---

## 实施边界

本 CP2 只确认发布路线，不直接进入：

- GitHub App 开发
- MCP server 开发
- Marketplace listing 材料制作
- 发布脚本与自动化上线

这些内容应在后续 CP3/新需求中按选定路线展开。

### 本轮补充边界

- 已记录 MCP 为后续演进方向，但当前不启动 MCP 模式。
- 后续若要真正推进 MCP，应另开明确需求，不与本轮发布路径评估混做。

---

## 验证方案

1. 用官方文档核对“Copilot Extensions 已弃用”与“Marketplace App 仍支持”两项事实。
2. 用项目现状核对 DevCodex 是否已具备 GitHub App / MCP server 必备能力。
3. 验证推荐路线是否与当前产品形态、仓库演进方向和实施成本一致。