# DevCodex — Claude Code Adapter（generated）

@AGENTS.md

- 上方 shared kernel 为强制入口；按需读取 `.claude/skills/`。
- kernel 不足或 coverage/freshness 失败时读取 `.agents/devcodex/instructions.full.md`。
- Hook direct evidence 缺失时保持 unverified，不得凭配置文件宣称 enforced。
