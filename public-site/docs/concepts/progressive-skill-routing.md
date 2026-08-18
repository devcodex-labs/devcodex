# 渐进 Skill 路由

## 你在问什么

仓库里有很多 Skill，会不会一次全加载？不会。只加载匹配当前工作流和阶段的那一批。

## 心智模型

Skill 提供专业流程，工作流提供边界。看到 Skill 目录或 catalog，不等于正文已经进模型。

公开理解可以分成四类：Workflow、Domain、Delivery & Governance、Workspace。精确数量以首页和 README 的投影为准，摘要用 80+。

## 示例

`analyze` 任务通常加载分析和报告相关 Skill，不会为了「可能以后要修」提前加载修复实现链。

项目自己的清单和约定放在 Workspace Skill，只在该工作区生效。

## 边界

- 加载某个 Skill 不会把 `analyze` 变成可以改文件的 `fix`。
- gray Skill 不是 active，不能当成已对用户承诺的能力。
- 宿主不支持的 Hook 或 MCP，Skill 写了也执行不了。见 [宿主边界](/reference/hosts)。

## 相关页

[Skill 参考](/reference/skills) · [架构怎么跑](/concepts/architecture) · [证据与完成](/concepts/evidence-and-completion)
