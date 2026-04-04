---
mode: agent
description: Token 授权设置向导，引导用户完成 DevCodex Token 配置
applyTo: **
---
# Token 设置向导

> **触发**: 用户首次使用 Pro/Enterprise 功能 / 显式调用

---

## 步骤 1：获取 Token

访问 [DevCodex 定价页面](https://devcodex.dev/pricing) 选择适合的套餐：

| 套餐 | 功能 | 适合人群 |
|------|------|---------|
| Free | 基础开发/修复/分析/聊天 | 个人学习/轻量使用 |
| Pro | + 数据库/优化/测试/安全/影响评估 | 专业开发者 |
| Enterprise | + 多租户/团队协作/自定义配置 | 团队/企业 |

## 步骤 2：配置 Token

### 方式 A：环境变量（推荐）

```bash
# macOS/Linux — 添加到 ~/.bashrc 或 ~/.zshrc
export DEVCODEX_TOKEN=your_token_here

# Windows PowerShell
$env:DEVCODEX_TOKEN = "your_token_here"
# 永久设置
[Environment]::SetEnvironmentVariable("DEVCODEX_TOKEN", "your_token_here", "User")
```

### 方式 B：.env 文件

```bash
# 项目根目录 .env（确保已在 .gitignore 中）
DEVCODEX_TOKEN=your_token_here
```

## 步骤 3：验证

```bash
# 验证 Token 是否生效
echo $DEVCODEX_TOKEN  # 应显示你的 Token

# 或在 DevCodex 会话中询问
# "我的当前授权层级是什么？"
```

## 注意事项

- ⚠️ 不要将 Token 提交到版本库（添加到 .gitignore）
- ⚠️ 不要在日志/截图中暴露 Token
- Token 可在 DevCodex 控制台随时撤销重置
