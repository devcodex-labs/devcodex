# DevCodex — Gemini CLI Adapter（generated）

@AGENTS.md

- 上方 shared kernel 为强制入口；按需读取 `.agents/skills/`。
- kernel 不足或 coverage/freshness 失败时读取 `.agents/devcodex/instructions.full.md`。
- BeforeAgent/AfterAgent/PreCompress 的能力声明必须受 direct replay 证据上限约束。
