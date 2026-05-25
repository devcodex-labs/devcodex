---
name: audit-session
description: 审计工作流的跨会话状态机 — 在 .devcodex/.audit-state/<session-id>.json 持久化轮次/发现项/收敛状态，支持 Token 中断后精准恢复
---

# Audit Session Skill

## 适用范围

- 触发：意图为 `audit` 且预期轮次 ≥3（即所有非 chat 审计场景）
- 不适用：analyze（仅 ≥3 轮收敛但无即发即修元循环）、chat（无审计语义）

## 状态文件路径

```
<项目根>/.devcodex/.audit-state/<session-id>.json
```

- `<session-id>` 取首次启动审计的时间戳：`YYYYMMDD-HHmmss`
- `.devcodex/.audit-state/` 目录由本 Skill 首次写入时创建（不随 `init` 分发）
- `.gitignore` 须包含 `.devcodex/.audit-state/`（同记忆策略）

## 状态机

```
active ──┬─> paused (Token 防护触发 / 用户中断)
         ├─> resumed (跨会话 resume 重新进入)
         ├─> converged (CRS + PCV 通过 + 连续3轮零发现)
         └─> closed (用户确认审计闭环)

paused ──> resumed ──> active
converged ──> closed
```

| 状态 | 进入条件 | 退出条件 |
|------|---------|---------|
| `active` | 首次 audit 意图识别成功 | 任一退出条件触发 |
| `paused` | C08 Token 防护（>15 轮）或 用户中断 | resume 意图 + 当前 session 命中 |
| `resumed` | resume 意图 + 读取本文件 | 立即转 `active` 继续审计 |
| `converged` | `zeroFindingStreak ≥ 3` 且 `crsPassed` 且 `pcvPassed` | 用户确认 → `closed` |
| `closed` | 用户确认审计完成或放弃 | 终态（不再写入）|

## 状态文件 schema

```json
{
  "sessionId": "20260520-143055",
  "startedAt": "2026-05-20T14:30:55+08:00",
  "lastUpdatedAt": "2026-05-20T16:12:33+08:00",
  "target": {
    "type": "spec | tech-design | requirements | project | report | document",
    "scope": "<被审查文件 glob 或目录>"
  },
  "dimensions": ["D1", "D2", "..."],
  "round": 3,
  "state": "active | paused | resumed | converged | closed",
  "findings": [
    {
      "id": "F-001",
      "round": 1,
      "dim": "D5",
      "file": "instructions/12-audit.instructions.md",
      "severity": "🔴 | 🟡 | 💡",
      "summary": "<一句话>",
      "status": "open | fixed | wontfix",
      "category": "spec-defect | release-pending | v{X.Y.Z}-candidate",
      "fixPlan": "<修复方案概述>",
      "fixCommit": "<git commit hash, 修复后写入>",
      "linkedPF": "PF-NNN | null"
    }
  ],
  "regressionProbes": [
    {
      "findingId": "F-007",
      "scanCmd": "grep -c 'PC5' CLAUDE.md",
      "expectedMatches": 3,
      "lastVerifiedRound": 4,
      "lastVerifiedAt": "2026-05-21T03:30:00+08:00"
    }
  ],
  "r2Probes": [{"name": "<probe>", "status": "✅|⚠️|❌"}],
  "r3Probes": [{"name": "<probe>", "status": "✅|⚠️|❌"}],
  "r4Probes": [{"name": "<probe>", "status": "✅|⚠️|❌"}],
  "zeroFindingStreak": 0,
  "crsPassed": false,
  "pcvPassed": false,
  "remoteReleased": {
    "gitPush": false,
    "npmPublish": false,
    "recordedAt": "ISO8601",
    "source": "user-confirmed-manual | ci-automation"
  },
  "lastCheckpoint": {
    "round": 3,
    "writtenAt": "2026-05-20T16:12:33+08:00",
    "reason": "round-end | token-protect | user-interrupt | switching-to-release-vX.Y.Z | release-pending-vX.Y.Z"
  },
  "linkedMemory": "tasks/20260520.md",
  "linkedReport": ".devcodex/<task-kind>/<task>/reports/<agent>/20260520/01--<name>.md",
  "linkedRelease": ".devcodex/requirements/<task>/reports/<agent>/YYYYMMDD/01--vX.Y.Z-release.md"
}
```

### v1.9.4+ schema 字段说明

| 字段 | 引入 | 用途 |
|------|:----:|------|
| `findings[].category` | v1.9.4 | 分类标识：`spec-defect`（规范缺陷）/ `release-pending`（仅发版动作未启动导致）/ `v{X.Y.Z}-candidate`（推迟到下版本同源合并）|
| `findings[].fixPlan` | v1.9.4 | 修复方案概述，留作 release/dev 工作流参考 |
| `findings[].fixCommit` | v1.9.4 | 修复 commit hash，与 `status=fixed` 配对 |
| `regressionProbes[]` | v1.9.5+ | 已修复 finding 的回归扫描定义；audit-common §收敛门禁第 7 步触发；任一回归 → status 切回 open，streak 归零 |
| `r{N}Probes[]` | v1.9.4 | 第 N 轮的探针清单与状态，便于跨会话 resume 时审计深度可追溯 |
| `remoteReleased` | v1.9.4 | 远端发版动作状态（git push + npm publish），消除 release-pending findings 的依据 |
| `lastCheckpoint.reason` | v1.9.4 | 扩充值：`switching-to-release-vX.Y.Z`（切 release 流程缓冲）/ `release-pending-vX.Y.Z`（等下版本合并）|
| `linkedRelease` | v1.9.4 | 关联 release 报告路径，建立 audit → release 双向链 |

## 写入时机

| 时机 | 动作 | 字段更新 |
|------|------|---------|
| 首轮启动 | 创建文件，state=active | sessionId / startedAt / target / dimensions |
| 每轮结束 | 追加 findings + 更新 round | round / findings / zeroFindingStreak |
| CRS 完成 | 标记通过状态 | crsPassed |
| PCV 完成 | 标记通过状态 | pcvPassed |
| Token 防护（C08 >15轮）| state=paused | state / lastCheckpoint.reason=token-protect |
| 收敛 | state=converged | state |
| 用户确认 | state=closed | state |

## 与其他 Skill / Instruction 的协同

| 关联点 | 说明 |
|--------|------|
| `instructions/12-audit.instructions.md` | 审计工作流入口须读取/创建本文件；收敛门禁须校验 `crsPassed && pcvPassed && zeroFindingStreak>=3` |
| `instructions/15-memory.instructions.md` | tasks/YYYYMMDD.md 段落须追加 `🔗 审计会话：<session-id>` 字段，建立双向链 |
| `intent/SKILL.md` | resume 意图识别后须在三层记忆读取之前优先扫描 `.devcodex/.audit-state/*.json` 查找未 closed 的会话 |
| `skills/audit-execution-guide/SKILL.md` | 即发即修元循环（self-fix 后重启新轮）须将旧 round 标 `fixed-restart`，新 round 继续累计 |

## 跨会话 resume 流程

1. 用户说"继续审计" / "继续上次的审查"
2. 读取 `.devcodex/.audit-state/` 下所有 `.json`，按 `lastUpdatedAt` 倒序
3. 找出 state ∈ {paused, active, resumed} 的最新一份
4. 输出："发现未完成审计会话 `<sessionId>`：目标 `<target.scope>`，已完成 `R{round}`，发现 `{open}` 项 open。是否继续？"
5. 用户确认 → state=resumed → 立即 → active，从 round+1 开始
6. 用户拒绝 → 询问是否 closed 该会话

## ⛔ 禁止

- ⛔ 状态文件不得提交到 git（同 `.devcodex/.memory/`）
- ⛔ 同一 sessionId 不得并行写入（C07 串行约束的延伸）
- ⛔ converged 状态不得自动转 closed —— 须用户明确确认（避免静默关闭）
