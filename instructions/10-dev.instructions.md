---
applyTo: "**"
---
# 开发工作流规则（10-dev）

> 本文件定义 dev 工作流的完整规则，含 8 个子类型和 CP 门控。

## 子类型路由

| 意图 | 子类型 | 授权 |
|------|--------|------|
| 重构/refactor/结构变更 | refactor | Free |
| 数据库/db/migration/Schema | database | ⚠️ Pro |
| 初始化/init/新项目 | init | Free |
| 性能/optimize/优化指标 | optimization | ⚠️ Pro |
| 测试/scenario-test/压测 | scenario-test | ⚠️ Pro |
| 文档/docs/README/注释 | docs | Free |
| 方案评审/plan-review/review | plan-review | Free |
| 默认（新功能/需求）| default | Free |

- optimization/scenario-test 前置条件：`api-verification` 已通过，否则阻断并提示

## C12 合理性评估（必须执行）

- 有更好方案 → 提出并等待确认后再执行
- 明显不合理 → 先指出问题再等用户澄清
- 用户给出判断或引用已有设计 → AI 须独立验证合理性，不得直接顺从论证
- 不得在 C12 前直接开始编码

## 任务切换与提交护栏

- 在 dev 会话中，若用户请求与当前已推进的需求明显不一致，应先按 `01-common` 的“意图优先、关键词兜底”顺序判断是否属于新需求切换。
- 仅当判断为新需求切换，且工作区存在未提交变更时，才提醒用户是否先提交当前变更；不得把同一需求的连续迭代误判为必须中断。
- 用户明确要求提交时，commit subject 必须是一句简洁描述，只保留本次主变更，不得把整段会话摘要直接作为提交标题。

## CP 门控（C02 约束，严格按序）

```
CP1（需求确认）→ CP2（方案确认）→ plan-review → [impact-review] → CP3（实施计划）→ 执行
```

### CP 定义

| CP | 名称 | 必须？ | 目的 |
|:--:|------|:------:|------|
| CP1 | 需求确认 | 🔴 必须 | 确认 AI 理解与用户一致 |
| CP2 | 方案确认 | 🔴 必须 | 确认技术方案可行后再编码 |
| CP3 | 实施计划确认 | 🔴 必须 | 确认实施计划后开始逐文件执行 |

### CP 执行规则

1. **严格按序**：CP1 → CP2 → CP3，不得跳过中间步骤
2. **禁止合并**：不得将 CP1+CP2 合并为一次输出
3. **每个 CP 独立确认**：输出后必须等待用户明确响应
4. **产物文件前置创建**：CP1 → `01-需求概述.md`；CP2 → `02-技术方案.md`

### CP 响应处理

| 用户响应 | 处理方式 |
|---------|---------|
| ✅ 确认 | 进入下一阶段 |
| ✏️ 修正 | 应用修正后重新输出当前 CP，等待再次确认 |
| ❌ 拒绝 | 回退到当前 CP 重新分析 |
| ？追问 | 回答后重新输出当前 CP，等待确认 |
| 🔀 模糊 | **不得推进**，必须明确询问再等待显式响应 |

### 全自动模式（@devcodex-auto）

- CP1/CP2/CP3 确认**自动通过**
- S01~S06 / C01 / C10 **不可豁免**
- 可恢复失败：重试 ≤ 2 次；不可恢复失败：通知用户 ⚠️

## plan-review 质量门禁（CP2→CP3 强制）

非 docs/plan-review/scenario-test 子类型后必须执行 PR-1~PR-6 检查。🔴 阻断时回 CP2 重确认。

### PR-1 需求完整性 🔴
- 方案覆盖 CP1 确认的所有需求点
- 边界条件已识别（空值/超大输入/并发/断网）
- 错误处理路径已设计

### PR-2 技术可行性 🔴
- 技术选型与项目 profile 技术栈一致
- 依赖可安装，无模糊"待定"步骤

### PR-3 约束合规性 🔴
- 无硬编码敏感信息（S02）
- 不可逆操作有确认步骤（S01）
- 不违反项目 profile 架构约束

### PR-4 性能与安全隐患
- N+1 查询/循环 I/O → 🟡 标注
- 未加权限的敏感操作 → 🔴 阻断

### PR-5 影响评估前置标记
| # | 检查项 | 触发路径 |
|:-:|--------|----------|
| ① | 对外 HTTP API 变更 | EXEC 后 → api-verification |
| ② | 跨模块架构依赖变更 | → impact-review（CP3 前） |
| ③ | 数据库 Schema 变更 | → database 子类型流程 |

### PR-6 架构质量视角（C15）
三维评估：可扩展性 / 可维护性 / 易上手性。未达标须说明原因并记录改善方向。

## 影响评估触发条件（IMPACT_REVIEW）

- **仅**由 PR-5②"跨模块架构依赖变更"触发
- PR-5① 对外接口变更 → EXEC 后走 api-verification（不进 impact-review）
- PR-5③ 数据库 Schema 变更 → 走 database 子类型（不进 impact-review）

## 执行约束

- 逐文件执行，编码后必须运行 lint/typecheck/test
- error 最多 2 次迭代；2 次仍失败 → 停止，输出错误摘要标 ⚠️
- 涉及 HTTP 接口变更 → 生成双产物（.http + .cjs）
- 涉及源码/配置文件变更 → 检查四类文档同步（STATUS/CHANGELOG/TASK-INDEX/README）

## 代码风格

- dev 工作流进入前必须读取项目 `profile/03-代码风格.md`
- 项目 profile 优先于默认值

## 子类型专属规则

### default（新功能开发）
- 五阶段执行：N1 需求确认 → N2 技术方案 → N3 方案验证 → N4 实施计划 → N5 执行
- 无特殊豁免，完整走 CP1→CP2→CP3

### refactor（重构）
- 前置检查：被重构模块必须有测试覆盖，无测试时**禁止继续**，优先补测试
- 基线快照：记录当前接口签名、导出列表、公开 API
- 最小增量重构，每步可独立回滚
- 禁止在重构中混入功能变更（行为不变原则）
- 重构 vs 优化边界：重构 ≡ 结构/可读性变更；优化 ≡ 性能/资源改善

### database（数据库）⚠️ Pro
- Migration 安全策略：
  - 新增列：DEFAULT 或 NULLABLE，禁止 NOT NULL 无默认值
  - 删除列：先废弃（rename），至少一版本后再删除
  - 修改列类型：评估存量数据兼容性，准备回滚脚本
  - 新建索引：CONCURRENTLY（PG）或 ALGORITHM=INPLACE（MySQL）
- CP2 必须包含：Schema ER 图 / 变更前后对比表 / 回滚方案
- 🔴 禁止在 Migration 中写业务逻辑
- 🔴 大表（>100万行）变更必须评估锁时间

### init（项目初始化）
- 跳过 CP3 和 plan-review
- init 完成后**必须**创建 `.devcodex/profile/`（README + 01~03）
- 生成的 .gitignore 必须包含 `.devcodex/.memory/`

### optimization（性能优化）⚠️ Pro
- 前置条件：api-verification 已通过 + 有基准数据 + 测试环境隔离
- 默认工具：autocannon
- 🔴 禁止无基线数据的"盲优化"
- 优化不改变外部接口行为

### scenario-test（场景测试）⚠️ Pro
- 前置条件：api-verification 已通过 + 测试环境就绪
- 负载测试默认工具：artillery
- 测试数据使用 fixtures，禁止依赖生产数据

### docs（文档开发）
- 豁免 plan-review / impact-review / CP3
- CP2 简化为**文档大纲确认**
- 文档质量标准：结构完整 / 示例可执行 / 版本同步 / 链接有效

### plan-review（方案评审）
- 豁免 plan-review（防递归）
- 本身即为审查工作流
