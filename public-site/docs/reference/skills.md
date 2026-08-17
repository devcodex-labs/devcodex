# Skill

当前机器事实为 **86 个 Skill（83 active + 3 gray）**。公开摘要使用 **80+**；精确计数、生命周期与冲突关系由仓库 portfolio 生成和验证。

## 四类公开理解方式

| 类型 | 解决什么问题 |
|------|--------------|
| Workflow Skill | 实现开发、修复、分析、审查等主流程 |
| Domain Skill | 提供架构、安全、数据、前后端、性能等专业判断 |
| Delivery & Governance Skill | 负责测试、文档、发布、报告、质量与交付闭环 |
| Workspace Skill | 保存项目或团队自己的流程、清单和知识 |

DevCodex 只加载当前任务和阶段需要的 Skill。看到 Skill 目录或 catalog 不等于正文已经加载；最终能力仍受宿主的 Hook、MCP、权限与生命周期事件限制。

## 添加 Workspace Skill

在项目或 workspace 的 DevCodex 运行态下创建：

```text
<项目根目录>/.devcodex/workspace/skills/<id>/
├── SKILL.md
└── intent.json
```

`SKILL.md` 写目标、步骤、输入输出和边界；`intent.json` 写可验证的触发语义。Workspace Skill 只影响其所在项目或 workspace。

最小示例：

```md
---
name: release-check
description: 当用户准备发布版本、检查 changelog、tag 或 npm publish 时使用。
---

# release-check

1. 检查版本、变更记录和发布分支。
2. 运行项目约定的测试与打包命令。
3. 输出发布前风险和下一步。
```

```json
{
  "schemaVersion": "SkillIntentV1",
  "skillId": "release-check",
  "intents": [{
    "id": "release",
    "label": "发布检查",
    "include": ["发布", "release", "tag", "npm"]
  }],
  "summary": "发布前检查版本、changelog、tag、测试、打包和发布风险。"
}
```

DevCodex 不扫描、复制、合并、覆盖或删除 Codex、Claude Code 等宿主自己的原生 Skill 和个人配置。需要六宿主共享时使用 Workspace Skill；只服务单一宿主时继续使用该宿主原生机制。
