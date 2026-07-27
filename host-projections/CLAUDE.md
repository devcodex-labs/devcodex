# DevCodex — Claude Code Adapter（generated）

@devcodex/runtime/AGENTS.md

- 上方 shared kernel 位于用户级 Claude runtime；全局 Skill 正文默认在受管 G_RUNTIME（`~/.agents/devcodex/skills`），经 DevCodex resolve 按需读取，勿依赖 `~/.claude/skills` 全量列表。
- kernel 不足或 coverage/freshness 失败时读取用户级 `.agents/devcodex/instructions.full.md`。
- Hook direct evidence 缺失时保持 unverified，不得凭配置文件宣称 enforced。
