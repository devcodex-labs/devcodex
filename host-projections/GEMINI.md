# DevCodex — Gemini CLI Adapter（generated）

@devcodex/runtime/AGENTS.md

- 上方 shared kernel 位于用户级 Gemini runtime；全局 Skill 默认经 DevCodex resolve 读取受管 runtime skills（`~/.agents/devcodex/skills`），非扫描根全量百科。
- kernel 不足或 coverage/freshness 失败时读取用户级 `.agents/devcodex/instructions.full.md`。
- BeforeAgent/AfterAgent/PreCompress 的能力声明必须受 direct replay 证据上限约束。
