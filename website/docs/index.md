---
pageType: home

hero:
  name: DevCodex
  text: AI 开发工作流规范注入器
  tagline: 默认适配 Copilot / Claude Code / Codex / Gemini / Grok 五宿主的统一开发工作流
  actions:
    - theme: brand
      text: 开始使用
      link: /intro/#快速开始
    - theme: alt
      text: GitHub 与安装说明
      link: https://github.com/vextjs/devcodex#安装

features:
  - title: 🎯 结构化工作流
    details: 8 种工作流 intent（dev/fix/audit/analyze/self-fix/resume/other/chat）；plan 由 other 兜底路由 + plan Skill 承接，不是独立 workflow id
  - title: 🛠️ 84 个 Skills
    details: 当前源码维护 81 active + 3 gray；新增 active `host-capability-routing`，以 portable-first 方式把用户意图映射到五宿主 8 个 surface variant，证据不足时不冒充 native；另有 `requirement-parallel-orchestration`，用于多需求并行前的独立性判定、共享面锁图、LaunchCard 与汇合协议；active `repair-prevention-assessment` 负责所有 repair 的完成门禁，gray `rework-prevention-engineering` 只负责长期效果试验，gray `brand-visual-quality` 承接品牌视觉资产质量，其余覆盖开发、修复、审计、规范吸纳执行、跨仓消费者验证、用户侧文档 review 聚合、`expert-output-quality` 专家型产物质量与 21 个专家 Owner Skill，以及宿主契约验证、真相源-消费者同步
  - title: 🧩 默认五宿主
    details: npm 全局安装/升级自动配置 Copilot、Claude Code、Codex、Gemini 与 Grok 的用户级 adapter；工作区只保留 `.devcodex`。五宿主共用精简 kernel、按需 Skills 与完整回退，能力声明受 direct/fixture/instruction-backed 证据上限约束
  - title: 📦 npm 安装自动适配
    details: 源码日常 `devcodex global-adapters apply` 刷新用户级五宿主 adapter；`npm install -g .` / pack+tarball 为本地旁路；已发布用 `npm install/update -g devcodex`；`npm install devcodex` 仅工作区依赖。`.devcodex` 保持 workspace-namespace
  - title: 🔒 四层合规检查
    details: FC（形式合规）→ SC（实质合规）→ RC（恢复性检查）→ T（任务完成验证）；另有入口 PC0~PC7 与安全底线 S01~S07；chat 仅保留记忆与入口检查
  - title: 🧠 跨会话记忆
    details: 三层记忆体系（Agent 日记 / 需求记忆 / 项目总记忆），支持 resume 恢复中断任务；MemoryCannotSatisfyBootstrapGate 要求宿主 Memories 只能作 navigation-hint，不能替代 Profile、tasks、reports 与文件真相源读取
  - title: ⚡ 双执行模式
    details: 确认模式（@DevCodex）与 Auto v1.1（@DevCodex Auto、全局默认 @rocky、Profile autoAliases 替换别名，或明确自然语言 auto 授权，白名单路径自动推进）；默认 safety-only 流程提醒放行，危险命令需用户确认 id 后才可一次性重试
  - title: 🏢 v2.0.0 多租户
    details: v2 系列规划中，用于平台化与多租户方向
---


> Skill 规模锚点：84 个按需触发；扁平一级 Skill（84 个）。
>
> Hook 能力按宿主/事件降级：默认注册 `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PreCompact` / `Stop`。用户级 adapter 已配置不代表每个宿主事件都具备相同的硬拦能力。
