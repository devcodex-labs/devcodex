---
name: devcodex-workspace
description: >
  Use for non-trivial work in a DevCodex workspace and whenever a task may match
  a managed or workspace Skill. Resolve intent first, then use the staged
  devcodex-profile skill_route contract instead of scanning every Skill.
---

# DevCodex Workspace Resolver for Cursor

Cursor loads this small resolver from the user-global DevCodex Plugin. It is a
discovery adapter, not a second rules or state source.

1. Before substantive work, follow the session-injected DevCodex kernel and
   emit the required PC0 through PC7 entry check.
2. Resolve the nearest valid DevCodex workspace namespace from the current
   working directory. Keep project runtime state only under that workspace's
   .devcodex namespace.
3. Use devcodex-profile skill_route in this order: bounded catalog, one commit,
   then load only the committed stage. Do not recursively list user Skill
   directories or load the entire Skill corpus.
4. A successful stage load is the evidence that the selected Skill body is
   active. A catalog entry or native Skill listing alone is not load evidence.
5. Use devcodex-memory for CP receipts, task memory and summaries. Do not treat
   Cursor approval mode as DevCodex CP or automatic authorization.
6. After compaction, re-run the entry contract and refresh context binding
   before unrelated work.
7. Cursor local IDE, interactive CLI, Headless CLI and Cloud Agent have separate
   evidence. Never copy a local readiness claim to Cloud.
8. Do not create .cursor, AGENTS.md, CLAUDE.md, GEMINI.md, .agents or other host
   adapter files inside a business workspace. The Plugin and Hooks are user-global.

If the Hook adapter is unavailable, this Skill is guidance only. Report the
native state as UNVERIFIED and use devcodex status or devcodex doctor for the
single next recovery step.
