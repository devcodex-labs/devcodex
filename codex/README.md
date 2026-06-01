# codex

> Codex adapter 源模板目录，用于维护工作区根 `AGENTS.md` / `.agents/skills/` / `.codex/hooks.json` 这一条分发链的源码侧资产。

## 边界说明

- 这里保存的是源模板与说明，不是工作区部署副本
- CLI 会把 `codex/hooks.json` 分发到目标项目的 `.codex/hooks.json`
- 真正运行时的 Hook 副本位于目标工作区 `.codex/hooks/_runtime/`
- 若需要核对目标项目当前实际状态，请使用 `devcodex doctor` 或直接检查工作区根 `.codex/`
