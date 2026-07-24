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
8. Run `devcodex doctor` / `devcodex status` and read `hostParity` (`HostParityScorecardV1`): `full-capable` means hard path is ready; still use `devcodex grok` for Full session kernel evidence. `partial` lists **failedChecks** and **executable repairSteps** (commands); re-run doctor after each fix.
9. Execute **GrokTurnChecklist** every non-trivial turn (PF-165 + C16/PI-20260724-01): PC0~PC7 → Intent→Skill mandatory bundle → ContextReadPlan → **scan-hygiene** → **TTFV first delivery** → work/gates → report+memory → honest platform ceiling. Never skip S05/S07/C17 because inject is missing.

## GrokTurnChecklist + Intent→Skill bundle (PF-165)

| Step | Must do |
|------|---------|
| entry-pc0-pc7 | Full PC0~PC7 first; re-emit after compact/resume |
| intent-route | Final route before loading workflow Skills |
| skill-bundle | Non-chat mandatory: `intent` + `compliance` + `user-visible-output-contract` + workflow Skill + `report` + `memory` (minimal-sufficient; no full Skill encyclopedia preload) |
| context-plan | Bounded plan/receipts only |
| scan-hygiene | **WorkspaceRootScanBan**: no monorepo/workspace-root `Get-ChildItem -Recurse`; bind project path; exclude `node_modules`/`dist` |
| ttfv-first-delivery | **TimeToFirstValueGate**: same user-visible turn delivers scope card OR first findings/conclusion OR hard block (non-chat) |
| work-and-gates | CP/ECR as applicable |
| report-memory | Non-chat write report + memory |
| honest-ceiling | No inject / Stop hard-block / Grok===Codex claims |

Machine source: `scripts/lib/host-parity-scorecard.js` (`GROK_TURN_EXECUTION_CHECKLIST`, `classifyWorkspaceRootScanSample`, `classifyTtfvOmissionSample`, `repairSteps`). Site doc: `website/docs/intro/host-parity-grok.md`.

The plugin is a discovery adapter, not a second rules source. Its passive Hook output must never be presented as kernel-injection evidence. Do not copy `AGENTS.md`, `.agents`, `.grok`, `.codex`, `.claude`, or `.gemini` into a child project.
