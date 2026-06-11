---
name: dev-docs
description: 文档开发子类型规范 — 技术文档/API文档/README 编写规范
---
# Dev Docs Skill

## 触发条件

用户要求编写/更新文档：README、API 文档、架构文档、开发指南、CHANGELOG、迁移指南等。

## 豁免项

- 豁免 `plan-review`（文档任务不需要实施计划审查）
- 豁免 `impact-review`（文档变更不涉及代码影响评估）
- 豁免 CP3（无需实施计划）；必须记录 `CP3: N/A（docs 子类型豁免）`，供 hook/fallback 区分合法豁免与漏确认
- CP2 简化为**文档大纲确认**（不需要完整技术方案）

## 目标文档分流

当任务属于“契约驱动型文档”时，优先先冻结目标文档，再让后续实现或联动产物围绕它落地。

### 何时视为契约驱动型文档

满足任一条件即可：

1. 文档本身定义了对外 API 契约
2. 文档面向前端联调、页面调用或外部调用方
3. 若不先冻结文档，后续实现容易产生接口或交互漂移

### 三种目标文档模式

| 模式 | 适用场景 | 产物形态 |
|------|---------|---------|
| `light-api` | 普通接口说明、调用方说明、轻量联调文档 | Markdown 轻量 API 文档 |
| `frontend-api` | 前端联调、页面/模块接口说明、字段映射说明 | Markdown 前端接口文档 |
| `general-doc` | 架构文档、开发指南、迁移指南、治理说明、运行手册 | Markdown 通用文档 |

## README 专项写作分支

当目标文档是 `README.md` 或承担主使用入口职责的用户使用文档时，优先进入 README 专项分支，并调用 `readme-authoring`：

- 默认第一受众是**用户 / 使用者**
- 快速开始、常见用法、配置与排错必须早于开发/贡献内容
- 章节骨架优先使用 `prompts/project-readme.prompt.md`
- 完成后若需要专项复审，叠加 `audit-readme`

## 文档质量标准

| 维度 | 要求 |
|------|------|
| 结构完整 | 必含：目的/使用者/快速开始/详细说明/示例 |
| 示例可执行 | 代码示例经过验证，可直接运行 |
| 版本同步 | 文档中的 API/配置项与代码实现一致 |
| 链接有效 | 内部/外部链接均可访问 |
| 导航可读 | 所有 Markdown 文档必须包含 `## 目录导航` |
| 翻译等价 | 多语言文档、翻译页或中英文双入口变更时执行 `DocumentationTranslationParityGuard`，核对信息等价、版本号、链接、示例、术语和当前消费者顺序 |
| 正式边界 | README、官网、正式规范页或用户文档执行 `FormalDocsDevCodexBoundary`，不得混入运行时报告、台账口吻、一次性分析或内部待办 |

## API 文档规范

### 轻量 API 文档（`light-api`）

每个公开 API 至少包含：

- 接口用途
- 服务归属
- 模块 / 资源域
- `base path`
- 方法 / 路径
- 参数 / 请求体
- 返回结构
- 错误码（如适用）
- 最小示例

### 前端接口文档（`frontend-api`）

在轻量 API 文档基础上，额外补充：

- 页面 / 模块 / 组件入口
- 调用触发场景
- 登录态 / 鉴权 / 前置依赖
- 页面字段与接口字段的映射关系（如适用）

### 与 `api-verification` 的边界

- `dev-docs` 负责阅读型目标文档
- `api-verification` 负责归档级、可执行的接口验证双产物
- 当用户只要求接口说明或前端联调文档时，不强制生成 `.http + .cjs`
- 当需求明确进入接口验收、回归验证或正式归档时，再联动 `api-verification`

## 通用文档规范（`general-doc`）

当任务不属于契约驱动型接口文档，而是以下类型时，优先使用通用文档模板：

- 架构文档
- 开发指南
- 迁移指南
- 治理说明
- 运行手册

## 文档同步守门

- `CodeTruthRequirementGate`：写“已支持 / 已接入 / 未接入 / 已实现”前先核对代码真相源、命令输出或当前消费者。
- `DocumentationTranslationParityGuard`：同步多语言、翻译页、README 与 website 入口时，必须核对语义等价和导航/索引顺序。
- `FormalDocsDevCodexBoundary`：正式用户文档只呈现稳定使用信息；运行时台账、审查报告、临时分析和内部治理噪声保留在 `.devcodex/**`。
- `ManualReviewEvidenceRetention`：人工文档复核或链接/视觉抽查要留范围、输入和证据；不得只写“已人工检查”。

## 产出物

- 文档文件（按项目目录结构放置）
- 契约驱动型文档优先使用 `prompts/light-api-doc.prompt.md` 统一骨架
- README / 主用户使用文档优先使用 `readme-authoring` + `prompts/project-readme.prompt.md`
- 非契约驱动型 Markdown 文档优先使用 `prompts/general-doc.prompt.md`
- 若更新 README/CHANGELOG：执行 `document-sync` 确认同步状态
