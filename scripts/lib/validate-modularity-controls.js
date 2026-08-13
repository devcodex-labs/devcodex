'use strict'

/** Single source for entry-module line budgets (V93 + control-plane module contracts). */
const ENTRY_MODULE_LINE_BUDGETS = Object.freeze([
  ['scripts/validate.js', 350],
  ['scripts/test-spec-governance.js', 150],
  ['index.js', 460],
  ['scripts/lib/validate-governance-tail.js', 100]
])

function buildModularityControlChecks(ctx) {
  const { ROOT, fs, path, read, err, console } = ctx
  const lineCount = file => read(path.join(ROOT, file)).split(/\r?\n/).length

  function checkV93() {
    for (const [file, maximum] of ENTRY_MODULE_LINE_BUDGETS) {
      const actual = lineCount(file)
      if (actual > maximum) err(`[V93] module budget exceeded: ${file} ${actual}/${maximum} lines`)
    }

    const ownerModules = [
      'scripts/lib/validate-core-checks.js',
      'scripts/lib/validate-governance-intake.js',
      'scripts/lib/validate-governance-quality.js',
      'scripts/lib/validate-governance-review.js',
      'scripts/lib/validate-governance-expert.js',
      'scripts/lib/test-spec-governance-base.js',
      'scripts/lib/test-spec-governance-review.js',
      'scripts/lib/test-spec-governance-expert.js',
      'scripts/lib/test-spec-governance-scale.js',
      'scripts/lib/validate-rework-trust-controls.js',
      'scripts/lib/test-rework-trust-controls.js',
      'scripts/lib/validate-consumer-evolution-controls.js',
      'scripts/test-consumer-evolution-controls.js',
      'scripts/lib/cli-install-commands.js',
      'scripts/lib/cli-maintenance-commands.js',
      'scripts/lib/cli-command-registry.js',
      'scripts/lib/global-host-removal.js'
    ]
    for (const file of ownerModules) {
      if (!fs.existsSync(path.join(ROOT, file))) err(`[V93] owner module missing: ${file}`)
      else if (lineCount(file) > 1200) err(`[V93] owner module exceeds 1200-line ceiling: ${file}`)
    }

    const runner = read(path.join(ROOT, 'scripts/validate.js'))
    for (const needle of ['createProbeRegistry', 'expectedProbeIds', 'runProbeRegistry', 'buildModularityControlChecks']) {
      if (!runner.includes(needle)) err(`[V93] validator registry contract missing: ${needle}`)
    }
    if (/\ncheckV\d+\(\)/.test(runner)) err('[V93] validate.js must not use a handwritten direct probe call chain')

    const packageJson = JSON.parse(read(path.join(ROOT, 'package.json')))
    for (const file of [
      'scripts/lib/cli-install-commands.js',
      'scripts/lib/cli-maintenance-commands.js',
      'scripts/lib/cli-command-registry.js'
    ]) {
      if (!packageJson.files.includes(file)) err(`[V93] package files missing CLI runtime dependency: ${file}`)
    }
    if (!packageJson.scripts['test:control-plane']) err('[V93] package script missing test:control-plane')
    console.log('[V93] validator, governance-test and CLI modularity controls checked')
  }

  return { checkV93 }
}

module.exports = { buildModularityControlChecks, ENTRY_MODULE_LINE_BUDGETS }
