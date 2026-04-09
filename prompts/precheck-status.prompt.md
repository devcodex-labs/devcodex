---
mode: agent
description: 输出会话头部信息（时间、意图、项目、记忆路径），每次会话开始时使用
applyTo: "**"
---
# 会话状态预检

输出当前会话的头部信息，格式如下：

## 非 chat 工作流（完整格式）

```markdown
**🔍 会话信息**

| 项目 | 值 |
|------|---|
| ⏱️ 当前时间 | `YYYY-MM-DD HH:MM` |
| 🎯 用户意图 | `[dev/fix/analyze/audit/self-fix/chat/resume]` → [工作流名称] |
| 🏗️ 目标项目 | `<project>`（null = 未识别） |
| 🌐 输出语言 | 中文 / 英文 |
| 📁 记忆文件 | `.devcodex/.memory/clients/copilot/tasks/YYYYMMDD.md` |
| 📋 Profile | `.devcodex/profile/` — ✅ 已加载 / ⚠️ 不存在 / 💡 缺少必须文件 |
| 🛡️ 安全底线 | ✅ S01~S06 已激活 |
```

## chat 工作流（精简格式）

```markdown
⏱️ `YYYY-MM-DD HH:MM` | 🎯 chat | 🌐 中文
```

## 填写规则

- 时间：从系统工具获取，无法获取时填 `unknown`
- 意图：通过 `intent/SKILL.md` 识别
- 项目：通过 `load-profile/SKILL.md` 确定
- Profile 状态：加载成功 ✅ / 目录不存在 ⚠️ / 部分文件缺失 💡
