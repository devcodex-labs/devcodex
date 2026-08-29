'use strict'

function collectHookCommands(config) {
  const commands = []
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    if (typeof value.command === 'string') commands.push(value.command)
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'command') visit(child)
    }
  }
  visit(config?.hooks || config)
  return commands
}

/** Build the read-only diagnostic helpers used by status and doctor. */
function createMaintenanceDiagnosticHelpers(options) {
  const { fs, path, c, codexHookCommand } = options

  function readCodexHookCommands(cwd) {
    const file = path.join(cwd, '.codex', 'hooks.json')
    const result = {
      file,
      exists: fs.existsSync(file),
      commands: [],
      invalidCommands: [],
      error: null
    }
    if (!result.exists) return result

    try {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'))
      result.commands = collectHookCommands(config)
      result.invalidCommands = result.commands.filter(command => command !== codexHookCommand)
    } catch (error) {
      result.error = String(error && error.message ? error.message : error)
    }
    return result
  }

  function formatGovernanceSummary(summary) {
    if (!summary || summary.schemaVersion !== 'GovernanceStatusSummaryV1') return c.dim('unavailable')
    const status = summary.status === 'pass' ? c.green('pass') : c.yellow(summary.status || 'warn')
    const runtime = summary.runtimeState || {}
    const skills = summary.skills || {}
    const gates = summary.gateLifecycle || {}
    const alwaysOn = summary.alwaysOn || {}
    const dirty = summary.dirtyBoundary || {}
    return `${status} ` +
      c.dim(`runtime ${runtime.recordCount || 0} records/${runtime.alertCount || 0} alerts; `) +
      c.dim(`skills ${skills.skillCount || 0} (${skills.activeSkillCount || 0} active/${skills.graySkillCount || 0} gray); `) +
      c.dim(`always-on ${alwaysOn.shadow?.sampleCount || 0}/${alwaysOn.shadow?.p0MissedCount || 0} shadow; `) +
      c.dim(`gates ${gates.groupCount || 0}; fast-path ${summary.fastPathPolicy?.visibleMode || 'full'}; git ${dirty.status || 'unknown'}`)
  }

  return { formatGovernanceSummary, readCodexHookCommands }
}

module.exports = { createMaintenanceDiagnosticHelpers }
