# DevCodex — Claude Code Adapter（generated）

@devcodex/runtime/AGENTS.md

- 上方 shared kernel 位于用户级 Claude runtime；按需读取用户级 `.claude/skills/`。
- kernel 不足或 coverage/freshness 失败时读取用户级 `.agents/devcodex/instructions.full.md`。
- Hook direct evidence 缺失时保持 unverified，不得凭配置文件宣称 enforced。
