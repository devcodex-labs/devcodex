---
name: devcodex-workspace
description: Use for a task whose cwd belongs to the registered DevCodex workspace, or when the user asks for DevCodex workflow behavior; resolve the workspace kernel and load only intent-selected shared Skills without project-local host adapters.
---

# DevCodex Workspace Resolver

Grok passive hooks cannot inject prompt context. When this Skill is selected from a child Git project, read the plugin-owning workspace's `AGENTS.md` before producing substantive task content. The full-evidence route is `devcodex grok`, whose launcher binds that same kernel with Grok's official `--rules` flag; plain `grok` in a child project remains best-effort Skill routing.

## HostParity (vs Codex) — honesty contract

| Tier | Route | Guarantees | Must not claim |
|------|-------|------------|----------------|
| **Full** | `devcodex grok` (official `--rules` kernel bind) | Controlling `AGENTS.md` in context; PreToolUse hard deny uses Grok `decision:deny`; context acquisition is **path-observable** (same band as Codex tool-path observation) | UserPromptSubmit context inject; Stop hard-block; verified PC0 from Hook payload |
| **Partial** | plain `grok` in a child Git project | Best-effort Skill discovery + plugin bridge when trusted; PreToolUse deny adapter still applies when lifecycle is reachable | Full host parity with Codex; `kernelInjected=true` from passive Hook stdout |

Platform facts (Grok Build hooks docs): only `PreToolUse` is blocking; passive event stdout is ignored for model context. PC5 must report `Partial` unless Full launcher evidence is present. Do not equate Grok with Codex `hook-enforced` bootstrap.

1. Preserve the semantic intent seed before reading project context.
2. Bind the nearest valid `workspace-namespace` root to the plugin's owning workspace; fail closed on mismatch. If the controlling kernel is not already present, read `<workspace-root>/AGENTS.md` now.
3. Resolve the project namespace relative to that workspace and bind runtime state under `.devcodex/<project>/`.
4. Follow the kernel's intent-first route and read only selected files from `<workspace-root>/.agents/skills/` and the resulting Profile/context plan.
5. Use `<workspace-root>/.agents/devcodex/instructions.full.md` only for an explicit fail-closed fallback.
6. Before substantive output, satisfy the parent kernel's visible entry-check (PC0~PC7). Runtime cannot inject that block on Grok; models still own S07 user-visible output.
7. Optional assist: call MCP `profile_compose_entry_check` to obtain a portable PC0~PC7 block, or rely on PreToolUse deny reasons that embed the same template when context acquisition is incomplete.
8. Run `devcodex doctor` / `devcodex status` and read `hostParity` (`HostParityScorecardV1`): `full-capable` means hard path is ready; still use `devcodex grok` for Full session kernel evidence. `partial` lists missing checks.

The plugin is a discovery adapter, not a second rules source. Its passive Hook output must never be presented as kernel-injection evidence. Do not copy `AGENTS.md`, `.agents`, `.grok`, `.codex`, `.claude`, or `.gemini` into a child project.
