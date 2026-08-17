---
pageType: home
hero:
  name: DevCodex
  text: Intent-driven AI Coding Workflow Runtime
  tagline: 让 AI 编程从一次性聊天，变成可验证、可续接的工程流程。
  actions:
    - text: 5 分钟开始
      link: /guide/getting-started
      theme: brand
    - text: 查看工作流
      link: /reference/workflows
      theme: alt
features:
  - title: 理解真实任务
    details: 识别用户目的、目标项目、作用域和风险，而不是只匹配关键词。
  - title: 按需加载上下文
    details: 从项目 Profile、文件记忆和相关源码中读取当前任务真正需要的信息。
  - title: 渐进路由 Skill
    details: 只加载匹配当前阶段的工作流、领域、交付治理或 Workspace Skill。
  - title: 治理执行边界
    details: 区分只读与变更流程，保留确认、危险操作和宿主能力边界。
  - title: 用证据结束任务
    details: 记录验证、报告与剩余风险，不把一句“完成”当作证据。
  - title: 支持跨会话续接
    details: 通过项目文件状态恢复长任务，减少每次重新解释背景。
---

# DevCodex

DevCodex 是面向 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor 的意图驱动 AI Coding 工作流运行时。

<!-- devcodex-public:workflows primary=dev,fix,analyze,audit,resume,chat advanced=self-fix,other -->
<!-- devcodex-public:skills total=86 active=83 gray=3 bucket=80+ -->
<!-- devcodex-public:hosts ids=copilot,claude,codex,gemini,grok,cursor variants=13 -->
<!-- devcodex-public:auto canonical=@devcodex-auto default=@rocky profile-replacement=true empty-array-disables=true -->

它不会托管模型，也不是通用 Agent 框架或多 Agent 编排器。它在本地保存工作流状态、Profile、报告、记忆和项目 Skill；模型执行与数据处理仍遵循所选宿主的规则。

```bash
npm install -g devcodex
cd <你的项目根目录>
devcodex init
devcodex status
```

从 [5 分钟开始](/guide/getting-started)，或先了解 [工作流](/reference/workflows)、[Skill](/reference/skills) 与 [六宿主能力边界](/reference/hosts)。
