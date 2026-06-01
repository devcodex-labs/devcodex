'use strict'

function buildGovernancePromptChecks(ctx) {
  const { mustInclude, mustNotInclude, console } = ctx

  function checkV13() {
    mustInclude('prompts/precheck-status.prompt.md', 'PC7 新会话首步 resume 强制检测', 'precheck prompt')
    mustInclude('prompts/precheck-status.prompt.md', '全模式入口检查', 'precheck prompt')
    mustInclude('prompts/precheck-status.prompt.md', '项目现实扩展后', 'precheck prompt')
    mustInclude('prompts/precheck-status.prompt.md', 'prod：输出 PC0~PC7 基础入口检查', 'precheck prompt')
    mustNotInclude('prompts/precheck-status.prompt.md', 'chat：不输出预检查块', 'precheck prompt')

    mustInclude('prompts/token-setup.prompt.md', '当前版本所有功能全量开放', 'token prompt')
    mustInclude('prompts/token-setup.prompt.md', 'DEVCODEX_TOKEN` 是未来服务端授权预留环境变量', 'token prompt')
    mustNotInclude('prompts/token-setup.prompt.md', 'your_token_here', 'token prompt')
    mustNotInclude('prompts/token-setup.prompt.md', 'echo $DEVCODEX_TOKEN', 'token prompt')

    const reportPrompts = [
      'prompts/report-analysis.prompt.md',
      'prompts/report-dev.prompt.md',
      'prompts/report-fix.prompt.md',
      'prompts/report-optimization.prompt.md',
      'prompts/report-scenario-test.prompt.md'
    ]
    for (const file of reportPrompts) {
      mustInclude(file, '**类型**', file)
      mustInclude(file, '**Agent**', file)
      mustInclude(file, '验证状态', file)
      mustInclude(file, '影响范围', file)
    }
    mustInclude('prompts/report-fix.prompt.md', 'CP 确认记录', 'fix report prompt')
    mustInclude('prompts/report-fix.prompt.md', '修复三步扫描', 'fix report prompt')
    mustInclude('prompts/report-fix.prompt.md', '**事件时间**: YYYY-MM-DD HH:MM:SS', 'fix report prompt')

    mustInclude('prompts/reply-summary.prompt.md', 'tasks/YYYYMMDD.md', 'reply summary prompt')
    mustInclude('prompts/reply-summary.prompt.md', 'chat 豁免报告，不豁免记忆', 'reply summary prompt')
    mustNotInclude('prompts/reply-summary.prompt.md', '.devcodex/.memory/clients/<agent>/chat/YYYYMMDD.md', 'reply summary prompt')
    mustNotInclude('prompts/reply-summary.prompt.md', '保留 7 天', 'reply summary prompt')
    mustInclude('prompts/memory-session.prompt.md', '收到首条用户消息时', 'memory session prompt')
    mustInclude('instructions.md', '当前实际宿主优先', 'instructions actual host agent priority')
    mustInclude('instructions/15-memory.instructions.md', '当前实际宿主（优先）', '15-memory actual host agent priority')
    mustInclude('instructions/15-memory.instructions.md', 'Profile agent 兜底', '15-memory profile agent fallback')
    mustInclude('skills/memory/SKILL.md', '当前实际宿主（优先）', 'memory skill actual host agent priority')
    mustInclude('skills/memory/SKILL.md', 'Profile agent 兜底', 'memory skill profile agent fallback')
    mustInclude('skills/load-profile/SKILL.md', 'config.json.agent` 只用于当前实际宿主无法可靠判断时的 fallback hint', 'load-profile agent fallback')
    mustInclude('mcp/profile-server.js', 'profileAgent', 'profile MCP exposes fallback agent')
    mustInclude('mcp/memory-server.js', 'DEVCODEX_AGENT', 'memory MCP runtime agent')
    mustInclude('scripts/test-mcp-servers.js', 'testProfileAgentUsesRuntimeBeforeProfileFallback', 'MCP actual host agent test')
    mustInclude('scripts/test-mcp-servers.js', 'testMemoryActualHostEnvAgent', 'MCP memory actual host test')
    mustInclude('mcp/memory-server.js', 'workspace-namespace memory scope is ambiguous', 'memory MCP explicit workspace scope')
    mustInclude('scripts/test-mcp-servers.js', 'testWorkspaceRootMemoryScopeRequiresExplicitTarget', 'MCP workspace scope ambiguity test')
    mustInclude('instructions/15-memory.instructions.md', 'MCP memory scope（workspace-namespace）', '15-memory explicit MCP scope')
    mustInclude('skills/memory/SKILL.md', 'MCP memory scope（workspace-namespace）', 'memory skill explicit MCP scope')
    mustNotInclude('instructions/15-memory.instructions.md', 'Profile 显式配置**（优先）', '15-memory legacy profile-priority agent')
    mustNotInclude('skills/memory/SKILL.md', 'Profile 显式配置**（优先）', 'memory skill legacy profile-priority agent')

    mustInclude('prompts/api-verification.prompt.md', '不在脚本内自启服务', 'api verification prompt')
    mustInclude('prompts/api-verification.prompt.md', '仅作为人工检查提示', 'api verification prompt')
    mustInclude('prompts/api-verification.prompt.md', '@resourceId = replace-with-created-id', 'api verification prompt')
    mustInclude('prompts/api-verification.prompt.md', 'new URL(path, BASE_URL)', 'api verification prompt')
    mustNotInclude('prompts/api-verification.prompt.md', '// ... HTTP 请求实现', 'api verification prompt')
    mustNotInclude('prompts/api-verification.prompt.md', 'tests/api/<module>.test.cjs', 'api verification prompt')
    mustInclude('skills/api-verification/SKILL.md', '禁止自启服务', 'api verification skill')
    mustInclude('skills/api-verification/SKILL.md', "const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000'", 'api verification skill')
    mustInclude('skills/api-verification/SKILL.md', 'headers = {}', 'api verification skill')
    mustInclude('skills/api-verification/SKILL.md', '请求样本 + 可选轻提示', 'api verification skill')
    mustNotInclude('skills/api-verification/SKILL.md', "hostname: 'localhost'", 'api verification skill')
    mustInclude('skills/dev-scenario-test/SKILL.md', '.devcodex/scenario-tests', 'scenario test skill')
    mustInclude('skills/dev-testing/SKILL.md', '项目自身 API 测试可另存 `tests/api/`', 'dev testing skill')
    mustInclude('skills/dev-testing/SKILL.md', 'tsc --noEmit', 'dev testing skill')
    mustInclude('skills/dev-testing/SKILL.md', '临时创建 `tsconfig`', 'dev testing skill')
    mustInclude('instructions/10-dev.instructions.md', 'tsc --noEmit', '10-dev typecheck rule')
    mustInclude('instructions/11-fix.instructions.md', 'tsc --noEmit', '11-fix typecheck rule')
    mustInclude('instructions/17-compliance.instructions.md', '入口检查（所有模式', '17-compliance all-mode entry check')
    mustInclude('instructions/17-compliance.instructions.md', '项目现实扩展后', '17-compliance project reality expansion')
    mustInclude('instructions/01-common.instructions.md', '项目现实扩展（Project Reality Expansion）', '01-common project reality expansion')
    mustInclude('skills/intent/SKILL.md', '项目现实扩展衔接', 'intent project reality expansion')
    mustInclude('skills/load-profile/SKILL.md', '项目现实扩展输出', 'load-profile project reality expansion')
    mustInclude('hooks/_runtime/lifecycle-bootstrap-state.cjs', 'entry check PC0-PC7', 'lifecycle all-mode entry check')
    mustInclude('hooks/_runtime/lifecycle.cjs', 'contextMessageOutput', 'lifecycle Codex UserPromptSubmit context')
    mustInclude('hooks/_runtime/lifecycle-hook-output.cjs', 'additionalContext', 'lifecycle Codex UserPromptSubmit context')
    mustInclude('hooks/_runtime/lifecycle-hook-output.cjs', 'warningOutput(reason, detail, eventName)', 'lifecycle Codex warning context')
    mustInclude('hooks/_runtime/lifecycle.cjs', 'INTERCEPTION_ACTION', 'lifecycle interception action model')
    mustInclude('hooks/_runtime/lifecycle-namespace-state.cjs', 'interceptions.jsonl', 'lifecycle interception audit log')
    mustInclude('hooks/_runtime/lifecycle.cjs', 'eventSupportsHardBlock', 'lifecycle host hard-block capability')
    mustInclude('hooks/_runtime/lifecycle-hook-output.cjs', 'normalizeHookEvent', 'lifecycle host event normalization')
    mustInclude('hooks/_runtime/lifecycle-dangerous-command.cjs', 'dangerous-command-confirmed', 'lifecycle dangerous command confirmation audit')
    mustInclude('hooks/_runtime/lifecycle-hook-output.cjs', 'stopReason', 'lifecycle Codex PreCompact contract output')
    mustInclude('hooks/_runtime/lifecycle-dangerous-command.cjs', 'devcodex-approve', 'lifecycle dangerous command approval marker')
    mustInclude('scripts/test-hooks-runtime.js', 'autoCodexEntryAllowed', 'hooks runtime Codex governance test')
    mustInclude('scripts/test-hooks-runtime.js', 'autoCodexHookAllowed', 'hooks runtime Codex governance test')
    mustInclude('scripts/lib/test-hooks-runtime-bootstrap-layout.js', 'multiProjectPromptWarning', 'hooks runtime Codex multi-project warning context')
    mustInclude('scripts/lib/test-hooks-runtime-visibility.js', 'dangerous-command-approved', 'hooks runtime dangerous command audit test')
    mustInclude('scripts/lib/test-hooks-runtime-visibility.js', 'strictStopBlock', 'hooks runtime strict Stop block test')
    mustInclude('index.js', 'cmdInitCodex', 'index Codex adapter')
    mustInclude('index.js', 'CODEX_HOOK_COMMAND', 'index Codex adapter')
    mustInclude('index.js', 'readCodexHookCommands', 'index Codex hook command diagnostics')
    mustInclude('index.js', 'Codex trust/config', 'index Codex trust/config diagnostics')
    mustInclude('index.js', 'hook guardrail (Codex; event-dependent)', 'index Codex event-dependent guardrail diagnostics')
    mustInclude('index.js', 'workspace-hooks detected (VS Code Copilot preview; verify target IDE)', 'index VS Code hook preview diagnostics')
    mustInclude('index.js', 'default safety-only warns/continues', 'index enforcement default diagnostics')
    mustInclude('codex/hooks.json', '.codex/hooks/_runtime/lifecycle.cjs', 'Codex hook config')
    mustInclude('README.md', 'OpenAI Codex app/CLI', 'README Codex support matrix')
    mustInclude('README.md', 'Codex hook guardrail', 'README Codex support matrix capability caveat')
    mustInclude('README.md', 'Hook 拦截动作语义', 'README interception action semantics')
    mustInclude('instructions.md', 'Hook 拦截动作语义', 'instructions interception action semantics')
    mustNotInclude('README.md', 'ChatGPT / OpenAI Codex', 'README Codex support matrix')
    mustNotInclude('README.md', '仅 instruction 注入，无运行时拦截', 'README support-level legend')
    mustNotInclude('README.md', 'OpenAI Codex app/CLI** | `AGENTS.md` + `.agents/skills/` + `.codex/hooks.json` | ✅ `lifecycle.cjs` | ✅ Hook | ❌ 未内置 MCP', 'README Codex MCP overclaim')
    mustInclude('prompts/technical-design.prompt.md', 'tsc --noEmit', 'technical design prompt')
    mustInclude('prompts/report-dev.prompt.md', '静态/类型检查', 'report dev prompt')
    mustInclude('prompts/report-fix.prompt.md', '静态/类型检查', 'report fix prompt')

    mustInclude('prompts/requirement.prompt.md', '## 目录导航', 'requirement prompt')
    mustInclude('prompts/requirement.prompt.md', '§0 需求类型判定', 'requirement prompt')
    mustInclude('prompts/requirement.prompt.md', '§2.1 核心定义', 'requirement prompt')
    mustInclude('prompts/requirement.prompt.md', '§2.2 作用域与边界判定', 'requirement prompt')
    mustInclude('prompts/requirement.prompt.md', '§9 当前阶段结论', 'requirement prompt')

    mustInclude('prompts/technical-design.prompt.md', '## 目录导航', 'technical design prompt')
    mustInclude('prompts/technical-design.prompt.md', '§1.3 关联目标文档', 'technical design prompt')
    mustInclude('prompts/technical-design.prompt.md', '§2.6 实施映射与范围边界', 'technical design prompt')
    mustInclude('prompts/technical-design.prompt.md', '偏移触发器', 'technical design prompt')

    mustInclude('prompts/implementation-plan.prompt.md', '## 目录导航', 'implementation plan prompt')
    mustInclude('prompts/implementation-plan.prompt.md', '§3 分批执行策略', 'implementation plan prompt')
    mustInclude('prompts/implementation-plan.prompt.md', '§4 关键实施约束', 'implementation plan prompt')
    mustInclude('prompts/implementation-plan.prompt.md', '§5 独立验证方式', 'implementation plan prompt')
    mustInclude('prompts/implementation-plan.prompt.md', '回滚触发条件', 'implementation plan prompt')

    mustInclude('prompts/implementation-progress.prompt.md', '## 目录导航', 'implementation progress prompt')
    mustInclude('prompts/implementation-progress.prompt.md', '是否阻断主线', 'implementation progress prompt')
    mustInclude('prompts/implementation-progress.prompt.md', '责任方', 'implementation progress prompt')
    mustInclude('prompts/implementation-progress.prompt.md', '预计解除时间', 'implementation progress prompt')
    mustInclude('prompts/implementation-progress.prompt.md', '下次检查点', 'implementation progress prompt')
    mustInclude('prompts/implementation-progress.prompt.md', '本轮验证结果', 'implementation progress prompt')

    mustInclude('prompts/project-readme.prompt.md', '## 目录导航', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '**项目类型**', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '用户 / 使用者优先', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '## 适用对象与使用场景', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '## 常见用法', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '## 常见问题与排错', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '## 开发与贡献', 'project readme prompt')
    mustInclude('prompts/project-readme.prompt.md', '### service / backend', 'project readme prompt')

    mustInclude('prompts/light-api-doc.prompt.md', '## 目录导航', 'light api doc prompt')
    mustInclude('prompts/light-api-doc.prompt.md', 'curl -X', 'light api doc prompt')
    mustInclude('prompts/light-api-doc.prompt.md', '典型成功响应', 'light api doc prompt')
    mustInclude('prompts/light-api-doc.prompt.md', '典型错误响应', 'light api doc prompt')

    mustInclude('prompts/general-doc.prompt.md', '## 目录导航', 'general doc prompt')
    mustInclude('prompts/general-doc.prompt.md', '**文档类型**', 'general doc prompt')
    mustInclude('prompts/general-doc.prompt.md', '## 4. 核心内容', 'general doc prompt')

    mustInclude('skills/dev-docs/SKILL.md', 'general-doc', 'dev docs skill')
    mustInclude('skills/dev-docs/SKILL.md', '所有 Markdown 文档必须包含 `## 目录导航`', 'dev docs skill')
    mustInclude('instructions/10-dev.instructions.md', 'Markdown 文档可读性要求', '10-dev docs readability rule')
    mustInclude('instructions/10-dev.instructions.md', '目标文档路径、文档模式', '10-dev target doc anchor rule')
    mustInclude('skills/dev-default/SKILL.md', '目标文档路径/模式/契约范围', 'dev default skill')
    mustInclude('skills/dev-default/SKILL.md', '目录导航', 'dev default skill')

    mustInclude('skills/cp-gate/SKILL.md', 'CP3: N/A', 'cp gate skill')
    mustInclude('skills/cp-gate/SKILL.md', '问题 ID 映射', 'cp gate audit-to-fix issue mapping')
    mustInclude('hooks/_runtime/lifecycle.cjs', 'CP3Exempt', 'lifecycle runtime')
    console.log('[V13] template semantic probes passed')
  }

  function checkV14() {
    mustInclude('agents/devcodex-auto.agent.md', '@devcodex-auto', 'auto agent')
    mustInclude('agents/devcodex-auto.agent.md', '白名单', 'auto agent')
    mustInclude('instructions/01-common.instructions.md', 'Auto v1.1 **唯一正式入口**为显式 `@devcodex-auto`', '01-common auto mode')
    mustInclude('instructions/01-common.instructions.md', '非白名单路径默认切回确认模式', '01-common auto mode')
    mustInclude('skills/cp-gate/SKILL.md', '白名单路径', 'cp-gate auto mode')
    mustInclude('skills/cp-gate/SKILL.md', 'instruction-fallback', 'cp-gate auto mode')
    mustInclude('skills/compliance/SKILL.md', 'hook-enforced', 'compliance auto mode')
    mustInclude('skills/compliance/SKILL.md', 'instruction-fallback', 'compliance auto mode')
    mustInclude('hooks/_runtime/lifecycle.cjs', 'AUTO_ALLOWED_PATH_PATTERNS', 'lifecycle runtime auto mode')
    mustInclude('hooks/_runtime/lifecycle.cjs', 'detectExecutionMode', 'lifecycle runtime auto mode')
    mustInclude('scripts/test-hooks-runtime.js', 'autoWhitelistAllowed', 'hooks runtime test')
    mustInclude('scripts/test-hooks-runtime.js', 'autoNonWhitelistBlocked', 'hooks runtime test')
    mustInclude('README.md', '白名单路径提供 runtime 级硬保证', 'README auto mode')
    mustInclude('README.md', '不承诺完全等价的自动放行', 'README auto mode')
    console.log('[V14] auto mode semantic probes passed')
  }

  return {
    checkV13,
    checkV14
  }
}

module.exports = { buildGovernancePromptChecks }
