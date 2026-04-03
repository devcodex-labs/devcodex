# DevCodex v5 — Tools

开发和维护工具，**不包含在 Plugin 运行时**，仅供开发者使用。

## 工具列表

### `v5-full-audit.js`

v5 规范一致性检查工具。验证所有 106 个文件存在、frontmatter 格式正确、v4→v5 映射覆盖率 100%。

```bash
node tools/v5-full-audit.js
```

输出：每个文件的检查结果 + 覆盖率统计。

### `v4-to-v5-migration.js`

自动迁移 v4 多租户规范到 v5 Instructions 格式。

```bash
node tools/v4-to-v5-migration.js --tenant <id> --src <v4-path>
```

| 参数 | 说明 |
|------|------|
| `--tenant <id>` | 租户 ID（用于生成目标路径）|
| `--src <path>` | v4 tenants/<id>/specs/ 源目录 |
| `--dry-run` | 仅预览，不写入文件 |

### `trailing-spaces-fix.js`

修复 Markdown 文件中的尾随空格（移植自 v4 `tools/fix-blockquote-trailing-spaces.js`）。

```bash
node tools/trailing-spaces-fix.js [--path <dir>]
```

## 开发说明

工具依赖 Node.js 18+，无需额外 npm 包（使用 Node.js 内置模块）。
