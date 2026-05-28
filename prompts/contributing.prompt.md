---
agent: agent
description: 贡献指南模板，用于生成标准 CONTRIBUTING.md
applyTo: CONTRIBUTING.md
---
# 贡献指南模板

> **触发**: `dev-init/SKILL.md` / `dev-docs/SKILL.md`

---

```markdown
# 贡献指南

感谢你考虑为 <project> 做出贡献！

## 开发环境

> 将以下占位命令替换为项目实际命令；包管理器与脚本名以仓库现状为准。

\`\`\`bash
# 克隆仓库
git clone <repo-url>
cd <project>

# 安装依赖
<install-command>

# 运行开发环境
<dev-command>
\`\`\`

## 提交代码

### 分支命名

- `feat/<name>` — 新功能
- `fix/<name>` — Bug 修复
- `docs/<name>` — 文档更新
- `refactor/<name>` — 重构

### Commit 规范

\`\`\`
<type>(<scope>): <description>

feat(auth): add JWT token refresh
fix(api): handle empty response body
docs(readme): update installation steps
\`\`\`

### Pull Request

1. Fork 仓库并创建分支
2. 确保项目定义的测试全部通过：`<test-command>`
3. 更新相关文档
4. 提交 PR，填写模板说明

## 测试

\`\`\`bash
<test-command>          # 运行主测试套件
<unit-test-command>     # 若项目提供单元测试命令
<coverage-command>      # 若项目提供覆盖率命令
\`\`\`

## 行为准则

若项目提供行为准则文件，请遵守仓库中的对应文档。
```
