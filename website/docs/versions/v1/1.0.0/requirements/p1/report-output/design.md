# ⑩ 输出报告 — 技术方案

> **需求来源**：[⑩ 输出报告 需求概况](./index)
> **状态**：✅ 已完成
> **关联**：[实施进度](./progress)

---

## 方案概述

输出报告通过 `report` Skill 实现，在工作流执行完毕后写入结构化报告文件。

---

## 核心设计

按 `report` Skill 定义：

### 路径优先级
1. **需求级**：`<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md`
2. **项目级**：`reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md`

### 子目录映射
| 工作流 | 子目录 |
|--------|--------|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| dev (scenario-test) | `scenario-tests/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit | `audit/` |
| self-fix | `self-fix/` |

### 头部必填项
项目 / 类型 / 子类型 / 创建日期 / Agent / 状态

### 命名规则
- `NN`：当日序号从 `01` 起递增
- `--`：双横杠分隔（FC4 检查）
- `<简述>`：2~5 词

---

## 接口 / 文件变更

| 文件 | 角色 |
|------|------|
| `skills/report/SKILL.md` | 报告生成逻辑 |
| `instructions/16-report.instructions.md` | 报告输出规则 |
| `instructions/02-output-paths.instructions.md` | 产物路径规范 |

---

## 风险与约束

- 禁止仅在对话中输出报告，必须写入文件（FC2）
- 禁止覆盖已有报告
- 每条建议附三列验证
- chat 豁免
