# DevCodex — Gemini CLI Adapter（generated）

@devcodex/runtime/AGENTS.md

- 上方 shared kernel 位于用户级 Gemini runtime；按需读取用户级 `.agents/skills/`。
- kernel 不足或 coverage/freshness 失败时读取用户级 `.agents/devcodex/instructions.full.md`。
- BeforeAgent/AfterAgent/PreCompress 的能力声明必须受 direct replay 证据上限约束。
