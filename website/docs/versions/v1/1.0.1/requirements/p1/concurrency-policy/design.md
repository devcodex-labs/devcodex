# 可配置并发执行策略 - 技术设计

## 决策

| 决策 | 内容 |
|------|------|
| D-01 | 首期只支持 `auto` / `serial` |
| D-02 | 只配置 `readOnly`、`validation` 和追加锁，不配置核心锁域 |
| D-03 | 核心单写者域由 C07 固定 |
| D-04 | 不新增 runtime 调度器 |
| D-05 | `validate-profile.js` 拒绝危险字段和未知并发字段 |

## 核心单写者域

固定锁域：`active-root`、`memory`、`report`、`ledger`、`audit-session`、`cp-state`、`source-mutation`、`package-boundary`、`dangerous-operation`。

这些域不受 `mode=auto` 放开；项目只能通过 `locks.additionalSingleWriterScopes` 增加更保守的锁。

## 执行语义

```text
if concurrency is missing:
  use defaults(mode=auto)

if mode=serial:
  readOnly.maxParallel = 1
  validation.maxParallel = 1
  no parallel agents

if mode=auto:
  read-only prepare may run in parallel
  isolated validation may run in parallel
  all core single-writer scopes remain serial
```

## 同步范围

| 范围 | 文件 |
|------|------|
| 真相源 | `instructions.md`、`instructions/01-common.instructions.md`、`scripts/validate-profile.js` |
| 消费者 | compliance、load-profile、intent、routing、audit-session、memory、dev-default、test-router、release-verification |
| 文档 | README、website guide/specs、active Profile、unreleased changelog |
| 验证 | `test-validate-profile`、`test-spec-governance`、`validate.js`、`npm test` |

## 不做

- 不新增 runtime 调度器。
- 不允许并行源码 mutation。
- 不允许并行写同一 active-root 状态产物。
- 不修改 `1.0.0` 历史基线。
