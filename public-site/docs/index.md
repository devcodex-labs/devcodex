---
pageType: home
hero:
  name: DevCodex
  text: Cross-host AI Coding Engineering Harness
  tagline: 让 AI Coding 从“聪明地回答问题”，升级为“聪明地完成工程任务”。
  actions:
    - text: 5 分钟开始
      link: /guide/getting-started
      theme: brand
    - text: 能解决什么
      link: /guide/common-tasks
      theme: alt
    - text: 续接案例
      link: /examples/resume
      theme: alt
features:
  - title: 1. 先判断意图
    details: 先决定这次是分析、修复还是开发，会不会改文件。不是只匹配关键词。
    link: /concepts/intent-driven
  - title: 2. 再加载上下文
    details: 只读当前任务需要的 Profile、记忆和源码，不会把整个仓库塞进模型。
    link: /concepts/profile-context-memory
  - title: 3. 按需路由 Skill
    details: 只加载当前阶段的专业流程。看到 Skill 目录不等于已经全部生效。
    link: /concepts/progressive-skill-routing
  - title: 4. 工作流划定边界
    details: analyze 只读，fix/dev 要确认后才改文件。六个主工作流各有独立说明。
    link: /workflows/
  - title: 5. 用证据结束
    details: 完成必须对应验证和报告，不能只靠一句「做好了」。
    link: /concepts/evidence-and-completion
  - title: 6. 跨会话续接
    details: 进度写在项目文件里。新会话说「继续任务名」即可接着做。
    link: /examples/resume
---

# DevCodex

DevCodex 是面向 Codex、Claude Code、GitHub Copilot、Gemini CLI、Grok 和 Cursor 的跨宿主 AI Coding 工程 Harness。它的技术实现仍是 intent-driven、local-first、file-backed 的 workflow runtime and host-adapter layer。

长任务恢复按正式需求/任务保存，而不是按每次 Hook/工具状态变化创建 UUID 全快照；正式任务数量没有硬上限，磁盘按 256/512 MiB soft/hard 与 8 MiB closeout reserve 保护。查看占用、上限处理、legacy 零删除和 Token 估算，请读[运行态维护](/reference/runtime-operations)与[限制与边界](/reference/limits)。


它不会改变模型参数、权重、上下文窗口或基础推理上限。它通过项目上下文、专业 Skill、工作流、工具、记忆、验证和证据链提升真实软件工程中的有效智能表现；模型推理、原生 agent loop、认证、sandbox 与主要工具执行仍由所选宿主负责。

```bash
npm install -g devcodex
cd <你的项目根目录>
devcodex init
devcodex status
```

从 [5 分钟开始](/guide/getting-started)。想先看它怎么跑，读 [架构](/concepts/architecture) 和 [工作流总览](/workflows/)；想看一次跨会话续接，打开 [案例](/examples/resume)。

旧链接 [工作流参考](/reference/workflows)、[Skill](/reference/skills) 与 [六宿主能力边界](/reference/hosts) 仍然有效。
