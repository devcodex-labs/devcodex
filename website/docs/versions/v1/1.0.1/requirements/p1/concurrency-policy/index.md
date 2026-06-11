# 可配置并发执行策略

> **状态**：✅ 已实现  
> **优先级**：P1  
> **日期**：2026-06-10

## 背景

旧版 C07 将并发收敛为“禁止并行子 Agent”，容易把只读搜索、Profile/记忆读取和隔离验证也误判为必须串行。真实风险并不来自读取并行，而来自共享状态写入竞争：CP 状态、记忆、报告、台账、audit session、source mutation、package boundary 和危险操作需要单写者。

## 目标

1. 引入 `ConcurrencyPolicy`，默认 `auto`。
2. 通过 Profile `config.json` 的 `extensions.devcodex.concurrency` 配置只读与验证通道。
3. 保留核心单写者域，不允许项目配置删除或绕过。
4. 拒绝 `parallel`、`allowParallelMutations` 和覆盖核心锁的配置。
5. 同步 instructions、skills、README、website、Profile 与 validate 探针。

## 配置示例

```json
{
  "extensions": {
    "devcodex": {
      "concurrency": {
        "mode": "auto",
        "readOnly": { "enabled": true, "maxParallel": 4, "allowAgents": true },
        "validation": { "enabled": true, "maxParallel": 2 },
        "locks": { "additionalSingleWriterScopes": [] }
      }
    }
  }
}
```

## 验收

| # | 验收标准 |
|---|----------|
| AC-01 | 未配置 concurrency 时按 `auto` 解释 |
| AC-02 | `mode=serial` 可退回全串行 |
| AC-03 | 合法配置通过 `validate-profile` |
| AC-04 | 非法并发数、`mode=parallel`、`allowParallelMutations`、覆盖核心锁均报错 |
| AC-05 | README、website、Profile 能解释 `parallel prepare, serial commit` |
| AC-06 | C07/SC10 和关键 Skill 同步到 `ConcurrencyPolicy` 口径 |

## 设计

详见 [技术设计](./design)。
