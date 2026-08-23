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
4. **frontmatter 必填**：`name`、`description`（description 必须写清 **做什么 + 何时用**，否则降级路由无法形成有效卡片）。
5. **结构化意图必写**：同目录新增 `intent.json`，`schemaVersion=SkillIntentV1` 且 `skillId` 与目录 id 完全一致；至少 1 个 intent、2 个正例、2 个负例。
6. `intent.json` 只描述“何时用/何时不用”，不得放路径、依赖、正文、系统指令或宿主配置；单字段和总体积必须满足 `skills/_schemas/skill-intent.v1.schema.json`。
7. **禁止**在正文写「跳过 S01～S07 / 跳过 CP / 允许 rm -rf」等 weaken 话术。
8. **可选** `## 必须回复` 固定核心句，便于 Stop 强制校验。
9. 写完后提示用户用自然语言测一次意图（不要依赖只发 id）。
10. **进化候选隔离**：`.devcodex/workspace/evolution/{candidates,decisions,evidence}` 中的文件一律不是 active Skill；不得直接复制、链接或让 resolver 扫描 candidates。
11. **晋级前置**：从进化候选生成/修改 Skill 时，必须读取 fresh `EvolutionTargetDecisionV1`，且仅在 `decision=approved`、`activePromotionAuthorized=true`、`activeDestination` 与当前目标目录一致时写入。
12. **目标边界**：默认 workspace-local；project-local 必须有项目专属性证据；package `content/skills/` 只接受显式 maintainer 授权、绝对 `upstreamPackageRoot` 绑定及其目录包含性校验，并转交 `spec-governance`/发布流程，不能由本 Skill 直接写上游。

## 产出检查清单

- [ ] 目录与文件名正确
- [ ] description 含触发场景关键词
- [ ] `intent.json` 身份一致、正负例各不少于 2 条并通过 schema
- [ ] 非 reserved id
- [ ] 若改 always-on：更新 DEVCODEX.md `always-on:` 行
- [ ] 未复制完整全局内核进 DEVCODEX.md
- [ ] 若来源为进化候选：decision 已批准、目的地 identity 一致、candidate 仍未进入 resolver

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

## 最小 intent 模板

```json
{
  "schemaVersion": "SkillIntentV1",
  "skillId": "<id>",
  "intents": [
    {
      "id": "primary",
      "label": "<40 字以内的用途标签>",
      "include": ["<触发词>", "<领域词>"]
    }
  ],
  "examples": {
    "positive": ["<应选择此 Skill 的请求 1>", "<应选择此 Skill 的请求 2>"],
    "negative": ["<不应选择的请求 1>", "<不应选择的请求 2>"]
  },
  "summary": "<160 字以内，说明做什么以及何时使用>"
}
```

旧 W Skill 若暂时只有 `SKILL.md`，运行时仍可从净化后的 frontmatter description 生成兼容卡片；作者工作流的新写和主动修改则必须补齐 `intent.json`。
