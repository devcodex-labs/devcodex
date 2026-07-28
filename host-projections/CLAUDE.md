# DevCodex — Claude Code Adapter（generated）

@devcodex/runtime/AGENTS.md

- 上方 shared kernel 位于用户级 Claude runtime；DevCodex 全局 Skill 经受管 G_RUNTIME（`~/.agents/devcodex/skills`）按需解析，用户原生 `.claude/skills/` 仍由 Claude Code 独立发现，二者互不替代。
- kernel 不足或 coverage/freshness 失败时读取用户级 `.agents/devcodex/instructions.full.md`。
- Hook direct evidence 缺失时保持 unverified，不得凭配置文件宣称 enforced。
