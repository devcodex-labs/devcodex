# 需求总览

> **定位**：本目录是 DevCodex `v1.0.1` 的活动需求入口，承接 `1.0.0` 之后的新增需求、Bug 修复和发布准备。  
> **约束**：`1.0.0` 继续只做历史基线，不再回写。

## 当前已建立内容

| 模块 | 状态 | 说明 |
|------|------|------|
| 版本入口与导航 | ✅ 已建立 | `versions/`、`v1/` 和 sidebar 已接入 `1.0.1` |
| 具体需求条目 | ✅ 已补充首批索引 | 近期 light-api、frontend-api、目标文档前置、实施后复审、Claude MCP/合规漂移修复均从本目录追踪 |

## 当前需求索引

| 优先级 | 主题 | 状态 | 说明 |
|--------|------|------|------|
| P1 | 轻量接口文档与前端接口文档支持 | ✅ 已实现 | `dev-docs` 支持 light-api / frontend-api 双模式目标文档 |
| P1 | 条件触发的目标文档前置 | ✅ 已实现 | API/前端契约驱动型需求可在 CP1 后先冻结目标文档，再进入 CP2 技术方案 |
| P1 | 实施后复审阶段显式化 | ✅ 已实现 | dev/fix 主链统一表达为“执行 → 轻量复审收敛 → 完成” |
| P1 | Claude Code MCP 与 permissions 同步修复 | ✅ 已实现 | `.mcp.json` 对齐 Claude Code `mcpServers`，`.claude/settings.json` 预批准常用工具与项目 MCP |
| P1 | 合规编号与验证链漂移修复 | ✅ 已实现 | C19、FC7、SC15、profile/README 统计和 validate 探针同步 |

## 版本内开发规则

1. 新增需求优先创建在 `v1/1.0.1/requirements/` 下。
2. Bug 修复或发布准备，也应先在当前活动版本目录内留痕，而不是回写 `1.0.0`。
3. 发版前先同步版本文档，再同步 `package.json`、`plugin.json` 和对应 CHANGELOG。

## 参考

- [v1.0.1 版本概述](/versions/v1/1.0.1/)
- [v1.0.1 需求变更日志](/versions/v1/1.0.1/CHANGELOG)
- [v1.0.0 基线快照](/versions/v1/1.0.0/)
