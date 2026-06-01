# Changelogs

DevCodex 的实现变更日志采用三层结构：

| 文件/目录 | 用途 | 写入时机 |
|-----------|------|----------|
| `unreleased.md` | 未正式发版的实现、修复、规范变更池 | 用户未明确要求 `tag` / `release` / `publish` 时 |
| `TEMPLATE.md` | 新版本详情模板 | 正式 release 前复制使用 |
| `releases/vX.Y.Z.md` | 已发布版本详情 | 用户明确确认 release 后，从 `unreleased.md` 归档生成 |

根目录只保留未发布池、模板和本说明；已发布版本统一放入 `releases/`。根 `CHANGELOG.md` 是已发布版本索引，链接应指向 `changelogs/releases/vX.Y.Z.md`。

历史 flat 路径 `changelogs/vX.Y.Z.md` 不再作为当前写入位置；新增发布记录必须写入 `changelogs/releases/vX.Y.Z.md`。
