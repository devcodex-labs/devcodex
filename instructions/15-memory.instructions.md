---
applyTo: "**"
priority: 3
version: "1.0.0"
source: "v4:specs/memory.md（触发规则部分）"
---

# 记忆写入规则（15-memory）

> 本 Instructions 定义记忆写入的触发时机和约束规则（"何时触发"）。执行能力见 `skills/core/memory.skill.md`（"如何读写"）。

## 触发规则（平台自动注入后由 AI 遵守）

| 时机 | 必须动作 |
|------|---------|
| 收到首条消息 | 创建/追加会话段落，状态 🔄 |
| 每轮用户消息 | 追加对话记录到 📨 字段 |
| 子任务完成（多任务会话）| 追加 `T{N}进度：✅` |
| 超 13 轮预警（SC9 C08）| 写入编码检查点（📦 字段）|
| 报告写入后 | 追加报告路径到 📄 关联报告 |
| 任务结束（N14）| 更新状态为 ✅ |

## 强制约束

- ⛔ **禁止询问用户"是否需要写入记忆"**（C05/S05 — 强制自动写入）
- ⛔ **禁止覆盖已有内容**（C06/S04 — 只能追加，使用增量编辑）
- ⛔ **禁止使用终端命令修改 .md 文件**（C09 — 如 PowerShell `Set-Content`）
- ⛔ **禁止使用 glob/find 扫描 `.ai-memory/`**（隐藏目录会被跳过）

## chat 豁免说明

- chat 工作流豁免**报告**，但**记忆仍须写入**（不豁免 memory）

## 路径构建规则

```
<工作区>/projects/<project>/.ai-memory/clients/<agent>/tasks/YYYYMMDD.md
```

`<agent>` 命名规则（全小写，连字符分隔）：
- 单编辑器：`copilot` / `cursor` / `claude`
- 跨编辑器：`vscode-copilot` / `zed-copilot`
- 无法确定：`unknown-agent`
