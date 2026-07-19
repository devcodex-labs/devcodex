---
name: devcodex-workspace
description: Retired compatibility fixture for the former project-local Grok bridge; current workspace installs use grok/plugins/devcodex-workspace.
---

# DevCodex Workspace Resolver（retired compatibility fixture）

> lifecycleStatus: retired-compatibility-fixture
> deploymentStatus: MUST NOT be deployed by current workspace descriptors

This file is retained only so historical packages and migration evidence remain readable. Current `workspace-namespace` installs use the workspace-owned plugin under `grok/plugins/devcodex-workspace`; child projects must not receive this Skill or a project bridge.

For forensic replay of an old project bridge, the historical resolver contract was:

1. Preserve the semantic intent seed already formed from the user message and conversation continuity.
2. Walk upward from the current project directory to the nearest unique parent containing `.devcodex/layout.json` whose `mode` is `workspace-namespace`. That parent is `<workspace-root>`. Do not search above the first valid marker.
3. Read `<workspace-root>/AGENTS.md` as the controlling shared kernel. Treat the project bridge and this Skill only as discovery adapters; they must not override the shared kernel.
4. Resolve the project namespace as the project-root path relative to `<workspace-root>`. Bind runtime state to `<workspace-root>/.devcodex/<project-namespace>/`; use `<workspace-root>/.devcodex/workspace/` only for an explicitly workspace-wide task.
5. Apply the kernel's intent-first context gate. Load only the parent Skill files selected by the final route from `<workspace-root>/.agents/skills/<skill-id>/SKILL.md`, then load only the Profile or memory sections named by the resulting context plan.
6. Read `<workspace-root>/.agents/devcodex/instructions.full.md` only for the kernel's explicit fail-closed fallback conditions. Never use it as the normal startup path.
7. Before substantive output, satisfy the parent kernel's visible entry-check contract and all applicable confirmation, validation, memory, report, and governance gates.

Fail closed when any of these are ambiguous or missing: workspace marker, shared kernel, project namespace, selected Skill, Profile source, or active-root binding. Report the precise missing path or conflicting candidates; do not invent or silently substitute rules.
