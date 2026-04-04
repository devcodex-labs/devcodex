# v4 → v5 迁移

DevCodex v5 是 [ai-dev-guidelines v4](https://github.com/vextjs/ai-dev-guidelines) 的插件化封装，核心规范体系不变，主要变化是**使用方式**和**文件结构**。

## 主要变化

### 1. 单入口 Agent（最大变化）

**v4**：8 个独立 Agent，在 Copilot Chat 中需手动选择：
```
@dev @fix @audit @analyze @self-fix @chat @resume @plan
```

**v5**：1 个统一入口，自动路由：
```
@DevCodex  （自动识别意图，路由到对应工作流）
```

### 2. 安装方式

**v4**（手动复制）：
```bash
# 克隆 ai-dev-guidelines 仓库，手动复制 specs/ 到项目
```

**v5**（npm 包）：
```bash
npm install --save-dev @vextjs/devcodex
npx @vextjs/devcodex init
```

### 3. 文件路径格式

**v4** Skill 引用格式：
```
skills/dev/dev-default.skill.md
skills/audit/audit-common.skill.md
```

**v5** Skill 引用格式：
```
skills/dev/dev-default/SKILL.md
skills/audit/audit-common/SKILL.md
```

### 4. 记忆文件路径

**v4**：
```
.copilot/memory/YYYYMMDD.md
```

**v5**：
```
.devcodex/.ai-memory/clients/<agent>/tasks/YYYYMMDD.md
```

## 迁移步骤

### Step 1：安装 DevCodex v5

参考[安装配置](/guide/installation)完成 GitHub Packages 认证和 `init`。

### Step 2：移除旧的 v4 规范文件

```bash
# 删除旧的 .github/agents/ .github/skills/ 等（由 v4 手动复制的文件）
# DevCodex init 会覆盖为 v5 格式
```

### Step 3：更新自定义 Instructions（如有）

如果你有基于 v4 定制的 Instructions，需要更新引用：
- 将 `.skill.md` 格式改为 `/SKILL.md` 格式
- 将 `@dev` / `@fix` 等引用改为 `@DevCodex`

### Step 4：迁移记忆文件（如需保留历史）

将 v4 的记忆文件手动复制到 v5 的路径格式：
```
.copilot/memory/ → .devcodex/.ai-memory/clients/copilot/tasks/
```

## 行为差异说明

| 功能 | v4 | v5 |
|------|----|----|
| Agent 入口 | `@dev` / `@fix` 等 8 个 | `@DevCodex`（统一） |
| 工作流切换 | 手动指定 | 自动路由 |
| 离线使用 | 需要 ai-dev-guidelines 仓库 | npm 包安装后本地离线 |
| MCP Server | 规划中（v4.x）| 规划中（v5.1）|
| 多租户 | tenants/ 目录定制 | Enterprise 层（规划中）|

## 保持不变的部分

- CP 流程（CP1 → CP2 → plan-review → CP3 → 执行）
- P2 安全底线（S01~S06）
- 记忆文件格式（字段名、会话段落结构）
- 报告路径规范
- 合规检查项（SC1~SC13）
