#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const { runChecked } = require('./lib/checked-command')
const { listControlDeliveryEntries } = require('./lib/control-content-delivery')
const {
  buildPublishedPackageManifest,
  validatePublishedPackageManifest
} = require('./lib/published-package-scripts-contract')
const {
  resolvePublishedManifestProjectionPaths
} = require('./lib/published-package-manifest-projection')
const { resolveWorkspaceTempRoot } = require('./lib/workspace-temp-layout')

const ROOT = path.resolve(__dirname, '..')
const sourceManifestPath = path.join(ROOT, 'package.json')
const sourceManifestBytes = fs.readFileSync(sourceManifestPath)
const runRoot = path.join(
  resolveWorkspaceTempRoot(ROOT),
  'runs',
  'devcodex',
  `pack-clean-${process.pid}-${Date.now()}`
)
const packRoot = path.join(runRoot, 'pack')
const installRoot = path.join(runRoot, 'install')
const selfPackRoot = path.join(runRoot, 'self-pack')
const isolatedHome = path.join(runRoot, 'home')
const isolatedAppData = path.join(isolatedHome, 'AppData', 'Roaming')
const isolatedLocalAppData = path.join(isolatedHome, 'AppData', 'Local')
const npmCache = path.join(runRoot, 'npm-cache')
const npmUserConfig = path.join(runRoot, 'npmrc')
const NPM_COMMAND_TIMEOUT_MS = 180000
const PACKAGE_INSTALL_TIMEOUT_MS = 600000

for (const directory of [packRoot, installRoot, selfPackRoot, isolatedAppData, isolatedLocalAppData, npmCache]) {
  fs.mkdirSync(directory, { recursive: true })
}
fs.writeFileSync(npmUserConfig, '')
if (process.env.DEVCODEX_KEEP_TEST_ARTIFACTS !== '1') {
  process.on('exit', () => fs.rmSync(runRoot, { recursive: true, force: true }))
}

const npmEnv = {
  HOME: isolatedHome,
  USERPROFILE: isolatedHome,
  APPDATA: isolatedAppData,
  LOCALAPPDATA: isolatedLocalAppData,
  npm_config_cache: npmCache,
  npm_config_userconfig: npmUserConfig,
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false'
}

function runNpm (args, cwd = ROOT, timeoutMs = NPM_COMMAND_TIMEOUT_MS) {
  return runChecked('npm', args, {
    cwd,
    env: npmEnv,
    timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    summaryLimit: 16 * 1024 * 1024
  })
}

const packEvidence = runNpm(['pack', '--json', '--pack-destination', packRoot])
if (!fs.readFileSync(sourceManifestPath).equals(sourceManifestBytes)) {
  throw new Error('SOURCE_PACKAGE_MANIFEST_NOT_RESTORED_AFTER_PACK')
}
const projectionPaths = resolvePublishedManifestProjectionPaths(ROOT)
if (fs.existsSync(projectionPaths.receiptPath) || fs.existsSync(projectionPaths.backupPath)) {
  throw new Error('PUBLISHED_PACKAGE_MANIFEST_PROJECTION_STATE_LEAK')
}
const pack = JSON.parse(packEvidence.stdout)[0] || {}
const files = (pack.files || []).map(file => file.path)

function resolveLocalDependency(fromFile, request) {
  const resolved = path.normalize(path.join(path.dirname(fromFile), request)).replace(/\\/g, '/')
  if (path.extname(resolved)) return resolved
  if (fs.existsSync(path.join(ROOT, `${resolved}.js`))) return `${resolved}.js`
  if (fs.existsSync(path.join(ROOT, resolved, 'index.js'))) return `${resolved}/index.js`
  return `${resolved}.js`
}

function collectRuntimeDependencies(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)

  const fullPath = path.join(ROOT, file)
  if (!fs.existsSync(fullPath)) return [file]

  // Strip comments so doc examples like require('../scripts/lib/...') are not treated as deps.
  const content = fs.readFileSync(fullPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const deps = []

  for (const match of content.matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
    deps.push(resolveLocalDependency(file, match[1]))
  }

  for (const match of content.matchAll(/path\.join\(\s*ROOT\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)/g)) {
    const parts = Array.from(match[1].matchAll(/['"]([^'"]+)['"]/g)).map(item => item[1])
    if (parts[0] === 'scripts' && /\.js$/.test(parts[parts.length - 1] || '')) {
      deps.push(parts.join('/'))
    }
  }

  return Array.from(new Set(
    deps.flatMap(dep => [dep].concat(collectRuntimeDependencies(dep, seen)))
  ))
}

const forbidden = [
  /(^|\/)\.playwright-cli(?:\/|$)/,
  /data\/violations\.md/,
  /data\/pending-fixes\.md/,
  /data\/process-improvements\.md/,
  /data\/pending-issues\.md/,
  /data\/gap-registry\.md/,
  /skills\/portfolio-evidence\.json/,
  /content-source\//,
  /^content\//,
  /schema-dsl/i,
  /vext-test/i,
]

function forbiddenPlaywrightPackPaths (paths) {
  return paths
    .map(file => String(file || '').replace(/\\/g, '/').replace(/^package\//, '').replace(/^\.\//, ''))
    .filter(file => file === '.playwright-cli' || file.startsWith('.playwright-cli/'))
}

const syntheticForbiddenPaths = forbiddenPlaywrightPackPaths([
  'README.md',
  'package/.playwright-cli/forced.txt',
  'scripts/test-pack-clean.js'
])
if (syntheticForbiddenPaths.length !== 1 || syntheticForbiddenPaths[0] !== '.playwright-cli/forced.txt') {
  throw new Error('PLAYWRIGHT_PACK_PREFIX_NEGATIVE_PROBE_FAILED')
}
const actualForbiddenPaths = forbiddenPlaywrightPackPaths(files)
if (actualForbiddenPaths.length) {
  console.error('\x1b[31m✗ Pack contains forbidden .playwright-cli paths:\x1b[0m')
  actualForbiddenPaths.forEach(file => console.error('  ' + file))
  process.exit(1)
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const npmignore = fs.readFileSync(path.join(ROOT, '.npmignore'), 'utf8')
// Exact file entries only — skip directory suffixes and globs (e.g. skills/*/**)
const packageFiles = (pkg.files || []).filter(item => (
  !item.endsWith('/') && !/[*?![\]]/.test(item)
))
const pluginFiles = (plugin.skills || []).map(item => item.file).filter(Boolean)
const packagedScripts = packageFiles.filter(file => file.startsWith('scripts/') && file.endsWith('.js'))
const packagedScriptDeps = packagedScripts.flatMap(file => collectRuntimeDependencies(file))
const prefixedSkillRouteTargets = Object.entries(pkg.scripts || {})
  .filter(([name]) => name.startsWith('test:skill-route'))
  .flatMap(([, command]) => Array.from(
    String(command).matchAll(/(?:^|&&\s*)node\s+(scripts\/[^\s]+\.js)/g),
    match => match[1]
  ))

function collectNpmScriptNodeTargets(scriptName, seen = new Set()) {
  if (seen.has(scriptName)) return []
  seen.add(scriptName)
  const command = String((pkg.scripts || {})[scriptName] || '')
  const direct = Array.from(
    command.matchAll(/(?:^|&&\s*)node\s+(scripts\/[^\s]+\.js)/g),
    match => match[1]
  )
  const nested = Array.from(
    command.matchAll(/npm\s+run\s+([^\s&]+)/g),
    match => match[1]
  ).flatMap(name => collectNpmScriptNodeTargets(name, seen))
  return Array.from(new Set(direct.concat(nested)))
}

const skillRouteScriptTargets = Array.from(new Set(
  prefixedSkillRouteTargets.concat(collectNpmScriptNodeTargets('test:skill-route'))
))
const sourceOnlySkillPathTargets = skillRouteScriptTargets.filter(file => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
  return content.includes('content/skills') ||
    /path\.join\([^\r\n]*['"]content['"]\s*,\s*['"]skills['"]/.test(content)
})
const closureTrace = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'scripts', 'fixtures', 'skill-route-closure-trace.v1.json'),
  'utf8'
))
const closureOwnerFiles = Array.from(new Set(
  Object.values(closureTrace.testCases || {}).map(testCase => testCase.owner).filter(Boolean)
))
const promptFiles = listControlDeliveryEntries(ROOT, 'prompts')
  .filter(entry => entry.relative.endsWith('.prompt.md'))
  .map(entry => `prompts/${entry.relative}`)
const dataTemplateFiles = walk(path.join(ROOT, 'data', 'templates'))
  .filter(file => file.endsWith('.md'))
  .map(file => path.relative(ROOT, file).replace(/\\/g, '/'))
const indexRuntimeRequires = collectRuntimeDependencies('index.js')
const skillPackFiles = files.filter(file => file.startsWith('skills/') && file.endsWith('SKILL.md'))

const required = [
  'instructions.md',
  'plugin.json',
  '.mcp.json',
  'codex/hooks.json',
  'hooks/devcodex.lifecycle.json',
  'hooks/_runtime/lifecycle.cjs',
  'mcp/memory-server.js',
  'mcp/artifact-link-projection.cjs',
  'mcp/profile-server.js',
  'mcp/agent-identity.cjs',
  'host-projections/AGENTS.md',
  'host-projections/CLAUDE.md',
  'scripts/instruction-fallback-check.js',
  'scripts/migrate-layout.js',
  'assets/icon-512.png',
  'skills/portfolio.json',
  'skills/public-taxonomy.json',
].concat(
  packageFiles,
  pluginFiles,
  promptFiles,
  dataTemplateFiles,
  indexRuntimeRequires,
  packagedScriptDeps,
  skillRouteScriptTargets,
  closureOwnerFiles
)
  .filter(Boolean)
  .filter(file => !file.endsWith('/'))

const combined = files.join('\n') + '\n' + (pack.name || '') + '\n' + (pack.filename || '')
const hits = forbidden.filter(re => re.test(combined))
if (hits.length) {
  console.error('\x1b[31m✗ Pack contains forbidden content:\x1b[0m')
  hits.forEach(re => console.error('  ' + re))
  console.error('--- pack files ---')
  console.error(files.join('\n'))
  process.exit(1)
}

const missing = required.filter(file => !files.includes(file))
if (missing.length) {
  console.error('\x1b[31m✗ Pack missing required content:\x1b[0m')
  missing.forEach(file => console.error('  ' + file))
  process.exit(1)
}
if (skillPackFiles.length < 10) {
  console.error('\x1b[31m✗ Pack missing skills (expected skills/*/** to include SKILL.md packages):\x1b[0m')
  console.error(`  found ${skillPackFiles.length} skills/*/SKILL.md`)
  process.exit(1)
}
if (files.some(file => file === 'skills/portfolio-evidence.json')) {
  console.error('\x1b[31m✗ Pack must exclude skills/portfolio-evidence.json\x1b[0m')
  process.exit(1)
}
if (sourceOnlySkillPathTargets.length) {
  console.error('\x1b[31m✗ Packaged SkillRoute tests hard-code the source-only content/skills layout:\x1b[0m')
  sourceOnlySkillPathTargets.forEach(file => console.error('  ' + file))
  process.exit(1)
}
if (npmignore.includes('tests/')) {
  console.error('\x1b[31m✗ .npmignore contains stale "tests/" exclusion; tests live under scripts/test-*.js\x1b[0m')
  process.exit(1)
}

const projectedSourceManifest = buildPublishedPackageManifest(
  JSON.parse(sourceManifestBytes.toString('utf8'))
)
validatePublishedPackageManifest(ROOT, projectedSourceManifest)

const tarballPath = path.join(packRoot, pack.filename || '')
if (!pack.filename || !fs.existsSync(tarballPath)) {
  throw new Error(`PACK_TARBALL_MISSING: ${tarballPath}`)
}
runNpm([
  'install',
  '--no-audit',
  '--no-fund',
  '--prefix',
  installRoot,
  tarballPath
], runRoot, PACKAGE_INSTALL_TIMEOUT_MS)

const installedRoot = path.join(installRoot, 'node_modules', pack.name || 'devcodex')
const installedManifestPath = path.join(installedRoot, 'package.json')
if (!fs.existsSync(installedManifestPath)) {
  throw new Error(`INSTALLED_PACKAGE_MANIFEST_MISSING: ${installedManifestPath}`)
}
const installedManifest = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'))
const installedValidation = validatePublishedPackageManifest(installedRoot, installedManifest)
runChecked(process.execPath, [path.join(installedRoot, 'scripts', 'validate-installed-package.js')], {
  cwd: installedRoot,
  env: npmEnv,
  timeoutMs: 30000,
  summaryLimit: 1024 * 1024
})
runNpm(['run', 'validate', '--ignore-scripts'], installedRoot)

const selfPackEvidence = runNpm([
  'pack',
  '--json',
  '--pack-destination',
  selfPackRoot
], installedRoot)
const selfPack = JSON.parse(selfPackEvidence.stdout)[0] || {}
if (!selfPack.filename || !fs.existsSync(path.join(selfPackRoot, selfPack.filename))) {
  throw new Error('INSTALLED_PACKAGE_SELF_PACK_MISSING')
}
if (!fs.readFileSync(sourceManifestPath).equals(sourceManifestBytes)) {
  throw new Error('SOURCE_PACKAGE_MANIFEST_CHANGED_DURING_INSTALLED_PACKAGE_VALIDATION')
}

console.log(
  `\x1b[32m✓ Pack clean scripts=${installedValidation.scriptCount} closure=${installedValidation.closureFileCount} selfPack=${selfPack.filename}\x1b[0m`
)
