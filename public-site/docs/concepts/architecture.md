# 架构怎么跑

## 你在问什么

一条请求进去之后，DevCodex 先判断你要做什么，再决定读哪些项目资料、加载哪些 Skill、会不会改文件。它不代替模型思考，也不托管模型。

## 心智模型

把 DevCodex 看成本地的工作流控制层：

1. 识别意图和项目边界。
2. 按需读取 Profile、记忆和相关源码。
3. 只加载当前阶段需要的 Skill。
4. 在确认边界内执行，用验证和报告结束，必要时跨会话续接。

<ol className="devcodex-process-flow devcodex-process-flow--five" aria-label="DevCodex 从请求到交付的五个阶段">
  <li>
    <strong>用户请求</strong>
    <span>先理解最终要结论还是变更。</span>
  </li>
  <li>
    <strong>意图与项目</strong>
    <span>识别 workflow，并绑定唯一 active-root。</span>
  </li>
  <li>
    <strong>有界上下文</strong>
    <span>按需读取 Profile、记忆和相关源码。</span>
  </li>
  <li>
    <strong>专业执行</strong>
    <span>加载当前 Skill，保持只读或在确认后写入。</span>
  </li>
  <li>
    <strong>证据闭环</strong>
    <span>验证、报告，并留下可续接锚点。</span>
  </li>
</ol>

工作流决定“能不能写、何时确认、怎样算完成”；Skill 负责某个专业问题；Hook 与 MCP 只是宿主可用时的执行手段，不能反过来改变用户目标。

状态、报告和记忆写在项目本地文件里。模型调用仍走你选的宿主。

## 示例

你说「分析当前架构风险，只分析不改文件」。控制层会把它判成只读的 `analyze`，不会进入改代码的确认。

你说「为这个 API 增加幂等，确认后实施」。它会走 `dev`，先整理需求再改文件。

## 边界

- 不是模型网关，不代理调用。
- 不是通用 Agent 框架，也不会因为加载某个 Skill 就改掉你的目标。
- 六个宿主流程一致，Hook、MCP、权限并不完全相同。见 [宿主边界](/reference/hosts)。
- configured 只表示配置存在，adapter contract、native probe 和最终 readiness 仍要分别取证。
- 报告和记忆是恢复依据，不是绕过当前文件事实与原确认边界的授权。

## 相关页

[意图驱动](/concepts/intent-driven) · [Profile、上下文与记忆](/concepts/profile-context-memory) · [工作流总览](/workflows/) · [5 分钟开始](/guide/getting-started)
