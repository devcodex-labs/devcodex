# 需求：instructions/

**状态**：⬜ 待开发  
**优先级**：P2  
**参考**：`v0.03/instructions/`

## 目标

创建全局 Instructions 文件，自动注入到所有 Agent 会话，约束 AI 行为。

## 文件列表

| 文件 | 编号 | 优先级 | 层级 |
|------|------|--------|------|
| `00-safety.instructions.md` | P2 | 安全底线（S01~S06）| Free |
| `01-common.instructions.md` | P5 | 通用约束（C01~C15）| Free |
| `02-output-paths.instructions.md` | P5 | 产物路径规范 | Free |
| `10-dev.instructions.md` | P4 | dev 工作流规则 | Pro |
| `11-fix.instructions.md` | P4 | fix 工作流规则 | Pro |
| `12-audit.instructions.md` | P4 | audit 工作流规则 | Pro |
| `13-analyze.instructions.md` | P4 | analyze 工作流规则 | Free |
| `14-self-fix.instructions.md` | P4 | self-fix 规则 | Pro |
| `15-memory.instructions.md` | P5 | 记忆写入规则 | Pro |
| `16-report.instructions.md` | P5 | 报告输出规则 | Pro |
| `17-compliance.instructions.md` | P5 | 合规检查规则 | Pro |

## 官方 frontmatter 规范

```yaml
---
applyTo: "**"          # 全局强制注入（DevCodex 策略）
description: "Use when..."  # 推荐，供 on-demand 发现
---
```

> DevCodex 使用 `applyTo: "**"` 确保所有安全底线和工作流规范在任何对话中都生效。

## 核心规范

- 所有文件用**英文**编写
- 文件名格式：`NN-<kebab>.instructions.md`
- `applyTo: "**"` 全局注入
- 单文件 ≤ 500 行

## 验收标准
- [ ] 11 个文件全部创建
- [ ] 均以英文编写
- [ ] 注册在 `plugin.json` instructions 列表中
