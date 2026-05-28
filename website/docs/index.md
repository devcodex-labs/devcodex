---
pageType: home

hero:
  name: DevCodex
  text: AI 开发规范文档
  tagline: Copilot / Claude Code 双主支持升级到 Codex 三宿主支持 — 内部开发规范与版本演进文档
  actions:
    - theme: brand
      text: v1 系列概览
      link: /versions/v1/
    - theme: alt
      text: 当前需求文档
      link: /versions/v1/1.0.1/requirements/

features:
  - title: 🎯 结构化工作流
    details: 8 种工作流（dev/fix/audit/analyze/self-fix/resume/plan/chat），执行流程骨架已冻结
  - title: 🛠️ 39 个 Skills
    details: 扁平化 Skill 体系，覆盖开发、修复、审计、分析、自修复、规范治理，以及执行契约、测试路由、发布验证等支撑能力
  - title: 🧩 三宿主分发
    details: Copilot、Claude Code 与 Codex 共用同一规范源；Hook 能力按宿主/事件降级，Codex 按事件契约使用顶层 decision、continue:false 或工具级 permissionDecision
  - title: 🔒 四层合规检查
    details: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）；chat 仅保留记忆与 dev 预检查
  - title: 🧠 跨会话记忆
    details: 三层记忆体系（Agent 日记 / 需求记忆 / 项目总记忆），支持 resume 恢复中断任务
  - title: ⚡ 双执行模式
    details: 确认模式（@DevCodex）与 Auto v1.1（@DevCodex Auto，白名单路径自动推进）；默认 safety-only 流程提醒放行，危险命令需用户确认 id 后才可一次性重试
  - title: 🏢 v2.0.0 多租户
    details: v2 系列规划中，用于平台化与多租户方向
---
