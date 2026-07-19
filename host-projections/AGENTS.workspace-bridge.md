# DevCodex Workspace Bridge

> projectionRole: workspace-bridge
> projectionScope: host-neutral
> projectionStatus: retired-compatibility-fixture

This file is retained for migration and negative-fixture compatibility only. Current workspace descriptors MUST NOT deploy a child-project bridge; all host assets belong to the workspace owner.

For forensic replay of a legacy deployment, this repository was treated as a project inside a DevCodex `workspace-namespace`. The bridge was discovery-only, not a second rules source.

Before any substantive action:

1. Form a semantic intent seed from the current user message and observed conversation continuity. Do not read Profile, memory, summaries, or the full rules fallback yet.
2. Walk upward from this repository to the unique parent workspace containing both `AGENTS.md` and `.devcodex/layout.json`. Open the parent `AGENTS.md` as the shared rules source and use its `.agents/skills` directory.
3. Resolve the project namespace and active runtime root from that parent workspace. Apply the parent rules and keep all runtime state in the workspace namespace. Do not create a second project-local `.devcodex` runtime.
4. Never activate the retired project `.grok` Skill/hooks/MCP adapter in a current workspace installation. Use the workspace-owned `grok/plugins/devcodex-workspace` package and official user registration instead.

If the workspace root, shared kernel, requested Skill, or project binding cannot be verified uniquely, stop the workflow and report the missing source instead of guessing.
