# 变更日志 (CHANGELOG)

> **说明**: 版本概览摘要，详细变更见 [`changelogs/v1.0.0.md`](./changelogs/v1.0.0.md) 等详细变更文件  
> **最后更新**: 2026-04-10

---

## 版本概览

| 版本 | 日期 | 变更摘要 | 详细 |
|------|------|---------|------|
| [v1.1.0](./changelogs/v1.1.0.md) | 2026-04-10 | 🎉 **Instructions-First 架构迁移**：新增 `copilot-instructions.md` always-on 入口，Agent 精简，CLI 分发更新 | [查看](./changelogs/v1.1.0.md) |
| [v1.0.0](./changelogs/v1.0.0.md) | 2026-04-04 | 🎉 **v1.0.0 重构**：全新项目结构，规范文件统一中文，需求管理迁移至 website/docs/versions/v1/1.0.0/requirements/ | [查看](./changelogs/v1.0.0.md) |
| v0.0.3 | 2026-04-04 | 🔧 dev/prod 模式、合规体系重构、记忆四列格式、项目 profile 体系 | — |
| v0.0.2 | 2026-04-04 | 🎉 初始结构：8 种工作流、核心 Skills、11 个 Instructions | — |

---

## 维护说明

### 添加新版本的步骤

1. **创建详细变更文档**
   ```bash
   cp changelogs/TEMPLATE.md changelogs/vX.Y.Z.md
   # 填充详细变更信息
   ```

2. **更新 CHANGELOG.md**（本文件）
   - 在"版本概览"表格最上方添加新行
   - 格式：`| [vX.Y.Z](./changelogs/vX.Y.Z.md) | 日期 | 摘要 | [查看](./changelogs/vX.Y.Z.md) |`

3. **同步版本号到所有文件**
   - `plugin.json` → version 字段
   - `RULES.md` → 标题行和 frontmatter 版本号

4. **重建 lockfile**
   ```bash
   rm package-lock.json && npm install
   ```

5. **提交变更**
   ```bash
   git add CHANGELOG.md changelogs/vX.Y.Z.md plugin.json package.json RULES.md package-lock.json
   git commit -m "release: vX.Y.Z — 摘要"
   ```

### 版本号规则

- **MAJOR** (x.0.0) — 工作流或架构破坏性变更
- **MINOR** (1.x.0) — 新增工作流、新增 Skill、新增指令集
- **PATCH** (1.0.x) — Bug 修复、文字修正、工具改进

---

## 相关文档

- [`changelogs/v1.0.0.md`](./changelogs/v1.0.0.md) — 当前维护中的详细变更文档
- [README.md](./README.md) — 项目说明
- [requirements/index.md](./website/docs/versions/v1/1.0.0/requirements/index.md) — 需求文档总览

