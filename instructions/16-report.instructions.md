---
applyTo: **
---
# 报告输出规则（16-report）

> 本 Instructions 定义报告的命名、路径、输出格式约束。生成能力见 `skills/core/report/SKILL.md`。

## 适用范围

- **必须写入报告**：dev / fix / analyze / audit / self-fix
- **豁免报告**：chat（仅更新记忆）

## 路径规则（唯一信源）

### 需求级（优先）
关联到 `requirements/` · `bugs/` · `optimizations/` 目录时：
```
<任务目录>/reports/<agent>/YYYYMMDD/NN--<简述>.md
```

### 项目级（兜底）
```
reports/<子目录>/<agent>/YYYYMMDD/NN--<简述>.md
```

| 工作流 | 子目录 |
|--------|:------:|
| dev | `requirements/` |
| dev (optimization) | `optimizations/` |
| fix | `bugs/` |
| analyze | `analysis/` |
| audit / self-fix | `audit/` |

## 命名规则（FC4 检查）

- `NN` — 当日序号 `01` 起递增（扫描同目录取 max+1）
- `--` — **双横杠**（FC4 不通过条件：使用单横杠）
- `<简述>` — 2~5 中文词或英文单词，连字符分隔

## 强制约束

- ⛔ **禁止仅在对话中输出报告**，必须写入文件（FC2 检查）
- ⛔ **禁止覆盖已有报告**，每次会话独立新建文件
- 每条建议/问题必须附三列验证（合理性 + 可实施性 + 收益）
- 报告写入后必须执行二次验证（V1~V6，见 `compliance` Skill §5）
- 回复末尾必须输出报告路径（FC5 检查）：
  ```
  file:///完整路径/NN--简述.md
  完整路径/NN--简述.md
  ```

## 头部必填项（FC2 检查）

```markdown
> **项目**: [项目名]
> **类型**: [类型]
> **子类型**: [子类型]（无时省略）
> **创建日期**: YYYY-MM-DD
> **Agent**: [agent-id]
> **状态**: 进行中 / 已完成
```
