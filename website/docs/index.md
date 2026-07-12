---
pageType: home

hero:
  name: DevCodex
  text: AI 开发工作流规范注入器
  tagline: 为 Copilot / Claude Code / Codex 提供可安装、可审计、可恢复的统一开发工作流
  actions:
    - theme: brand
      text: 开始使用
      link: /intro/#快速开始
    - theme: alt
      text: GitHub 与安装说明
      link: https://github.com/vextjs/devcodex#安装

features:
  - title: 🎯 结构化工作流
    details: 8 种工作流（dev/fix/audit/analyze/self-fix/resume/plan/chat），执行流程骨架已冻结
  - title: 🛠️ 74 个 Skills
    details: 扁平化 Skill 体系，覆盖开发、修复、审计、默认分析、技术调研、自修复、规范治理、规范吸纳执行、最终用户文档、用户侧文档 review 聚合、专家型产物质量 expert-output-quality、产品策略/DX/UX/前端/后端/SRE/API 契约/外部集成/平台生态/AI Agent/数据/安全/质量/设计系统专家 Owner Skill、复审清单、README 用户视角写作与专项 review、发布前审查，以及执行契约、测试路由、发布验证、宿主契约验证、真相源-消费者同步等支撑能力
  - title: 🧩 三宿主分发
    details: Copilot、Claude Code 与 Codex 共用同一规范源；Hook 能力按宿主/事件降级，Codex 按事件契约使用顶层 decision、continue:false 或工具级 permissionDecision
  - title: 🔒 四层合规检查
    details: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）；chat 仅保留记忆与 dev 预检查
  - title: 🧠 跨会话记忆
    details: 三层记忆体系（Agent 日记 / 需求记忆 / 项目总记忆），支持 resume 恢复中断任务；MemoryCannotSatisfyBootstrapGate 要求宿主 Memories 只能作 navigation-hint，不能替代 Profile、tasks、reports 与文件真相源读取
  - title: ⚡ 双执行模式
    details: 确认模式（@DevCodex）与 Auto v1.1（@DevCodex Auto、全局默认 @rocky、Profile autoAliases 替换别名，或明确自然语言 auto 授权，白名单路径自动推进）；默认 safety-only 流程提醒放行，危险命令需用户确认 id 后才可一次性重试
  - title: 🏢 v2.0.0 多租户
    details: v2 系列规划中，用于平台化与多租户方向
---
