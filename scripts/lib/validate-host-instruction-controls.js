'use strict'

const crypto = require('crypto')

function buildHostInstructionControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx

  function requireFile(relative) {
    if (!fs.existsSync(path.join(ROOT, relative))) err(`[V103] missing host projection artifact: ${relative}`)
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
      'scripts/generate-host-instruction-projections.js',
      'scripts/test-host-instruction-projection.js',
      'scripts/test-host-adapters.js',
      'scripts/test-host-installation.js',
      'hooks/_runtime/lifecycle-host-adapters.cjs',
      'host-projections/AGENTS.md',
      'host-projections/AGENTS.workspace-bridge.md',
      'host-projections/copilot-instructions.md',
      'host-projections/CLAUDE.md',
      'host-projections/GEMINI.md',
      'host-projections/coverage.json',
      'gemini/settings.json',
      'grok/hooks/devcodex.json',
      'grok/skills/devcodex-workspace/SKILL.md',
      'grok/mcp/workspace-bridge.cjs',
      'grok/workspace-config.toml'
    ]
    required.forEach(requireFile)
    if (required.some(relative => !fs.existsSync(path.join(ROOT, relative)))) return

    const coverage = JSON.parse(String(read(path.join(ROOT, 'host-projections/coverage.json'))))
    const source = String(read(path.join(ROOT, 'instructions.md')))
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
      if (!content.includes('@AGENTS.md')) err(`[V103] wrapper pointer missing: ${relative}`)
      if (Buffer.byteLength(content, 'utf8') > coverage.budgets.wrapperMaxBytes) err(`[V103] wrapper budget exceeded: ${relative}`)
    }
    const bridge = String(read(path.join(ROOT, 'host-projections/AGENTS.workspace-bridge.md')))
    if (!bridge.includes('projectionRole: workspace-bridge') || !bridge.includes('.grok/skills/devcodex-workspace/SKILL.md')) {
      err('[V103] Grok workspace bridge discovery contract missing')
    }
    if (Buffer.byteLength(bridge, 'utf8') > coverage.budgets.wrapperMaxBytes) {
      err('[V103] Grok workspace bridge budget exceeded')
    }
    const grokHooks = JSON.parse(String(read(path.join(ROOT, 'grok/hooks/devcodex.json'))))
    for (const event of ['UserPromptSubmit', 'Stop', 'PreCompact']) {
      if (grokHooks.hooks?.[event]?.some(group => Object.prototype.hasOwnProperty.call(group, 'matcher'))) {
        err(`[V103] Grok lifecycle event must omit tool matcher: ${event}`)
      }
    }
    for (const event of ['PreToolUse', 'PostToolUse']) {
      if (!grokHooks.hooks?.[event]?.length) err(`[V103] Grok tool hook missing: ${event}`)
    }
    const grokConfig = String(read(path.join(ROOT, 'grok/workspace-config.toml')))
    for (const anchor of [
      'devcodex-managed:devcodex-memory',
      'devcodex-managed:devcodex-profile',
      '[mcp_servers.devcodex-memory]',
      '[mcp_servers.devcodex-profile]',
      '.grok/mcp/workspace-bridge.cjs'
    ]) {
      if (!grokConfig.includes(anchor)) err(`[V103] Grok workspace MCP config missing: ${anchor}`)
    }
    if (fs.existsSync(path.join(ROOT, 'grok', 'rules'))) err('[V103] Grok must not receive a duplicate rules tree')

    const pkg = JSON.parse(String(read(path.join(ROOT, 'package.json'))))
    for (const script of ['test:host-instruction-projection', 'test:host-adapters', 'test:host-installation']) {
      if (!pkg.scripts?.[script]) err(`[V103] package script missing: ${script}`)
    }
    for (const packaged of ['gemini/', 'grok/', 'host-projections/', 'scripts/lib/host-instruction-projection.js', 'scripts/lib/host-surface-descriptors.js']) {
      if (!pkg.files?.includes(packaged)) err(`[V103] package files missing: ${packaged}`)
    }
    const plugin = JSON.parse(String(read(path.join(ROOT, 'plugin.json'))))
    if (!plugin.skills?.some(skill => skill.id === 'host-instruction-projection')) {
      err('[V103] plugin registry missing host-instruction-projection')
    }
    for (const keyword of ['gemini-cli', 'grok']) {
      if (!plugin.keywords?.includes(keyword)) err(`[V103] plugin keyword missing: ${keyword}`)
    }

    const cliSource = [
      'scripts/lib/cli-command-registry.js',
      'scripts/lib/cli-install-commands.js',
      'scripts/lib/cli-host-utils.js',
      'scripts/lib/host-surface-descriptors.js'
    ].map(relative => String(read(path.join(ROOT, relative)))).join('\n')
    for (const anchor of [
      '--host',
      'CLI_HOST_UNSUPPORTED',
      'CLI_HOST_SELECTION_CONFLICT',
      'HOST_INSTRUCTION_COLLISION',
      'DEFAULT_HOSTS',
      'grok-workspace-bridge',
      'resolveGrokWorkspaceBridge',
      'mergeGrokWorkspaceConfig'
    ]) {
      if (!cliSource.includes(anchor)) err(`[V103] CLI host contract missing: ${anchor}`)
    }

    const manifest = JSON.parse(String(read(path.join(ROOT, 'scripts/validation-manifest.json'))))
    for (const nodeId of ['host-instruction-projection', 'host-adapters', 'host-installation']) {
      if (!manifest.nodes?.some(node => node.id === nodeId)) err(`[V103] validation node missing: ${nodeId}`)
      for (const route of ['fast', 'full', 'profile-deploy', 'package-release']) {
        if (!manifest.routes?.[route]?.nodes?.includes(nodeId)) err(`[V103] ${route} route omits ${nodeId}`)
      }
    }
    console.log('[V103] host kernel coverage / budget / five-host distribution / collision closure checked')
  }

  return { checkV103 }
}

module.exports = { buildHostInstructionControlChecks }
