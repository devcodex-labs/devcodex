# DevCodex — Gemini CLI Adapter（generated）

@devcodex/runtime/AGENTS.md

- 上方 shared kernel 位于用户级 Gemini runtime；DevCodex 全局 Skill 经受管 G_RUNTIME（`~/.agents/devcodex/skills`）按需解析，用户原生 `.agents/skills/` 仍由宿主独立发现，二者互不替代。
- kernel 不足或 coverage/freshness 失败时读取用户级 `.agents/devcodex/instructions.full.md`。
- BeforeAgent/AfterAgent/PreCompress 的能力声明必须受 direct replay 证据上限约束。
