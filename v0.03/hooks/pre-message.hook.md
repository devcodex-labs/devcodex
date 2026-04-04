---
name: Pre Message Hook
description: 消息前置钩子 — 获取当前时间、安全底线检测、会话头输出
applyTo: **
---
# Pre Message Hook

## 触发时机

每次用户发送消息前自动执行（平台 `before_message` 事件）。

## 执行步骤

| 步骤 | 动作 | 失败处理 |
|------|------|---------|
| ① GET_TIME | 从系统工具获取当前时间 `YYYY-MM-DD HH:MM` | 填 `unknown`，不阻断 |
| ② READ_RULES | 加载 `RULES.md`（≤80行） | 降级：仅加载 `instructions/00-safety.instructions.md` |
| ③ SAFETY_OK | 验证 S01~S06 安全底线 | 失败则拒绝执行，告知用户 |
| ④ LOAD_COMMON | 加载 `instructions/01-common.instructions.md` | 降级：仅安全底线 |
| ⑤ INTENT | 通过 `intent` Skill（`skills/core/intent/SKILL.md`）识别用户意图 | 兜底 → `other` |
| ⑥ LOAD_PROFILE | 确定 `<project>`，加载 profile（⑤ 意图确认后串行执行） | null 则跳过 |
| ⑦ PRECHECK_OUTPUT | 输出会话头信息（`precheck-status.prompt.md`） | — |

## 安全底线检测（S01~S06）

| 编号 | 规则 | 违反处理 |
|------|------|---------|
| S01 | 删除/破坏性操作需确认（不可逆操作必须等待用户明确 yes/no；可逆操作输出计划后执行） | 不可逆→立即阻断等待确认；可逆→提示后执行 |
| S02 | 禁止硬编码敏感信息（API Key / 密码 / Token / 私钥等不得出现在代码/配置/注释中） | 立即拒绝，写入违规审计记录 |
| S03 | 禁止编造规范内容（规范不存在或读取失败时按降级路径执行，不得凭 AI 推测补全规范） | 立即终止，输出 ⚠️ 警告 |
| S04 | 禁止 overwrite 源码/规范文件（.md 文件修改必须使用增量编辑，禁止整文件覆盖） | 拒绝整文件覆盖，自动改用增量编辑 |
| S05 | 记忆+报告自动写入（每次会话结束前必须写入记忆和报告，禁止询问用户是否需要） | 合规检查节点发现遗漏时立即补写 |
| S06 | 禁止执行危险命令（不可逆破坏性命令如 DROP TABLE / rm -rf / TRUNCATE 必须先输出预览等待确认） | 拒绝直接执行，输出命令预览等待确认 |

## 输出

执行成功后输出 `precheck-status.prompt.md` 中定义的会话头格式。

## Token 检查

加载 `token-check` Skill（`skills/token/token-check/SKILL.md`），确定当前授权层级，供后续工作流功能门控使用。
