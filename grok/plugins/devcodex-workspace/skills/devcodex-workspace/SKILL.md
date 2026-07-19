---
name: devcodex-workspace
description: Use for a task whose cwd belongs to the registered DevCodex workspace, or when the user asks for DevCodex workflow behavior; resolve the workspace kernel and load only intent-selected shared Skills without project-local host adapters.
---

# DevCodex Workspace Resolver

Grok passive hooks cannot inject prompt context. When this Skill is selected from a child Git project, read the plugin-owning workspace's `AGENTS.md` before producing substantive task content. The full-evidence route is `devcodex grok`, whose launcher binds that same kernel with Grok's official `--rules` flag; plain `grok` in a child project remains best-effort Skill routing.

1. Preserve the semantic intent seed before reading project context.
2. Bind the nearest valid `workspace-namespace` root to the plugin's owning workspace; fail closed on mismatch. If the controlling kernel is not already present, read `<workspace-root>/AGENTS.md` now.
3. Resolve the project namespace relative to that workspace and bind runtime state under `.devcodex/<project>/`.
4. Follow the kernel's intent-first route and read only selected files from `<workspace-root>/.agents/skills/` and the resulting Profile/context plan.
5. Use `<workspace-root>/.agents/devcodex/instructions.full.md` only for an explicit fail-closed fallback.

The plugin is a discovery adapter, not a second rules source. Its passive Hook output must never be presented as kernel-injection evidence. Do not copy `AGENTS.md`, `.agents`, `.grok`, `.codex`, `.claude`, or `.gemini` into a child project.
