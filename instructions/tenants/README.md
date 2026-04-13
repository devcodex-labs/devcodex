# Tenant Customization Instructions

> **目录路径**: `instructions/tenants/`  
> **加载机制**: `01-common.instructions.md` §NODE_META 读取规则 第1优先级  
> **优先级**: P3（高于默认工作流规范 P4，可被项目 profile 和用户当前指令覆盖）

## 用途

租户定制 Instructions 允许特定团队/项目在不修改 DevCodex 核心规范的前提下，覆盖或扩展工作流行为。每个租户对应一个子目录，通过 `tenant-id` 标识。

## 目录结构

```text
instructions/tenants/
├── README.md                          ← 本文件（说明文档）
├── <tenant-id>/                       ← 租户目录（以租户标识命名）
│   ├── *.instructions.md              ← 覆盖规范（applyTo 自动注入）
│   └── README.md                      ← 可选：该租户定制说明
```

## 命名规范

| 项目 | 规则 |
|------|------|
| 目录名 | 小写字母 + 连字符，如 `my-team`、`project-alpha` |
| 文件名 | 与覆盖目标对应，如 `10-dev.instructions.md` 覆盖 dev 工作流规则 |
| frontmatter | 必须包含 `applyTo` 字段（建议精确匹配，不使用 `**`） |

## frontmatter 格式

```yaml
---
applyTo: "**"
---
# 租户名称 — 工作流定制
```

> ⚠️ 租户 Instructions 通过 `applyTo` 全局注入，AI 会自动读取并以 P3 优先级应用，无需手动激活。

## 覆盖范围

租户 Instructions 可覆盖：
- 工作流规则（CP 门控、执行约束）
- 代码风格（补充 profile/03-代码风格.md）
- 合规检查项（豁免或收紧某些 FC/SC 条目）
- 术语定义（业务特定术语）

租户 Instructions **不可覆盖**：
- S01~S06 安全底线（P2 级，不受 P3/P1 影响）
- C10 危险命令禁止执行

## 优先级说明

```text
P1 用户当前会话指令
  ↓ 可被 P1 覆盖
P2 安全底线 S01~S06（不可被任何层覆盖）
  ↓
项目 profile（.devcodex/profile/）
  ↓ 可被 profile 覆盖
P3 租户定制（本目录，当前优先级）
  ↓ 可被 P3 覆盖
P4 默认工作流规范（10-dev、11-fix 等）
  ↓ 可被 P4 覆盖
P5 01-common 通用规范（兜底）
```

## 示例：缩短 CP 响应等待

```yaml
---
applyTo: "**"
---
# my-team — 快速迭代模式

> 覆盖 10-dev §CP 门控：本团队使用快速迭代模式

## CP 响应处理（覆盖默认规则）

- 🔀 模糊响应：按"确认"处理，在回复末尾标注 ⚠️ 自动推进
- ✏️ 修正：应用修正后直接推进，不重新输出当前 CP
```
