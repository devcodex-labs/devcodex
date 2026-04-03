---
mode: agent
description: 贡献指南模板，用于生成标准 CONTRIBUTING.md
applyTo: "CONTRIBUTING.md"
---

# 贡献指南模板

> **触发**: `dev-init.skill.md` / `dev-docs.skill.md`

---

```markdown
# 贡献指南

感谢你考虑为 <project> 做出贡献！

## 开发环境

\`\`\`bash
# 克隆仓库
git clone <repo-url>
cd <project>

# 安装依赖
pnpm install

# 运行开发环境
pnpm dev
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
2. 确保测试全部通过：`pnpm test`
3. 更新相关文档
4. 提交 PR，填写模板说明

## 测试

\`\`\`bash
pnpm test           # 运行所有测试
pnpm test:unit      # 单元测试
pnpm test:coverage  # 覆盖率报告
\`\`\`

## 行为准则

请遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。
```
