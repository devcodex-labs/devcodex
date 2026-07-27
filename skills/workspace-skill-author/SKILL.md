---
name: workspace-skill-author
description: >
  编写、生成、修改工作区 skill（SKILL.md）或 .devcodex/workspace/DEVCODEX.md 时使用。
  触发：「写 skill」「创建 workspace skill」「改 DEVCODEX.md」「优化 skill description」、
  「帮我写一个…skill」。不要用于普通业务开发任务。
---
# workspace-skill-author

## 必须遵守

1. **W skill 路径**：`<workspace>/.devcodex/workspace/skills/<id>/SKILL.md`（文件名必须是 `SKILL.md`）。
2. **入口路径**：`<workspace>/.devcodex/workspace/DEVCODEX.md`（不要写到仓库根）。
3. **id 规则**：`[A-Za-z0-9][A-Za-z0-9._-]*`；**禁止** reserved：`compliance`、`cp-gate`、`intent`、`token-check`、`user-visible-output-contract`、`host-capability-routing`、`execution-contract`、`repair-prevention-assessment`。
4. **frontmatter 必填**：`name`、`description`（description 必须写清 **做什么 + 何时用**，否则意图路由选不中）。
5. **禁止**在正文写「跳过 S01～S07 / 跳过 CP / 允许 rm -rf」等 weaken 话术。
6. **可选** `## 必须回复` 固定核心句，便于 Stop 强制校验。
7. 写完后提示用户用自然语言测一次意图（不要依赖只发 id）。

## 产出检查清单

- [ ] 目录与文件名正确
- [ ] description 含触发场景关键词
- [ ] 非 reserved id
- [ ] 若改 always-on：更新 DEVCODEX.md `always-on:` 行
- [ ] 未复制完整全局内核进 DEVCODEX.md

## 最小 SKILL 模板

```markdown
---
name: <id>
description: >
  当用户…时使用。不要用于…
---
# <id>

## 必须回复
- <可选固定句>

## 步骤
1. …
```
