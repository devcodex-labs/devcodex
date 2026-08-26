---
name: devcodex-workspace
description: >
  Use when cwd belongs to a DevCodex workspace, the user asks for DevCodex behavior,
  OR the user message may match a workspace custom skill under .devcodex/workspace/skills
  (short triggers like skill name/id, quoted phrases in skill description, e.g. test/测试).
  Prefer workspace skill fixed behavior over connectivity/chat defaults.
---

# DevCodex Workspace Resolver

Grok **UserPromptSubmit** cannot inject model context (stdout ignored). Workspace custom skills are **not** native-scanned; DevCodex uses the same staged `skill_route` contract as the other hosts: build a bounded W + managed G catalog, commit at most one route, and load only the committed stage body. On Grok, **Stop `decision:block`** may continue only a committed pending route when `lastAssistantMessage` is available. The plugin is user-global and does not own a workspace. Resolve the nearest `workspace-namespace` marker from cwd, keep task state under that workspace's `.devcodex`, and load shared instructions/Skills from user-global DevCodex surfaces plus the committed workspace skill. Full-evidence route: `devcodex grok`.

## Unified Workspace Skill Route（用户可见闭环）

1. Before treating a short user message as connectivity ping / Ready, use the bounded catalog supplied by the unified route; do not independently scan skill trees.
2. If a route is committed, load **only that one SKILL.md** through `skill_route` and obey it for the turn. Do not invent Ready/闲聊.
3. **Privacy / process UI**: **禁止**列出或扫描用户主目录下的宿主 skill 树，例如  
   `C:\Users\…\.grok\skills`、`~\.grok\bundled\skills`、`~\.claude\skills`、`~\.agents\skills`（L1）。  
   这些 List 会把 C 盘用户路径暴露在过程时间线里。全局 skill 只读  
   `~/.agents/devcodex/skills/<id>/SKILL.md` 单文件；工作区 skill 只读  
   `.devcodex/workspace/skills/<id>/SKILL.md`。
4. 过程文案用「正在加载 <id> 技能」，不要写「命中…正在读取并按该技能执行」。
5. CLI inventory verify: `devcodex skill resolve <id>`; route regression: `npm run test:skill-route`.
6. Do not claim UPS inject on Grok; Stop may continue only an already committed pending route.

## HostParity (vs Codex) — honesty contract

| Tier | Route | Guarantees | Must not claim |
|------|-------|------------|----------------|
| **Full** | `devcodex grok` (official `--rules` kernel bind) | Controlling `AGENTS.md` in context; PreToolUse hard deny uses Grok `decision:deny`; context acquisition is **path-observable**; unified staged skill route; **conditional** Stop hard-continue (`decision:block` when `lastAssistantMessage` is available and a committed route/completion gate remains pending) | UserPromptSubmit context inject; unconditional Stop without body / after softCap fail-open; verified PC0 from Hook payload alone |
| **Partial** | plain `grok` in a child Git project | Best-effort Skill discovery + plugin bridge when trusted; PreToolUse deny adapter still applies when lifecycle is reachable | Full host parity with Codex; `kernelInjected=true` from passive Hook stdout |

Platform facts (Grok Build hooks docs): `PreToolUse` and `Stop`/`SubagentStop` can hard-control; UserPromptSubmit is passive (no inject). PC5 must report `Partial` unless Full launcher evidence is present. Do not equate Grok with Codex UPS inject bootstrap.

1. Preserve the semantic intent seed before reading project context.
2. Bind the nearest valid `workspace-namespace` root from cwd. Do not require or create workspace `AGENTS.md`, `.agents`, `.grok`, `.codex`, `.claude`, `.gemini`, or `.github`.
3. Resolve the project namespace relative to that workspace and bind runtime state under `.devcodex/<project>/`.
4. Follow the kernel's intent-first route and read only selected files from the managed global runtime plus the resulting workspace Profile/context plan, and the single workspace skill committed by `skill_route`.
5. Use `~/.agents/devcodex/instructions.full.md` only for an explicit fallback; workspace `.devcodex` remains the sole workspace-owned DevCodex surface.
6. Before substantive output, satisfy **UserVisibleReplyLayoutV1** + **UserVisibleNoisePolicyV1** (six-host shared): always emit plain-language PC0~PC7; do **not** paste completion-check/FC tables/FVS unless work is claimed done (short FVS when all-green) or something failed. Runtime cannot inject on Grok; models still own S07.
7. Optional assist: call MCP `profile_compose_entry_check` to obtain a portable PC0~PC7 block, or rely on PreToolUse deny reasons that embed the same template when context acquisition is incomplete.
8. Run `devcodex doctor` / `devcodex status` and read `hostParity` (`HostParityScorecardV1`): `full-capable` means hard path is ready; still use `devcodex grok` for Full session kernel evidence. `partial` lists **failedChecks** and **executable repairSteps** (commands); re-run doctor after each fix.
9. Execute **GrokTurnChecklist** every non-trivial turn (PF-165 + C16/PI-20260724-01): PC0~PC7 → Intent→Skill mandatory bundle → ContextReadPlan → **scan-hygiene** → **TTFV first delivery** → work/gates → report+memory → honest platform ceiling. Never skip S05/S07/C17 because inject is missing.
10. **Workspace skill trigger**: if user message matches a W skill, obey that skill before checklist bulk for chat-like turns.

## GrokTurnChecklist + Intent→Skill bundle (PF-165)

| Step | Must do |
|------|---------|
| entry-pc0-pc7 | Full PC0~PC7 first; re-emit after compact/resume |
| intent-route | Final route before loading workflow Skills |
| skill-bundle | Non-chat mandatory: `intent` + `compliance` + `user-visible-output-contract` + workflow Skill + `report` + `memory` (minimal-sufficient; no full Skill encyclopedia preload) |
| context-plan | Bounded plan/receipts only |
| scan-hygiene | **WorkspaceRootScanHygiene**: prefer a bound project path and exclude `node_modules`/`dist`; Hook telemetry is advisory and the host owns permission |
| ttfv-first-delivery | **TimeToFirstValueGate**: same user-visible turn delivers scope card OR first findings/conclusion OR hard block (non-chat) |
| work-and-gates | CP/ECR as applicable |
| report-memory | Non-chat write report + memory |
| honest-ceiling | No inject / unconditional Stop hard-block / Grok===Codex claims; Stop is conditional (body + softCap) |

Machine source: `scripts/lib/host-parity-scorecard.js` (`GROK_TURN_EXECUTION_CHECKLIST`, `classifyWorkspaceRootScanSample`, `classifyTtfvOmissionSample`, `repairSteps`). Site doc: `website/docs/intro/host-parity-grok.md`.

The plugin is a discovery adapter, not a second rules source. Its passive Hook output must never be presented as kernel-injection evidence. Do not copy `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents`, `.github`, `.grok`, `.codex`, `.claude`, or `.gemini` into a workspace.
