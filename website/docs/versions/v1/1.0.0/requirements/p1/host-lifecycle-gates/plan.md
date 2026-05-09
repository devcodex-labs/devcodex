# 宿主生命周期硬门禁（Hooks 优先）— 实施计划

> **关联需求**：[宿主生命周期硬门禁（Hooks 优先）— 需求概况](./index)
> **关联方案**：[技术方案](./design)
> **状态**：🟡 执行中

---

## 实施目标

以最小破坏方式，为 DevCodex 增加“宿主可强制执行”的生命周期门禁层，并保留现有 instructions-first 作为 fallback 路径。

首阶段目标进一步冻结为：先交付 **Workspace Hooks MVP**，在不依赖服务器部署和官方 plugin-native hooks 的前提下，完成本地 bootstrap、危险操作护栏和结束前兜底闭环。

---

## 分阶段计划

### 阶段 1：需求与能力模型收口

| # | 任务 | 关联需求 | 完成标准 |
|---|------|---------|---------|
| T-01 | 确认 `hook-enforced` / `instruction-fallback` / `disabled` 三态定义 | NR-3 | 文档、README、RULES 使用同一术语 |
| T-02 | 盘点当前预检查/合规/记忆/报告对应的宿主责任边界 | NR-1, NR-4 | 形成事件映射表并获得确认 |
| T-03 | 修订 requirements 总览与需求变更日志 | NR-7 | 索引可导航，CHANGELOG 有记录 |

### 阶段 2：Workspace Hooks MVP 与 CLI 分发

| # | 任务 | 关联需求 | 完成标准 |
|---|------|---------|---------|
| T-04 | 新增 `hooks/` 正式资产目录、Workspace Hooks 配置与包内本地脚本入口 | NR-1, NR-5, NR-6 | 仓库存在正式 Hooks 产物，不再依赖 `_hooks_todo`，且默认入口不依赖服务器 |
| T-05 | 更新 `package.json files`、`index.js init/update/status`，将 Hooks 分发到目标项目 `.github/hooks/` | NR-5 | Hooks 可被分发、识别、状态检查 |
| T-06 | 更新 `scripts/validate.js` / pack 校验 | NR-5 | Hooks 漏分发、漏注册可被自动发现 |

### 阶段 3：规则语义改写

| # | 任务 | 关联需求 | 完成标准 |
|---|------|---------|---------|
| T-07 | 重写 `17-compliance` 中“第一批 tool call / 第一行输出”语义 | NR-2 | 改为宿主兼容的状态契约 |
| T-08 | 更新 README / RULES / 兼容性文档 | NR-7 | 明确软约束与硬保证边界，以及首阶段无需服务器部署 |
| T-09 | 与 `precheck` / `dev-compliance` / `exec-compliance` 需求建立交叉引用 | NR-1, NR-4 | 新旧需求关系清晰，无口径冲突 |

### 阶段 4：宿主验证与降级验证

| # | 任务 | 关联需求 | 完成标准 |
|---|------|---------|---------|
| T-10 | 在支持 Hooks 的 VS Code 宿主验证关键场景 | AC-1, AC-2, AC-3 | 关键场景全部可重现 |
| T-11 | 在无远程服务的本地环境验证 Hook MVP 可独立运行 | AC-7 | 本地闭环成立，无服务器前置 |
| T-12 | 在 fallback 宿主验证降级提示与行为边界 | AC-4 | 用户可见模式提示且无虚假承诺 |
| T-13 | 完成发布前文档与分发验证 | AC-5, AC-6 | 文档、status、pack、变更日志一致 |

### 阶段 5：Plugin-Native 演进评估（后置）

| # | 任务 | 关联需求 | 完成标准 |
|---|------|---------|---------|
| T-14 | 评估是否需要支持官方 plugin-native hooks 形态 | NR-1, NR-5 | 明确是否需要新增官方 manifest / `hooks.json` 支持 |
| T-15 | 若进入 plugin-native 阶段，定义与 Workspace Hooks 的共存/迁移策略 | NR-3 | 不破坏已有 Workspace Hooks 用户路径 |

---

## 实施顺序约束

1. 先定模式与职责，再写 Hooks 资产，避免一边实现一边改边界。
2. Hooks 进入正式分发面之前，不得对外宣称“宿主硬保证已完成”。
3. 文档兼容性声明必须与实际分发面同批发布，不能后补。
4. fallback 行为必须与 Hook 模式同时验证，不能只测“理想宿主”。
5. 首阶段不得把服务器部署或官方 plugin-native hooks 当作阻塞项；必须先完成本地 Workspace Hooks MVP。

---

## 验收清单

- [x] 三态模式命名冻结并写入文档
- [x] `hooks/` 正式进入仓库与分发面，并能分发到 `.github/hooks/`
- [x] `init/update/status` 可识别 Hooks 资产
- [x] `17-compliance` 完成宿主兼容改写
- [x] README / RULES / requirements 总览同步
- [ ] VS Code Hook 模式验证通过
- [x] 本地无服务器模式验证通过
- [ ] fallback 模式验证通过
- [ ] 需求变更日志已更新
