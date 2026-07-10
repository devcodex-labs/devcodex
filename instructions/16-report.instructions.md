---
applyTo: "**"
description: 报告输出规则，覆盖路径、命名、结构、ECR 引用与用户面产物路径要求
priority: P5
version: 1.11.33
---
# 报告输出规则（16-report）

> 本文件定义报告的完整规则，含命名、路径、格式约束。

> ⚠️ 当 `<工作区根>/.devcodex/layout.json` 启用 `workspace-namespace` 时，本文中的 `<任务目录>`、`reports/<子目录>/...` 与相关示例都以当前 **`<active-root>`** 为根：
> - 单项目任务：`<工作区根>/.devcodex/<project>/`
> - 全工作区任务：`<工作区根>/.devcodex/workspace/`
> - 未启用 `layout.json`：继续兼容 `<项目根>/.devcodex/`

## 适用范围

- **必须写入报告**：dev / fix / analyze / audit / self-fix
- **豁免报告**：chat（仅更新记忆）

## 路径规则

### 需求级（优先）
关联到 `requirements/` · `bugs/` · `optimizations/` 目录时：
```
<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md
```

> ⚠️ **跨服务需求**：报告路径以**入口服务**的 `.devcodex/` 为根，与 `01-需求确认.md`（历史 `01-需求概述.md` 兼容）同目录树；不拆分到各关联服务目录。

### 项目级（兜底）
```
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

| 工作流 | 子目录 |
|--------|:------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

## 命名规则（FC4 检查）

- `NN` — 当日序号 `01` 起递增（扫描同目录取 max+1）
- `--` — **双横杠**（FC4 不通过条件：使用单横杠）
- `<简述>` — 2~5 中文词或英文单词，连字符分隔

示例：`01--v4规范全面审查.md`、`02--intent修复后再审.md`

## 头部必填项（FC2 检查）

```markdown
# [标题]

> **项目**: [项目名]
> **类型**: [类型]
> **子类型**: [子类型]（无时省略）
> **创建日期**: YYYY-MM-DD HH:MM
> **Agent**: [agent-id]
> **状态**: 进行中 / 已完成
```

> ℹ️ **日期精度规则**：`创建日期` 使用 **`YYYY-MM-DD HH:MM`** 分钟级（便于跨会话定位 + 同一天多报告区分）；目录路径仍用 `YYYYMMDD` 天级（避免目录碎片化）。

### audit 报告额外头部
```markdown
> **审查目标类型**: [规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档 / 发布前审查]
> **审查范围**: [全面体检 / 定向深度 / 修复验证]
> **收敛**: 连续 3 轮有效零发现（仍须满足连续 3 轮零发现；所有子类型统一，不区分定向/全面）
> **ReviewCoverageDelta**: ✅已核验 / ⚠️缺失 / N/A（说明）
> **PCV状态**: ✅已完成 / 🔄进行中
```

### fix 报告须包含
- CP 确认记录表
- 三步扫描结果

### ContextHandoffCard

当报告对应的任务跨会话、跨 Agent、多批次、summary/compact 前、用户要求“传递上下文”、或最终状态不是 ✅ 已完成时，报告必须包含 `ContextHandoffCard`，字段至少覆盖 `source-of-truth`、`confirmed-decisions`、`open-risks`、`next-action`、`blocked-reason`、`must-not-overwrite`、`validation-state` 与 `artifact-links`。已完成且无需交接时写 `ContextHandoffCard: N/A + skipReason`。

### fix.incident 报告额外头部（响应时效审计）
```markdown
> **事件级别**: P0 / P1 / P2
> **事件时间**: YYYY-MM-DD HH:MM:SS（事件首次发现时间，秒级精度）
> **响应时间**: YYYY-MM-DD HH:MM:SS（AI 接手时间）
> **修复时间**: YYYY-MM-DD HH:MM:SS（修复完成时间）
```

## 强制约束

- ⛔ **禁止仅在对话中输出报告**，必须写入文件（FC2 检查）
- ⛔ **禁止覆盖已有报告**，每次会话独立新建文件
- 每条建议/问题必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围）— 与 [`17-compliance.instructions.md`](./17-compliance.instructions.md) §1 输出验证保持一致
- 报告写入后必须执行二次验证（V1~V6，见 `17-compliance.instructions.md`）
- 跨会话/未完成/多批次任务不得缺少 `ContextHandoffCard`；SUMMARY 只能作为索引，不得替代交接卡
- 回复末尾必须输出报告路径（按 `ArtifactLinkSet` 输出主 Markdown 链接与必要 copy fallback，详见 [`02-output-paths.instructions.md`](./02-output-paths.instructions.md) §产物路径输出格式）：
  ```
  - [NN--简述.md](workspace相对路径/.devcodex/reports/.../NN--简述.md)
  绝对路径：E:\...\NN--简述.md
  ```
  > 当前宿主为 Codex Desktop/App、Copilot、未知宿主，或用户反馈无法点击时，必须追加 `绝对路径：` 行；禁止只输出裸文件名。
- C13 只约束新建 DevCodex 规范资产 `.md`；报告不因 C13 强制压缩或拆分，超长报告按可读性、索引导航和项目规范决定是否拆分

### 写入工具选择（v1.9.4+）

| 报告规模 | 推荐工具 | 理由 |
|---------|---------|------|
| 新建报告，预计 ≥ 200 行 | **Write 单次写入** | 避免 Edit 多段写入被 session limit 截断在中间（参见 [`18-spec-radar §G10`](./18-spec-radar.instructions.md) limit 截断恢复未 resume 案例）|
| 新建报告，< 200 行 | Write 或 Edit 均可 | 截断风险低 |
| 已有报告小修订 | Edit | 不动其余内容，最小化变更面 |
| 已有报告大改写 | 新建独立报告（NN+1）+ 头部引用原报告 | 避免覆盖历史（C06）|

## 跨会话报告

| 场景 | 处理 |
|------|------|
| 同一任务跨多会话 | 每次会话创建**独立报告文件** |
| 修复后再审 | 独立文件，头部引用原始审查报告路径 |
| Token 中断恢复 | 新报告标注"恢复自会话 NN" |
