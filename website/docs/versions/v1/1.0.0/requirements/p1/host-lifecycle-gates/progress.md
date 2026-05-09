# 宿主生命周期硬门禁（Hooks 优先）— 实施进度

> **关联需求**：[宿主生命周期硬门禁（Hooks 优先）— 需求概况](./index)
> **状态**：🟡 已建档，方案已收敛，实施中
> **最后更新**：2026-05-09

---

## 总体状态

| 项目 | 状态 |
|------|:----:|
| 需求建档 | ✅ |
| 技术方案收敛 | ✅ |
| 实施计划收敛 | ✅ |
| 源码实现 | 🟡 |
| 宿主验证 | 🟡 |
| 文档收口 | ✅ |

## 当前里程碑

| 里程碑 | 状态 | 说明 |
|--------|:----:|------|
| M1：问题归因完成 | ✅ | 已确认问题根因在“生命周期硬门禁由 instructions 承担” |
| M2：正式需求建档 | ✅ | 已新增 P1 `host-lifecycle-gates` 需求目录 |
| M3：技术与实施方案收敛 | ✅ | 已冻结“Workspace Hooks MVP 优先、Plugin-Native 后置、`Stop` 仅兜底、本地优先无服务器前置”的首阶段路线 |
| M4：Hooks 正式产物落地 | ✅ | 已新增 `hooks/devcodex.lifecycle.json` 与 `hooks/_runtime/lifecycle.cjs`，并让 `index.js` / `package.json` / `scripts/validate.js` 识别 Hooks 分发与打包；仓库源面与 npm 包面都已移除失活的 `assets/hooks/lifecycle.cjs` |
| M5：跨宿主验证 | 🟡 | 已完成目标项目 `init/status/runtime` smoke test 与真实 VS Code Hook 触发闭环验证，确认 `.github/hooks/_runtime/lifecycle.cjs` 在真实宿主下会被加载并触发危险命令护栏；fallback 宿主联动验证仍待完成 |

## 待推进事项

1. 完成 fallback 宿主验证，确认在不支持 Hooks 的宿主中会显式降级到 `instruction-fallback`，且不再宣称硬保证。
