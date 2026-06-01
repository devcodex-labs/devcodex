# assets/hooks

> Hooks 运行时相关的源码/模板占位目录，用于维护者区分“源仓说明资产”和真正分发到宿主工作区的运行时副本。

## 源仓维护说明

- 当前正式分发的 Hook runtime 位于 `hooks/_runtime/`，并由 CLI 同步到目标项目的 `.github/hooks/_runtime/`、`.claude/hooks/_runtime/` 或 `.codex/hooks/_runtime/`
- `assets/hooks/` 仅保留源仓侧的说明占位，便于后续如需补充截图、示意图或额外模板时有明确归属
- 本目录默认不会打包发布；发布包以 `package.json` 的 `files` 白名单和 `scripts/test-pack-clean.js` 为准
