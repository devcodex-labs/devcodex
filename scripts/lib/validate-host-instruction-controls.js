'use strict'

const crypto = require('crypto')
const { readControlInstructionRoot } = require('./control-content-delivery')

function buildHostInstructionControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx
  const logicalExists = file => typeof read.exists === 'function' ? read.exists(file) : fs.existsSync(file)

  function requireFile(relative) {
    if (!logicalExists(path.join(ROOT, relative))) err(`[V103] missing host projection artifact: ${relative}`)
  }

  function digest(content) {
    return crypto.createHash('sha256').update(String(content)).digest('hex')
  }

  function checkV103() {
    const required = [
      'skills/host-instruction-projection/SKILL.md',
      'scripts/host-instruction-projection.json',
      'scripts/lib/host-instruction-projection.js',
      'scripts/lib/host-surface-descriptors.js',
      'scripts/lib/global-host-target.js',
      'scripts/lib/global-host-config.js',
      'scripts/lib/global-host-config-merge.js',
      'scripts/lib/global-host-config-transaction.js',
      'scripts/lib/host-adapter-scope.js',
      'scripts/lib/grok-workspace-launcher.js',
      'scripts/generate-host-instruction-projections.js',
      'scripts/test-host-instruction-projection.js',
      'scripts/test-host-adapters.js',
      'scripts/test-host-installation.js',
      'scripts/test-global-host-config.js',
      'scripts/test-global-install-smoke.js',
      'hooks/_runtime/lifecycle-host-adapters.cjs',
      'host-projections/AGENTS.md',
      'host-projections/copilot-instructions.md',
      'host-projections/CLAUDE.md',
      'host-projections/GEMINI.md',
      'host-projections/coverage.json',
      'gemini/settings.json',
      'grok/hooks/devcodex.json',
      'grok/plugins/devcodex-workspace/.claude-plugin/plugin.json',
      'grok/plugins/devcodex-workspace/.mcp.json',
      'grok/plugins/devcodex-workspace/hooks/hooks.json',
      'grok/plugins/devcodex-workspace/hooks/devcodex-workspace.cjs',
      'grok/plugins/devcodex-workspace/lib/runtime-root.cjs',
      'grok/plugins/devcodex-workspace/skills/devcodex-workspace/SKILL.md',
      'grok/plugins/devcodex-workspace/mcp/workspace-bridge.cjs',
      'grok/skills/devcodex-workspace/SKILL.md',
      'grok/mcp/workspace-bridge.cjs',
      'grok/workspace-config.toml',
      'cursor/plugins/devcodex-workspace/.cursor-plugin/plugin.json',
      'cursor/plugins/devcodex-workspace/skills/devcodex-workspace/SKILL.md',
      'host-projections/AGENTS.workspace-bridge.md'
    ]
    required.forEach(requireFile)
    if (required.some(relative => !logicalExists(path.join(ROOT, relative)))) return

    const coverage = JSON.parse(String(read(path.join(ROOT, 'host-projections/coverage.json'))))
    const source = readControlInstructionRoot(ROOT).toString('utf8')
    if (coverage.schemaVersion !== 'HostInstructionCoverageReceiptV1') err('[V103] coverage schema drift')
    if (coverage.sourceDigest !== digest(source)) err('[V103] projection source digest is stale')
    if (coverage.mode !== 'kernel') err(`[V103] projection unexpectedly fell back: ${coverage.mode}`)
    if (!coverage.ruleCoverage?.length || coverage.ruleCoverage.some(rule => rule.covered !== true)) {
      err('[V103] mandatory S/C rule coverage is incomplete')
    }
    if (!coverage.semanticCoverage?.length || coverage.semanticCoverage.some(group => group.covered !== true)) {
      err('[V103] semantic coverage is incomplete')
    }

    for (const relative of ['host-projections/AGENTS.md', 'host-projections/copilot-instructions.md']) {
      const content = String(read(path.join(ROOT, relative)))
      const bytes = Buffer.byteLength(content, 'utf8')
      const lines = content.split(/\r?\n/).length
      if (bytes > coverage.budgets.kernelMaxBytes || lines > coverage.budgets.kernelMaxLines) {
        err(`[V103] kernel budget exceeded: ${relative} bytes=${bytes} lines=${lines}`)
      }
    }
    for (const relative of ['host-projections/CLAUDE.md', 'host-projections/GEMINI.md']) {
      const content = String(read(path.join(ROOT, relative)))
      if (!content.includes('@devcodex/runtime/AGENTS.md')) err(`[V103] wrapper pointer missing: ${relative}`)
      if (Buffer.byteLength(content, 'utf8') > coverage.budgets.wrapperMaxBytes) err(`[V103] wrapper budget exceeded: ${relative}`)
    }
    const grokPluginManifest = JSON.parse(String(read(path.join(ROOT, 'grok/plugins/devcodex-workspace/.claude-plugin/plugin.json'))))
    if (grokPluginManifest.name !== 'devcodex-workspace' || !grokPluginManifest.version) {
      err('[V103] Grok workspace plugin identity missing')
    }
    const grokHooks = JSON.parse(String(read(path.join(ROOT, 'grok/plugins/devcodex-workspace/hooks/hooks.json'))))
    for (const event of ['UserPromptSubmit', 'Stop', 'PreCompact']) {
      if (grokHooks.hooks?.[event]?.some(group => Object.prototype.hasOwnProperty.call(group, 'matcher'))) {
        err(`[V103] Grok lifecycle event must omit tool matcher: ${event}`)
      }
    }
    for (const event of ['PreToolUse', 'PostToolUse']) {
      if (!grokHooks.hooks?.[event]?.length) err(`[V103] Grok tool hook missing: ${event}`)
    }
    const grokMcp = JSON.parse(String(read(path.join(ROOT, 'grok/plugins/devcodex-workspace/.mcp.json'))))
    for (const server of ['devcodex-memory', 'devcodex-profile']) {
      if (!grokMcp.mcpServers?.[server]?.args?.some(value => String(value).includes('GROK_PLUGIN_ROOT'))) {
        err(`[V103] Grok workspace plugin MCP bridge missing: ${server}`)
      }
    }
    const pluginHookRuntime = String(read(path.join(ROOT, 'grok/plugins/devcodex-workspace/hooks/devcodex-workspace.cjs')))
    for (const anchor of ['outside-workspace', 'nearest-workspace-layout', 'global-adapter-missing', '../lib/runtime-root.cjs', 'passive-hook-no-context-injection', 'blocking-tool-hook']) {
      if (!pluginHookRuntime.includes(anchor)) err(`[V103] Grok user-global plugin contract missing: ${anchor}`)
    }
    const pluginMcpRuntime = String(read(path.join(ROOT, 'grok/plugins/devcodex-workspace/mcp/workspace-bridge.cjs')))
    if (!pluginMcpRuntime.includes('../lib/runtime-root.cjs')) {
      err('[V103] Grok MCP bridge must share the receipt-bound runtime resolver')
    }
    const pluginRuntimeResolver = String(read(path.join(ROOT, 'grok/plugins/devcodex-workspace/lib/runtime-root.cjs')))
    for (const anchor of ['GROK_HOME', 'global-host-receipt.json', 'RuntimeGenerationManifestV1', 'runtime-generation.json', 'isUnderPhysical']) {
      if (!pluginRuntimeResolver.includes(anchor)) err(`[V103] Grok runtime resolver contract missing: ${anchor}`)
    }
    for (const relative of [
      'grok/skills/devcodex-workspace/SKILL.md',
      'grok/mcp/workspace-bridge.cjs',
      'grok/workspace-config.toml',
      'host-projections/AGENTS.workspace-bridge.md'
    ]) {
      const legacySource = String(read(path.join(ROOT, relative)))
      if (!legacySource.includes('retired-compatibility-fixture') || !legacySource.includes('MUST NOT')) {
        err(`[V103] legacy project bridge source is not explicitly retired: ${relative}`)
      }
    }
    if (fs.existsSync(path.join(ROOT, 'grok', 'rules'))) err('[V103] Grok must not receive a duplicate rules tree')

    const cursorPluginManifest = JSON.parse(String(read(path.join(ROOT, 'cursor/plugins/devcodex-workspace/.cursor-plugin/plugin.json'))))
    if (
      cursorPluginManifest.name !== 'devcodex-workspace' ||
      !cursorPluginManifest.version ||
      cursorPluginManifest.skills !== './skills' ||
      cursorPluginManifest.mcpServers !== './mcp.json'
    ) {
      err('[V103] Cursor Beta plugin identity or capability paths missing')
    }
    const cursorResolverSkill = String(read(path.join(ROOT, 'cursor/plugins/devcodex-workspace/skills/devcodex-workspace/SKILL.md')))
    for (const anchor of ['skill_route', 'Do not recursively list', 'Cloud Agent', 'user-global', 'Never invent project', 'Next call (exact)']) {
      if (!cursorResolverSkill.includes(anchor)) err(`[V103] Cursor resolver Skill contract missing: ${anchor}`)
    }
    if (fs.existsSync(path.join(ROOT, 'cursor', 'plugins', 'devcodex-workspace', 'hooks'))) {
      err('[V103] Cursor Plugin must not duplicate the user-global hooks.json surface')
    }

    const pkg = JSON.parse(String(read(path.join(ROOT, 'package.json'))))
    for (const script of [
      'test:host-instruction-projection',
      'test:host-adapters',
      'test:host-installation',
      'test:global-host-config',
      'test:global-install-smoke'
    ]) {
      if (!pkg.scripts?.[script]) err(`[V103] package script missing: ${script}`)
    }
    for (const packaged of [
      'gemini/',
      'grok/',
      'cursor/',
      'host-projections/',
      'scripts/lib/host-instruction-projection.js',
      'scripts/lib/host-surface-descriptors.js',
      'scripts/lib/global-host-target.js',
      'scripts/lib/global-host-config.js',
      'scripts/lib/global-host-config-merge.js',
      'scripts/lib/global-host-config-transaction.js',
      'scripts/lib/host-adapter-scope.js',
      'scripts/lib/grok-workspace-launcher.js'
    ]) {
      if (!pkg.files?.includes(packaged)) err(`[V103] package files missing: ${packaged}`)
    }
    const plugin = JSON.parse(String(read(path.join(ROOT, 'plugin.json'))))
    if (!plugin.skills?.some(skill => skill.id === 'host-instruction-projection')) {
      err('[V103] plugin registry missing host-instruction-projection')
    }
    for (const keyword of ['gemini-cli', 'grok', 'cursor']) {
      if (!plugin.keywords?.includes(keyword)) err(`[V103] plugin keyword missing: ${keyword}`)
    }

    const cliSource = [
      'scripts/lib/cli-command-registry.js',
      'scripts/lib/cli-install-commands.js',
      'scripts/lib/cli-maintenance-commands.js',
      'scripts/lib/cli-host-utils.js',
      'scripts/lib/host-surface-descriptors.js',
      'scripts/lib/global-host-target.js',
      'scripts/lib/global-host-config.js',
      'scripts/lib/host-adapter-scope.js',
      'scripts/lib/grok-workspace-launcher.js'
    ].map(relative => String(read(path.join(ROOT, relative)))).join('\n')
    for (const anchor of [
      '--host',
      'CLI_HOST_CONFIG_GLOBAL_ONLY',
      'GlobalOnlyHostConfigModeV1',
      'GlobalOnlyWorkspaceCleanModeV1',
      'GlobalHostTargetV1',
      'GlobalHostConfigInspectionV1',
      'workspaceHostDirectoriesWritten',
      'npm install -g devcodex',
      'user-global',
      'legacyWorkspaceProjectionDescriptors',
      'GrokGlobalLaunchPlanV1',
      'GROK_LAUNCHER_CWD_CONFLICT',
      'global-launcher-rules'
    ]) {
      if (!cliSource.includes(anchor)) err(`[V103] CLI host contract missing: ${anchor}`)
    }

    const manifest = JSON.parse(String(read(path.join(ROOT, 'scripts/validation-manifest.json'))))
    const riskCoverage = JSON.parse(String(read(path.join(ROOT, 'scripts/critical-risk-coverage.json'))))
    const fastExclusions = new Set(riskCoverage.fastRoutePolicy?.excludedReleaseIntegrationNodes || [])
    for (const nodeId of [
      'host-instruction-projection',
      'host-adapters',
      'host-installation',
      'global-host-config',
      'global-install-smoke'
    ]) {
      if (!manifest.nodes?.some(node => node.id === nodeId)) err(`[V103] validation node missing: ${nodeId}`)
      for (const route of ['fast', 'full', 'profile-deploy', 'package-release']) {
        const included = manifest.routes?.[route]?.nodes?.includes(nodeId)
        if (route === 'fast' && fastExclusions.has(nodeId)) {
          if (included) err(`[V103] fast route unexpectedly includes release integration node ${nodeId}`)
        } else if (!included) {
          err(`[V103] ${route} route omits ${nodeId}`)
        }
      }
    }
    console.log('[V103] host kernel coverage / global-only six-host distribution / collision closure checked')
  }

  return { checkV103 }
}

module.exports = { buildHostInstructionControlChecks }
