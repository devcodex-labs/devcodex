# DevCodex Workspace Bridge

> projectionRole: workspace-bridge

This repository is a project inside a DevCodex `workspace-namespace`. This file is a discovery bridge, not a second rules source.

Before any substantive action:

1. Form a semantic intent seed from the current user message and observed conversation continuity. Do not read Profile, memory, summaries, or the full rules fallback yet.
2. Open and follow `.grok/skills/devcodex-workspace/SKILL.md`.
3. Resolve the unique parent workspace, shared kernel, project namespace, relevant parent Skills, and active runtime root through that Skill.
4. Apply the parent workspace rules and keep all project runtime state in the workspace namespace. Do not create a second project-local `.devcodex` runtime.

If the workspace root, shared kernel, requested Skill, or project binding cannot be verified uniquely, stop the workflow and report the missing source instead of guessing.
