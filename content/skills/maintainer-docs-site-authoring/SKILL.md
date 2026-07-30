---
name: maintainer-docs-site-authoring
description: 维护者/贡献者开发站点文档写作 Owner — 本地开发、贡献、测试、发版 runbook、internals/ADR；与用户使用站不等价；写文档时经 DocsAudienceIntent 路由。
---

# Maintainer Docs Site Authoring Skill

## 职责

当任务主受众是**维护本仓库 / 贡献代码的人**时，本 Skill 是写作入口。

成功标准：读者能 **clone → 环境 → 开发命令 → 测试 → 贡献/发版 → 改文档**。  
禁止把本 Skill 当作用户安装/接入手册。

## 触发条件

| 场景 | 是否触发 |
|------|:--------:|
| `docsAudience=maintainer-dev`（DocsAudienceIntentGate） | 必须 |
| 维护者开发站、contributing、本地开发、发版 runbook、internals、ADR | 必须 |
| 用户使用/安装/quick start/公开用户站 | N/A → `user-manual-authoring` |
| 仅说「写文档站」且 ambiguous | N/A → 阻断消歧，禁止开写 |

## 文档契约

| 字段 | 要求 |
|------|------|
| `primaryAudience` | 维护者 / 贡献者 |
| `docsSurface` | 默认 `maintainer`（可含 contributing/internals） |
| `maintainerJourney` | clone → env → dev → test → contribute/release → docs |
| `executableCommands` | 至少给出可复制的安装依赖与测试/构建命令（与 package 一致或标明 N/A） |
| `repoMap` | 关键目录/包职责（简短，不作用户产品叙事） |
| `developerInfoPlacement` | 主叙事即开发；用户安装路径不得抢首屏 |
| `consumerMap` | CONTRIBUTING、docs/dev、website maintainer 分区、Profile 脚本说明等 |

## 主路径章节（推荐）

1. 仓库如何检出与分支约定  
2. 环境与依赖  
3. 常用开发/测试/构建命令  
4. 贡献流程（PR、检查项）  
5. 发版/runbook（若适用）  
6. 文档与规范如何改、如何验证  
7. 可选：架构/ADR 索引（后置或独立页）

## 禁止

- 禁止冒充最终用户使用手册（无 install-as-user 主路径而写「适合谁使用本产品」首屏）。  
- 禁止用产品广告替代 clone/test 命令。  
- 禁止在单任务内同时交付用户站主路径并宣称用户站完成（多受众须拆任务）。  
- CONTRIBUTING 文件**可选**；本 Skill 提供结构，不强制每个项目生成文件。

## 完成前自检

- 运行 `classifyDocsAudienceDriftSample('maintainer-dev', body)` 语义等价检查：须有 dev 路径。  
- 与 `package.json` scripts / README 开发段不矛盾。  
- 审查：`audit-document` 维护者站维；用户侧污染检查不适用于主路径。

## 与其他 Skill

- `user-manual-authoring`：用户站；受众正交。  
- `dev-docs`：架构/API 技术文可联动；**不**替代本 Skill 的维护者站入口。  
- `document-sync`：consumerMap 标注 `audience=maintainer-dev`。  
- `DocsAudienceIntentGate`：`scripts/lib/docs-audience-intent.js`。

## 验证

```bash
npm run test:docs-audience
```
