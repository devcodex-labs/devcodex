> **项目**: DevCodex
> **类型**: dev
> **子类型**: default（新功能）
> **创建日期**: 2026-04-04
> **Agent**: copilot
> **状态**: 已完成

# 02 — dev/prod 模式切换

## CP 确认记录

| CP | 状态 | 用户响应 |
|:--:|:----:|---------|
| CP1 | ✅ | 确认需求理解（分析触发点后）|
| CP2 | ✅ | 确认技术方案 |
| CP3 | ✅ | 确认实施计划 |

## 变更文件

| # | 操作 | 文件 | 说明 |
|:-:|------|------|------|
| 1 | 新增 | `.devcodex/profile/config.json` | 运行模式配置，当前 `mode: "dev"` |
| 2 | 修改 | `skills/routing/load-profile/SKILL.md` | 新增 config.json 标准文件行 + ENV_MODE 注入节 |
| 3 | 修改 | `skills/core/compliance/SKILL.md` | 新增 §0 模式判断节（dev 仅执行 FC4/FC5）|
| 4 | 修改 | `skills/core/cp-gate/SKILL.md` | 新增模式判断节（dev 模式 CP 不强制等待）|

## 功能说明

### 切换方式

编辑 `.devcodex/profile/config.json`：

```json
{ "mode": "dev" }   // 开发模式：轻量合规
{ "mode": "prod" }  // 生产模式：全量合规
```

### 各模式行为对比

| 行为 | dev | prod |
|------|:---:|:----:|
| FC4/FC5（路径/产物输出）| ✅ 执行 | ✅ 执行 |
| FC1/FC2（记忆/报告写入）| ⏭️ 跳过 | 🔴 强制 |
| FC3（CP 按序）| ⏭️ 跳过 | 🔴 强制 |
| SC1~SC13 | ⏭️ 跳过 | 🔴 强制 |
| RC1~RC4 | ⏭️ 跳过 | 🔴 强制 |
| CP 等待确认 | 🟡 建议性 | 🔴 阻断等待 |
| S01~S06 安全底线 | 🔴 始终强制 | 🔴 始终强制 |

## 后续建议

1. **发布前切换为 prod**：发版前将 `config.json` 改为 `mode: prod`，运行完整合规检查后再发布
2. **`devcodex update` 不同步 `.devcodex/`**：config.json 是项目私有配置，不会被覆盖（.devcodex/ 不在 files 字段中）
