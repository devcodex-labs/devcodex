---
name: report
description: 生成并写入工作流执行报告。适用于 dev/fix/analyze/audit/self-fix（chat 豁免）。
---
## 报告路径

### 需求级（优先）

任务关联到 `requirements/` · `bugs/` · `optimizations/` 目录时：
```
<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md
```

### 项目级（兜底）

```
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

| 工作流 | 默认子目录 |
|--------|:----------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

> 路径详细规范见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md)。

## 头部必填

```markdown
# [标题]

> **项目**: [项目名]
> **类型**: [类型]
> **子类型**: [子类型]（无子类型时省略此行）
> **创建日期**: YYYY-MM-DD
> **Agent**: [agent-id]
> **状态**: 进行中 / 已完成
```

## 命名规则

| 组件 | 规则 |
|------|------|
| `NN` | 当日序号，从 `01` 起递增（扫描同目录取 max+1）|
| `--` | **双横杠**（非单横杠），分隔序号与简述（[FC4](../compliance/SKILL.md) 检查） |
| `<简述>` | 2~5 个中文词或英文单词，连字符分隔 |

示例：`01--v4规范全面审查.md`、`02--intent修复后再审.md`

## 工作流专属字段

### audit 报告额外头部

```markdown
> **审查目标类型**: [规范文件 / 技术方案 / 需求文档 / 项目工程 / 报告 / 通用文档]
> **审查范围**: [全面体检 / 定向深度 / 修复验证]
> **收敛**: R{N}+R{N+1} 连续 N 轮零新发现
> **PCV状态**: ✅已完成 / 🔄进行中
```

### fix 报告须包含

- CP 确认记录表（CP1→CP2→CP3 状态，格式见 [`cp-gate`](../cp-gate/SKILL.md)）
- 三步扫描结果（同类全局扫描 / 数据联动扫描 / grep 零残留复核）

## 输出规则

- 每次会话必须写入报告文件（**chat 豁免**，[C05/S05](../../instructions/00-safety.instructions.md)）
- 报告中每条建议/问题必须附五项验证（合理性 + 可实施性 + 收益 + 验证状态 + 影响范围）— 与 [`17-compliance`](../compliance/SKILL.md) §1 输出验证保持一致
- 报告写入后必须执行 [`compliance`](../compliance/SKILL.md) Skill §5 二次验证（V1~V6）
- 报告末尾引用本次会话记忆路径
- 回复末尾必须输出产物文件路径（双行格式：第一行**相对路径**Markdown 链接 + 第二行**绝对路径**纯文本，详见 [`02-output-paths.instructions.md`](../../instructions/02-output-paths.instructions.md) §产物路径输出格式，[FC5](../compliance/SKILL.md)）

## 行数限制

- ≤ 500 行（[C13](../../instructions/01-common.instructions.md)）；超出拆分

## 写入工具选择（v1.9.4+）

新建报告预计 ≥ 200 行 → **Write 单次写入**（避免 Edit 多段写入被 session limit 截断；详见 [`16-report.instructions.md §写入工具选择`](../../instructions/16-report.instructions.md)）。已有报告小修订 → Edit。

## 跨会话报告

| 场景 | 处理 |
|------|------|
| 同一任务跨多会话 | 每次会话创建**独立报告文件**，不追加到前一份 |
| 修复后再审 | 独立文件，头部引用原始审查报告路径 |
| Token 中断恢复 | 新报告标注"恢复自会话 NN" |

## 模板引用

| 报告类型 | 模板 |
|---------|------|
| 分析报告 | `prompts/report-analysis.prompt.md` |
| 审查报告 | `prompts/report-audit.prompt.md` |
| 规范自修复报告 | `prompts/report-audit.prompt.md`（结构相同，路径映射 `self-fix/`）|
| 开发报告 | `prompts/report-dev.prompt.md` |
| 开发报告（性能优化） | `prompts/report-optimization.prompt.md` |
| 开发报告（场景测试） | `prompts/report-scenario-test.prompt.md` |
| 修复报告 | `prompts/report-fix.prompt.md` |

