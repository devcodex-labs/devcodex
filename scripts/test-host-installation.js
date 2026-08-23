'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildDeploymentDescriptors } = require('./lib/deployment-descriptors')
const { buildCliHostUtils } = require('./lib/cli-host-utils')
const { DEFAULT_HOSTS } = require('./lib/host-surface-descriptors')
const {
  mergeGrokPluginRegistration,
  removeGrokPluginRegistration,
  syncGrokWorkspacePluginInstallation
} = require('./lib/host-adapter-scope')
const {
  GROK_ROUTE_CONTEXT_EPOCH_RE,
  GROK_ROUTE_PROMPT_MAX_BYTES,
  GROK_MCP_TOOL_CONTRACT,
  GROK_MCP_TOOL_NAMES,
  buildGrokLaunchPlan,
  extractSinglePrompt,
  getGrokLauncherAdapterDigest,
  launchGrok,
  materializePromptCarrier
} = require('./lib/grok-workspace-launcher')
const {
  applyGlobalHostConfig,
  inspectGlobalHostConfig
} = require('./lib/global-host-config')
const {
  collectRuntimeScriptDeps
} = require('./lib/runtime-dependency-closure')

const ROOT = path.resolve(__dirname, '..')
const INDEX = path.join(ROOT, 'index.js')
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-host-installation-contract-v1-'))
function cleanupOwnedFixtureRoot(root) {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best-effort exit cleanup */ }
}
process.once('exit', () => cleanupOwnedFixtureRoot(FIXTURE_ROOT))
process.env.GROK_HOME = path.join(FIXTURE_ROOT, 'grok-home')

function run(args, cwd) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: '1',
      GROK_HOME: path.join(FIXTURE_ROOT, 'grok-home')
    }
  })
}

function filesUnder(root, options = {}, baseRoot = root) {
  if (!fs.existsSync(root)) return []
  const ignoredRoots = new Set((options.ignoredRoots || []).map(item => path.resolve(item)))
  const output = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (ignoredRoots.has(path.resolve(full))) continue
    if (entry.isDirectory()) output.push(...filesUnder(full, options, baseRoot))
    else {
      const relative = path.relative(baseRoot, full).replace(/\\/g, '/')
      const digest = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      output.push(`${relative}:${digest}`)
    }
  }
  return output.sort()
}

function deploymentOptions() {
  return {
    SOURCES: [
      { from: 'skills', to: 'skills' },
      { from: 'instructions', to: 'instructions' },
      { from: 'prompts', to: 'prompts' },
      { from: 'hooks', to: 'hooks' },
      { from: 'agents', to: 'agents' },
      { from: 'data/templates', to: 'data' }
    ],
    CLAUDE_SOURCES: [
      { from: 'hooks/_runtime', to: 'hooks/_runtime' },
      { from: 'mcp', to: 'mcp' },
      { from: 'skills', to: 'skills' },
      { from: 'instructions', to: 'instructions' },
      { from: 'prompts', to: 'prompts' },
      { from: 'data/templates', to: 'data' }
    ],
    CLAUDE_MCP_RUNTIME_SCRIPT_DEPS: collectRuntimeScriptDeps(ROOT),
    CODEX_SOURCES: [
      { from: 'hooks/_runtime', to: path.join('.codex', 'hooks', '_runtime') },
      { from: 'codex', to: '.codex' }
    ]
  }
}

if (process.env.DEVCODEX_RUN_LEGACY_WORKSPACE_HOST_INSTALLATION === '1') {
const multilinePluginConfig = [
  '[plugins]',
  'enabled = [',
  '  "project-owned" # keep-inline-comment',
  ']',
  'paths = [',
  '  # keep-list-comment',
  '  "C:/existing/plugin",',
  ']',
  '',
  '[ui]',
  'yolo = false # keep-setting-comment',
  ''
].join('\n')
const multilineMerge = mergeGrokPluginRegistration(
  multilinePluginConfig,
  path.join(FIXTURE_ROOT, 'workspace', '.grok', 'devcodex', 'plugins', 'devcodex-workspace'),
  { legacyPluginPaths: [path.join(FIXTURE_ROOT, 'workspace', '.grok', 'plugins', 'devcodex-workspace')] }
)
assert.match(multilineMerge.desired, /"project-owned", # keep-inline-comment/)
assert.match(multilineMerge.desired, /# keep-list-comment/)
assert.match(multilineMerge.desired, /yolo = false # keep-setting-comment/)
assert.match(multilineMerge.desired, /"devcodex-workspace"/)
assert.match(multilineMerge.desired, /"C:\/existing\/plugin"/)
assert.doesNotMatch(multilineMerge.desired, /workspace\/\.grok\/plugins\/devcodex-workspace/)
assert.strictEqual(
  mergeGrokPluginRegistration(
    multilineMerge.desired,
    path.join(FIXTURE_ROOT, 'workspace', '.grok', 'devcodex', 'plugins', 'devcodex-workspace'),
    { legacyPluginPaths: [path.join(FIXTURE_ROOT, 'workspace', '.grok', 'plugins', 'devcodex-workspace')] }
  ).changed,
  false,
  'multiline Grok plugin config merge must be idempotent'
)
const multilineRemoval = removeGrokPluginRegistration(
  multilineMerge.desired,
  path.join(FIXTURE_ROOT, 'workspace', '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
)
assert.doesNotMatch(multilineRemoval.desired, /devcodex-workspace/)
assert.match(multilineRemoval.desired, /"project-owned", # keep-inline-comment/)
assert.match(multilineRemoval.desired, /# keep-list-comment/)
assert.match(multilineRemoval.desired, /yolo = false # keep-setting-comment/)
assert.throws(
  () => mergeGrokPluginRegistration(
    '[plugins]\ndisabled = ["devcodex-workspace"]\n',
    path.join(FIXTURE_ROOT, 'workspace', '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
  ),
  /GROK_PLUGIN_DISABLED_BY_USER/,
  'an explicit user disable must fail closed without being overwritten'
)

const noCliWorkspace = path.join(FIXTURE_ROOT, 'no-cli-workspace')
const noCliActiveRoot = path.join(noCliWorkspace, '.devcodex', 'workspace')
const noCliGrokHome = path.join(FIXTURE_ROOT, 'no-cli-grok-home')
const noCliPlugin = path.join(noCliWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
const noCliLegacy = path.join(noCliWorkspace, '.grok', 'plugins', 'devcodex-workspace')
fs.mkdirSync(noCliPlugin, { recursive: true })
fs.mkdirSync(noCliLegacy, { recursive: true })
fs.mkdirSync(noCliGrokHome, { recursive: true })
fs.writeFileSync(path.join(noCliPlugin, 'plugin.json'), '{"name":"devcodex-workspace"}\n', 'utf8')
fs.mkdirSync(path.join(noCliPlugin, 'hooks'), { recursive: true })
fs.mkdirSync(path.join(noCliPlugin, 'skills', 'devcodex-workspace'), { recursive: true })
fs.writeFileSync(path.join(noCliPlugin, 'hooks', 'devcodex-workspace.cjs'), "'use strict'\n", 'utf8')
fs.writeFileSync(path.join(noCliPlugin, 'skills', 'devcodex-workspace', 'SKILL.md'), '---\nname: devcodex-workspace\n---\n# devcodex-workspace\n', 'utf8')
fs.writeFileSync(path.join(noCliLegacy, 'plugin.json'), '{"name":"devcodex-workspace-legacy"}\n', 'utf8')
fs.writeFileSync(path.join(noCliGrokHome, 'config.toml'), '[plugins]\nenabled = ["project-owned"]\n', 'utf8')
const noCliReceipt = syncGrokWorkspacePluginInstallation({
  pluginPath: noCliPlugin,
  legacyPluginPaths: [noCliLegacy],
  activeRoot: noCliActiveRoot,
  env: { ...process.env, GROK_HOME: noCliGrokHome, PATH: '' }
})
assert.strictEqual(noCliReceipt.status, 'unavailable')
assert.match(fs.readFileSync(path.join(noCliGrokHome, 'config.toml'), 'utf8'), /enabled = \["project-owned", "devcodex-workspace"\]/)
assert(fs.existsSync(noCliLegacy), 'no-CLI migration must retain the legacy source')
assert(fs.existsSync(path.join(noCliActiveRoot, 'managed', 'grok-plugin-migration.json')), 'no-CLI migration receipt must be recorded')

const hostUtils = buildCliHostUtils({
  fs,
  path,
  isPlainObject: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  claudeMcpJson: { mcpServers: {} }
})

assert.deepStrictEqual(
  hostUtils.detectHostPlatform({ DEVCODEX_AGENT: ' CoDeX ', GROK_AGENT: '1', GEMINI_AGENT: '1' }, FIXTURE_ROOT),
  { platform: 'codex', source: 'explicit-agent' },
  'explicit Codex identity must outrank stale Grok/Gemini host hints'
)
assert.deepStrictEqual(
  hostUtils.detectHostPlatform({ DEVCODEX_AGENT: 'claude_code', GROK_AGENT: '1' }, FIXTURE_ROOT),
  { platform: 'claude', source: 'explicit-agent' }
)
for (const agent of ['grok', 'gemini', 'copilot']) {
  assert.strictEqual(hostUtils.detectHostPlatform({ DEVCODEX_AGENT: agent, CODEX_HOME: '1' }, FIXTURE_ROOT).platform, agent)
}

// Two-cwd contract: the package root and a target root both support host-selective dry runs.
// c8 writes NODE_V8_COVERAGE payloads while child processes run. Those framework-owned
// files are outside the CLI mutation contract and must not make a dry run look stateful.
const sourceSnapshotOptions = {
  ignoredRoots: [
    path.join(ROOT, '.git'),
    path.join(ROOT, 'node_modules'),
    path.join(ROOT, 'coverage'),
    path.join(ROOT, 'website', 'node_modules'),
    path.join(ROOT, 'website', '.docusaurus'),
    path.join(ROOT, 'website', 'build')
  ]
}
const sourceSnapshot = filesUnder(ROOT, sourceSnapshotOptions)
const sourceDryRun = run(['update', '--host', 'grok', '--dry-run'], ROOT)
assert.strictEqual(sourceDryRun.status, 0, sourceDryRun.stderr || sourceDryRun.stdout)
assert.deepStrictEqual(filesUnder(ROOT, sourceSnapshotOptions), sourceSnapshot, 'source-cwd dry run must not write')

const dryRoot = path.join(FIXTURE_ROOT, 'dry-run')
fs.mkdirSync(dryRoot, { recursive: true })
const drySnapshot = filesUnder(dryRoot)
const allDryRun = run(['init', '--host', 'all', '--dry-run'], dryRoot)
assert.strictEqual(allDryRun.status, 0, allDryRun.stderr || allDryRun.stdout)
assert.deepStrictEqual(filesUnder(dryRoot), drySnapshot, 'target-cwd dry run must not write')
assert.strictEqual(hostUtils.inspectHostInstructionSurfaces(dryRoot).status, 'not-installed')

// A pre-existing host entry is fail-closed for init and becomes replaceable through update.
const collisionRoot = path.join(FIXTURE_ROOT, 'collision')
fs.mkdirSync(collisionRoot, { recursive: true })
const collisionFile = path.join(collisionRoot, 'AGENTS.md')
const collisionFixture = '# project-owned AGENTS\n'
fs.writeFileSync(collisionFile, collisionFixture, 'utf8')
const collision = run(['init', '--host', 'grok', '--dry-run'], collisionRoot)
assert.strictEqual(collision.status, 2)
assert.match(collision.stdout + collision.stderr, /HOST_INSTRUCTION_COLLISION/)
assert.strictEqual(fs.readFileSync(collisionFile, 'utf8'), collisionFixture)
const collisionInspection = hostUtils.inspectHostInstructionSurfaces(collisionRoot)
assert.strictEqual(collisionInspection.status, 'collision')
assert(collisionInspection.issues.some(issue => issue.code === 'HOST_FULL_FALLBACK_MISSING'))
const collisionUpdate = run(['update', '--host', 'grok', '--dry-run'], collisionRoot)
assert.strictEqual(collisionUpdate.status, 0, collisionUpdate.stderr || collisionUpdate.stdout)
assert.strictEqual(fs.readFileSync(collisionFile, 'utf8'), collisionFixture, 'dry-run update must not replace collision')

// A managed install materializes the shared kernel, full fallback, host runtime and manifest.
const managedRoot = path.join(FIXTURE_ROOT, 'managed-grok')
fs.mkdirSync(managedRoot, { recursive: true })
const managedInstall = run(['update', '--host', 'grok'], managedRoot)
assert.strictEqual(managedInstall.status, 0, managedInstall.stderr || managedInstall.stdout)
for (const relative of [
  'AGENTS.md',
  '.agents/devcodex/instructions.full.md',
  '.agents/skills/host-instruction-projection/SKILL.md',
  '.agents/skills/repair-prevention-assessment/SKILL.md',
  '.grok/hooks/devcodex.json',
  '.grok/hooks/_runtime/lifecycle-host-adapters.cjs',
  '.devcodex/managed/deployment-manifest.json'
]) {
  assert(fs.existsSync(path.join(managedRoot, relative)), `managed install missing ${relative}`)
}
assert(
  !fs.existsSync(path.join(managedRoot, '.agents', 'skills', 'rework-prevention-engineering')),
  'gray rework effectiveness Skill must not enter the default deployment'
)
const managedInspection = hostUtils.inspectHostInstructionSurfaces(managedRoot)
assert.strictEqual(managedInspection.status, 'ready', JSON.stringify(managedInspection.issues))
const managedManifest = JSON.parse(fs.readFileSync(
  path.join(managedRoot, '.devcodex', 'managed', 'deployment-manifest.json'),
  'utf8'
))
assert.strictEqual(
  new Set(managedManifest.entries.map(entry => path.resolve(managedRoot, entry.destination).toLowerCase())).size,
  managedManifest.entries.length,
  'managed manifest must have exactly one current owner per physical destination'
)
const managedSurfaces = new Set(managedManifest.entries.map(entry => entry.surface))
for (const surface of ['grok', 'shared-kernel', 'shared-agent-skills', 'full-fallback']) {
  assert(managedSurfaces.has(surface), `managed manifest missing ${surface}`)
}

// In a workspace namespace, invoking Grok installation from a child project writes only
// workspace-owned assets and a user registration. The child remains free of generated
// host artifacts and its legacy managed claims are retired.
const bridgeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-grok-workspace-bridge-'))
const bridgeProject = path.join(bridgeWorkspace, 'project-a')
fs.mkdirSync(path.join(bridgeWorkspace, '.devcodex'), { recursive: true })
fs.mkdirSync(bridgeProject, { recursive: true })
fs.mkdirSync(path.join(bridgeProject, '.git'), { recursive: true })
fs.writeFileSync(
  path.join(bridgeWorkspace, '.devcodex', 'layout.json'),
  JSON.stringify({ mode: 'workspace-namespace' }, null, 2) + '\n',
  'utf8'
)
fs.writeFileSync(path.join(bridgeProject, 'package.json'), '{"name":"project-a"}\n', 'utf8')
const grokHome = path.join(FIXTURE_ROOT, 'grok-home')
fs.mkdirSync(grokHome, { recursive: true })
fs.writeFileSync(
  path.join(grokHome, 'config.toml'),
  '[plugins]\nenabled = ["project-owned"]\n\n[ui]\nyolo = false # preserve-me\n',
  'utf8'
)
const legacyWorkspacePlugin = path.join(bridgeWorkspace, '.grok', 'plugins', 'devcodex-workspace')
fs.mkdirSync(path.dirname(legacyWorkspacePlugin), { recursive: true })
fs.cpSync(path.join(ROOT, 'grok', 'plugins', 'devcodex-workspace'), legacyWorkspacePlugin, { recursive: true })
const grokVersionProbe = spawnSync('grok', ['version'], {
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, GROK_HOME: grokHome }
})
const fixtureGrokCliAvailable = grokVersionProbe.status === 0
if (fixtureGrokCliAvailable) {
  const legacyOfficialInstall = spawnSync('grok', ['plugin', 'install', legacyWorkspacePlugin, '--trust'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GROK_HOME: grokHome }
  })
  assert.strictEqual(legacyOfficialInstall.status, 0, legacyOfficialInstall.stderr || legacyOfficialInstall.stdout)
  fs.writeFileSync(
    path.join(grokHome, 'config.toml'),
    '[plugins]\nenabled = ["project-owned"]\n\n[ui]\nyolo = false # preserve-me\n',
    'utf8'
  )
}
const legacyBridgeManifest = path.join(bridgeWorkspace, '.devcodex', 'project-a', 'managed', 'deployment-manifest.json')
fs.mkdirSync(path.dirname(legacyBridgeManifest), { recursive: true })
fs.writeFileSync(legacyBridgeManifest, JSON.stringify({
  schemaVersion: 1,
  package: 'devcodex',
  packageVersion: '1.15.1',
  targetRoot: bridgeProject,
  generatedAt: '2026-07-19T00:00:00.000Z',
  entries: [
    { source: 'instructions.md', destination: 'AGENTS.md', surface: 'codex', hash: 'legacy-a' },
    { source: 'host-projections/AGENTS.workspace-bridge.md', destination: 'AGENTS.md', surface: 'grok-workspace-bridge', hash: 'legacy-b' },
    { source: 'host-projections/AGENTS.md', destination: 'AGENTS.md', surface: 'shared-kernel', hash: 'legacy-c' }
  ],
  staleEntries: []
}, null, 2) + '\n', 'utf8')
const bridgeInstall = run(['update', '--host', 'grok'], bridgeProject)
assert.strictEqual(bridgeInstall.status, 0, bridgeInstall.stderr || bridgeInstall.stdout)
const grokCliAvailable = !/Grok CLI not found/.test(`${bridgeInstall.stdout || ''}${bridgeInstall.stderr || ''}`)
assert.strictEqual(grokCliAvailable, fixtureGrokCliAvailable)
for (const relative of [
  'AGENTS.md',
  '.agents/devcodex/instructions.full.md',
  '.agents/skills/host-instruction-projection/SKILL.md',
  '.grok/devcodex/plugins/devcodex-workspace/.claude-plugin/plugin.json',
  '.grok/devcodex/plugins/devcodex-workspace/hooks/devcodex-workspace.cjs',
  '.grok/devcodex/plugins/devcodex-workspace/skills/devcodex-workspace/SKILL.md',
  '.grok/devcodex/plugins/devcodex-workspace/.mcp.json'
]) {
  assert(fs.existsSync(path.join(bridgeWorkspace, relative)), `workspace plugin install missing ${relative}`)
}
const migrationReceiptPath = path.join(bridgeWorkspace, '.devcodex', 'workspace', 'managed', 'grok-plugin-migration.json')
if (grokCliAvailable) {
  assert(!fs.existsSync(legacyWorkspacePlugin), 'successful migration must remove the legacy path from Grok auto-discovery by reversible move')
  const migrationReceipt = JSON.parse(fs.readFileSync(migrationReceiptPath, 'utf8'))
  assert.strictEqual(migrationReceipt.status, 'migrated')
  assert(migrationReceipt.backupPaths.some(item => path.resolve(item.previousPath) === path.resolve(legacyWorkspacePlugin)))
  assert(migrationReceipt.backupPaths.every(item => fs.existsSync(item.backupPath)), 'legacy source backup must remain recoverable')
  const coldInspect = spawnSync('grok', ['inspect', '--json'], {
    cwd: bridgeWorkspace,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GROK_HOME: grokHome }
  })
  assert.strictEqual(coldInspect.status, 0, coldInspect.stderr || coldInspect.stdout)
  assert.doesNotMatch(`${coldInspect.stderr || ''}${coldInspect.stdout || ''}`, /plugin name collision/i)
  const coldInspectPayload = JSON.parse(coldInspect.stdout)
  const managedPlugins = coldInspectPayload.plugins.filter(item => item.name === 'devcodex-workspace')
  assert.strictEqual(managedPlugins.length, 1, 'cold workspace inspect must expose one canonical plugin identity')
  assert.strictEqual(managedPlugins[0].scope, 'user', 'canonical source must not be project auto-discovered')
} else {
  assert(fs.existsSync(legacyWorkspacePlugin), 'without Grok CLI the legacy auto-discovered source must be retained')
}
const workspaceChildForbidden = [
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json',
  '.github', '.grok', '.agents', '.codex', '.claude', '.gemini'
]
for (const relative of workspaceChildForbidden) {
  assert(!fs.existsSync(path.join(bridgeProject, relative)), `workspace child must not contain generated ${relative}`)
}
const bridgeConfig = fs.readFileSync(path.join(grokHome, 'config.toml'), 'utf8')
assert.match(bridgeConfig, /enabled = \["project-owned", "devcodex-workspace"\]/)
assert.doesNotMatch(bridgeConfig, /paths\s*=.*devcodex-workspace/)
assert.match(bridgeConfig, /yolo = false # preserve-me/)
const childDefaultUpdate = run(['update'], bridgeProject)
assert.strictEqual(childDefaultUpdate.status, 0, childDefaultUpdate.stderr || childDefaultUpdate.stdout)
for (const relative of workspaceChildForbidden) {
  assert(!fs.existsSync(path.join(bridgeProject, relative)), `default child update leaked generated ${relative}`)
}
for (const relative of ['.github/copilot-instructions.md', 'CLAUDE.md', '.claude/settings.json', 'AGENTS.md', '.codex/hooks.json']) {
  assert(fs.existsSync(path.join(bridgeWorkspace, relative)), `default child update missing workspace owner asset ${relative}`)
}
const childAllUpdate = run(['update', '--host', 'all'], bridgeProject)
assert.strictEqual(childAllUpdate.status, 0, childAllUpdate.stderr || childAllUpdate.stdout)
for (const relative of workspaceChildForbidden) {
  assert(!fs.existsSync(path.join(bridgeProject, relative)), `all-host child update leaked generated ${relative}`)
}
for (const relative of ['GEMINI.md', '.gemini/settings.json', '.grok/devcodex/plugins/devcodex-workspace/.claude-plugin/plugin.json']) {
  assert(fs.existsSync(path.join(bridgeWorkspace, relative)), `all-host child update missing workspace owner asset ${relative}`)
}
for (const relative of ['.grok/skills', '.grok/mcp', '.grok/workspace-config.toml']) {
  assert(!fs.existsSync(path.join(bridgeWorkspace, relative)), `workspace owner must not receive retired project bridge asset ${relative}`)
}
const allHostManifest = JSON.parse(fs.readFileSync(
  path.join(bridgeWorkspace, '.devcodex', 'workspace', 'managed', 'deployment-manifest.json'),
  'utf8'
))
assert(allHostManifest.entries.some(entry => entry.surface === 'grok-workspace-plugin'))
assert(!allHostManifest.entries.some(entry => entry.surface === 'grok'), 'workspace all-host update must retire legacy project-local Grok claims')
assert(!allHostManifest.entries.some(entry => entry.destination.startsWith('.grok/hooks/')), 'workspace all-host manifest must not retain legacy Grok hook destinations')
const childStatus = run(['status', '--json'], bridgeProject)
assert.strictEqual(childStatus.status, 0, childStatus.stderr || childStatus.stdout)
const childStatusFacts = JSON.parse(childStatus.stdout).payload
assert.strictEqual(path.resolve(childStatusFacts.hostRoot), path.resolve(bridgeWorkspace))
for (const field of ['copilotInstructionsInstalled', 'claudeMdInstalled', 'agentsMdInstalled', 'geminiMdInstalled']) {
  assert.strictEqual(childStatusFacts.entryFiles[field], true, `child status must inspect workspace owner field ${field}`)
}
const childStatusGrok = childStatusFacts.entryFiles.instructionProjection.grokPlugin
assert.strictEqual(childStatusGrok.sourcePresent, true)
assert.strictEqual(childStatusGrok.registrationCurrent, true)
assert.strictEqual(childStatusFacts.entryFiles.grokWorkspacePluginInstalled, childStatusGrok.installed)
assert.strictEqual(childStatusGrok.installed, childStatusGrok.installation.registered)
assert.strictEqual(childStatusFacts.entryFiles.grokWorkspacePluginInstalled, grokCliAvailable, 'status must not claim official plugin installation when Grok CLI is unavailable')
const childDoctor = run(['doctor', '--json'], bridgeProject)
assert.strictEqual(childDoctor.status, 0, childDoctor.stderr || childDoctor.stdout)
const childDoctorFacts = JSON.parse(childDoctor.stdout).payload
assert.strictEqual(path.resolve(childDoctorFacts.hostRoot), path.resolve(bridgeWorkspace))
for (const field of ['hasCopilotMd', 'hasClaudeMd', 'hasAgentsMd', 'hasGeminiMd', 'hasGrokPluginRegistration']) {
  assert.strictEqual(childDoctorFacts.installArtifacts[field], true, `child doctor must inspect workspace owner field ${field}`)
}
assert.strictEqual(childDoctorFacts.installArtifacts.hasGrokWorkspacePlugin, grokCliAvailable, 'doctor must preserve the no-CLI evidence ceiling')
for (const args of [['update', '--host', 'gemini'], ['update', '--claude']]) {
  const scopedUpdate = run(args, bridgeProject)
  assert.strictEqual(scopedUpdate.status, 0, scopedUpdate.stderr || scopedUpdate.stdout)
  for (const relative of workspaceChildForbidden) {
    assert(!fs.existsSync(path.join(bridgeProject, relative)), `${args.join(' ')} leaked generated ${relative}`)
  }
}
const bridgeInspection = hostUtils.inspectHostInstructionSurfaces(bridgeProject)
assert.strictEqual(path.resolve(bridgeInspection.inspectionRoot), path.resolve(bridgeWorkspace))
assert.strictEqual(bridgeInspection.grokPlugin.sourcePresent, true)
assert.strictEqual(bridgeInspection.grokPlugin.installed, grokCliAvailable)
assert.strictEqual(bridgeInspection.grokPlugin.registrationCurrent, true)
if (grokCliAvailable) {
  assert.strictEqual(bridgeInspection.status, 'ready', JSON.stringify(bridgeInspection.issues))
} else {
  assert.strictEqual(bridgeInspection.status, 'collision')
  assert(bridgeInspection.issues.some(item => item.code === 'HOST_GROK_PLUGIN_INSTALLATION_MISSING'))
}
const bridgeManifest = JSON.parse(fs.readFileSync(
  path.join(bridgeWorkspace, '.devcodex', 'workspace', 'managed', 'deployment-manifest.json'),
  'utf8'
))
const bridgeSurfaces = new Set(bridgeManifest.entries.map(entry => entry.surface))
for (const surface of ['grok-workspace-plugin', 'shared-kernel', 'shared-agent-skills', 'full-fallback']) {
  assert(bridgeSurfaces.has(surface), `workspace plugin manifest missing ${surface}`)
}
const retiredProjectManifest = JSON.parse(fs.readFileSync(legacyBridgeManifest, 'utf8'))
assert.strictEqual(retiredProjectManifest.entries.length, 0, 'workspace child must have zero current host manifest entries')
if (grokCliAvailable) {
  const fixtureRegistry = JSON.parse(fs.readFileSync(path.join(grokHome, 'installed-plugins', 'registry.json'), 'utf8'))
  const fixtureInstalledPlugin = Object.values(fixtureRegistry.repos).find(entry =>
    entry?.kind?.type === 'Local' && path.resolve(entry.kind.source_path) === path.resolve(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
  )
  assert(fixtureInstalledPlugin?.path, 'fixture Grok installed plugin registry entry missing')
  fs.appendFileSync(path.join(fixtureInstalledPlugin.path, 'hooks', 'devcodex-workspace.cjs'), '\n// stale-installed-copy-fixture\n', 'utf8')
  const stalePluginInspection = hostUtils.inspectHostInstructionSurfaces(bridgeProject)
  assert.strictEqual(stalePluginInspection.grokPlugin.installed, true)
  assert.strictEqual(stalePluginInspection.grokPlugin.installationCurrent, false)
  assert(stalePluginInspection.warnings.some(item => item.code === 'HOST_GROK_PLUGIN_INSTALLATION_STALE'))
  assert(!stalePluginInspection.issues.some(item => item.code === 'HOST_GROK_PLUGIN_INSTALLATION_STALE'))
}
const bridgeRepeat = run(['update', '--host', 'grok'], bridgeProject)
assert.strictEqual(bridgeRepeat.status, 0, bridgeRepeat.stderr || bridgeRepeat.stdout)
const configAfterRepeat = fs.readFileSync(path.join(grokHome, 'config.toml'), 'utf8')
assert.strictEqual(configAfterRepeat, bridgeConfig, 'repeat workspace install must preserve user config byte-for-byte')
const uninstallDryRun = run(['uninstall', '--host', 'grok', '--dry-run'], bridgeProject)
assert.strictEqual(uninstallDryRun.status, 0, uninstallDryRun.stderr || uninstallDryRun.stdout)
assert.strictEqual(fs.readFileSync(path.join(grokHome, 'config.toml'), 'utf8'), bridgeConfig)
const bridgeUninstall = run(['uninstall', '--host', 'grok'], bridgeProject)
assert.strictEqual(bridgeUninstall.status, 0, bridgeUninstall.stderr || bridgeUninstall.stdout)
const configAfterUninstall = fs.readFileSync(path.join(grokHome, 'config.toml'), 'utf8')
assert.match(configAfterUninstall, /enabled = \["project-owned"\]/)
assert.match(configAfterUninstall, /yolo = false # preserve-me/)
assert.doesNotMatch(configAfterUninstall, /devcodex-workspace/)
const registryAfterUninstallPath = path.join(grokHome, 'installed-plugins', 'registry.json')
if (fs.existsSync(registryAfterUninstallPath)) {
  const registryAfterUninstall = JSON.parse(fs.readFileSync(registryAfterUninstallPath, 'utf8'))
  assert(!Object.values(registryAfterUninstall.repos || {}).some(entry =>
    entry?.kind?.source_path && path.resolve(entry.kind.source_path) === path.resolve(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
  ))
}
assert(fs.existsSync(path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')), 'uninstall must retain workspace source')
const inspectionAfterUninstall = hostUtils.inspectHostInstructionSurfaces(bridgeProject)
assert.strictEqual(inspectionAfterUninstall.grokPlugin.sourcePresent, true)
assert.strictEqual(inspectionAfterUninstall.grokPlugin.installed, false)
assert(inspectionAfterUninstall.issues.some(item => item.code === 'HOST_GROK_PLUGIN_INSTALLATION_MISSING'))
assert(!hostUtils.detectInstalledHostAssets(bridgeProject).includes('grok'))
const bridgeUninstallRepeat = run(['uninstall', '--host', 'grok'], bridgeProject)
assert.strictEqual(bridgeUninstallRepeat.status, 0, bridgeUninstallRepeat.stderr || bridgeUninstallRepeat.stdout)
assert.strictEqual(fs.readFileSync(path.join(grokHome, 'config.toml'), 'utf8'), configAfterUninstall)
const bridgeReinstall = run(['update', '--host', 'grok'], bridgeProject)
assert.strictEqual(bridgeReinstall.status, 0, bridgeReinstall.stderr || bridgeReinstall.stdout)
assert.strictEqual(fs.readFileSync(path.join(grokHome, 'config.toml'), 'utf8'), bridgeConfig)
const inspectionAfterReinstall = hostUtils.inspectHostInstructionSurfaces(bridgeProject)
assert.strictEqual(inspectionAfterReinstall.grokPlugin.sourcePresent, true)
assert.strictEqual(inspectionAfterReinstall.grokPlugin.registrationCurrent, true)
assert.strictEqual(inspectionAfterReinstall.grokPlugin.installation.current, grokCliAvailable)
assert.strictEqual(inspectionAfterReinstall.status, grokCliAvailable ? 'ready' : 'collision', JSON.stringify(inspectionAfterReinstall.issues))
assert.strictEqual(hostUtils.detectInstalledHostAssets(bridgeProject).includes('grok'), grokCliAvailable)
const unsupportedUninstall = run(['uninstall', '--host', 'codex', '--dry-run'], bridgeProject)
assert.strictEqual(unsupportedUninstall.status, 2)
assert.match(unsupportedUninstall.stdout, /CLI_HOST_UNINSTALL_UNSUPPORTED/)
const portableUninstall = run(['uninstall', '--host', 'grok', '--project-portable', '--dry-run'], bridgeProject)
assert.strictEqual(portableUninstall.status, 2)
assert.match(portableUninstall.stdout, /CLI_HOST_UNINSTALL_SCOPE_UNSUPPORTED/)
const portableAll = run(['update', '--host', 'all', '--project-portable', '--dry-run'], bridgeProject)
assert.strictEqual(portableAll.status, 2)
assert.match(portableAll.stdout, /CLI_HOST_SCOPE_CONFLICT/)

const portableProject = path.join(bridgeWorkspace, 'portable-project')
fs.mkdirSync(path.join(portableProject, '.git'), { recursive: true })
fs.writeFileSync(path.join(portableProject, 'package.json'), '{"name":"portable-project"}\n', 'utf8')
const portableInstall = run(['update', '--host', 'grok', '--project-portable'], portableProject)
assert.strictEqual(portableInstall.status, 0, portableInstall.stderr || portableInstall.stdout)
for (const relative of ['AGENTS.md', '.agents/devcodex/instructions.full.md', '.grok/hooks/devcodex.json']) {
  assert(fs.existsSync(path.join(portableProject, relative)), `explicit portable Grok install missing ${relative}`)
}
assert(!fs.existsSync(path.join(portableProject, '.grok/devcodex/plugins/devcodex-workspace')), 'portable mode must not copy the workspace plugin')

const projectLaunchPlan = buildGrokLaunchPlan(['--rules', 'project-extra-rule', '-p', 'check'], { cwd: bridgeProject })
assert.strictEqual(projectLaunchPlan.kernelRequired, true)
assert.strictEqual(projectLaunchPlan.evidenceMode, 'launcher-rules')
assert.strictEqual(projectLaunchPlan.args[0], '--rules')
assert.match(projectLaunchPlan.args[1], /DevCodex controlling workspace kernel follows/)
assert.match(projectLaunchPlan.args[1], /project-extra-rule/)
assert.deepStrictEqual(projectLaunchPlan.args.slice(2), ['-p', 'check'])
const redirectedLaunchPlan = buildGrokLaunchPlan(['--cwd', bridgeProject, '-p', 'check'], { cwd: bridgeWorkspace })
assert.strictEqual(path.resolve(redirectedLaunchPlan.cwd), path.resolve(bridgeProject))
assert.strictEqual(redirectedLaunchPlan.kernelRequired, true, 'official --cwd must participate in scope/kernel resolution')
assert(!redirectedLaunchPlan.args.includes('--cwd'), 'resolved --cwd must not be forwarded a second time')
const rootLaunchPlan = buildGrokLaunchPlan([], { cwd: bridgeWorkspace })
assert.strictEqual(rootLaunchPlan.kernelRequired, false)
assert.strictEqual(rootLaunchPlan.evidenceMode, 'plain-native')
assert.throws(
  () => buildGrokLaunchPlan(['--system-prompt-override', 'unsafe'], { cwd: bridgeProject }),
  /GROK_LAUNCHER_SYSTEM_OVERRIDE_CONFLICT/
)
assert.throws(
  () => buildGrokLaunchPlan(['--system-prompt=unsafe'], { cwd: bridgeProject }),
  /GROK_LAUNCHER_SYSTEM_OVERRIDE_CONFLICT/
)
assert.throws(
  () => buildGrokLaunchPlan(['--cwd', bridgeProject, '--cwd=other'], { cwd: bridgeWorkspace }),
  /GROK_LAUNCHER_CWD_CONFLICT/
)

const deployedHook = require(path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace', 'hooks', 'devcodex-workspace.cjs'))
const activeHook = deployedHook.runWorkspaceBridge(
  { hookEventName: 'UserPromptSubmit', cwd: bridgeProject },
  { cwd: bridgeProject, pluginRoot: path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace') }
)
assert.strictEqual(activeHook.status, 0)
assert.strictEqual(activeHook.kernelInjected, false)
assert.strictEqual(activeHook.evidenceMode, 'passive-hook-no-context-injection')
assert.doesNotMatch(activeHook.output.systemMessage || '', /DevCodex controlling workspace kernel follows/)
if (process.platform === 'win32') {
  const caseVariantHook = deployedHook.runWorkspaceBridge(
    { hookEventName: 'UserPromptSubmit', cwd: bridgeProject.toLowerCase() },
    { cwd: bridgeProject.toLowerCase(), pluginRoot: path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace').toLowerCase() }
  )
  assert.strictEqual(caseVariantHook.reason, 'workspace-active', 'Windows path casing must not split one workspace identity')
}
const workspaceRootHook = deployedHook.runWorkspaceBridge(
  { hookEventName: 'UserPromptSubmit', cwd: bridgeWorkspace },
  { cwd: bridgeWorkspace, pluginRoot: path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace') }
)
assert.strictEqual(workspaceRootHook.status, 0)
assert.strictEqual(workspaceRootHook.kernelInjected, false)
assert.strictEqual(workspaceRootHook.evidenceMode, 'passive-hook-no-context-injection')
assert.doesNotMatch(workspaceRootHook.output.systemMessage || '', /DevCodex controlling workspace kernel follows/)
const outsideHook = deployedHook.runWorkspaceBridge(
  { hookEventName: 'UserPromptSubmit', cwd: FIXTURE_ROOT },
  { cwd: FIXTURE_ROOT, pluginRoot: path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace') }
)
assert.strictEqual(outsideHook.reason, 'outside-managed-workspace')
assert.deepStrictEqual(outsideHook.output, { continue: true })
const outsidePreToolHook = deployedHook.runWorkspaceBridge(
  { hookEventName: 'PreToolUse', cwd: FIXTURE_ROOT, toolInput: { command: 'echo ok' } },
  { cwd: FIXTURE_ROOT, pluginRoot: path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace') }
)
assert.strictEqual(outsidePreToolHook.reason, 'workspace-active')
assert.strictEqual(outsidePreToolHook.evidenceMode, 'blocking-tool-hook')
assert.deepStrictEqual(outsidePreToolHook.output, { decision: 'allow' })
const nestedWorkspace = path.join(bridgeProject, 'nested workspace')
fs.mkdirSync(path.join(nestedWorkspace, '.devcodex'), { recursive: true })
fs.mkdirSync(path.join(nestedWorkspace, '.git'), { recursive: true })
fs.writeFileSync(
  path.join(nestedWorkspace, '.devcodex', 'layout.json'),
  JSON.stringify({ mode: 'workspace-namespace' }, null, 2) + '\n',
  'utf8'
)
const nestedWorkspaceHook = deployedHook.runWorkspaceBridge(
  { hookEventName: 'UserPromptSubmit', cwd: nestedWorkspace },
  { cwd: nestedWorkspace, pluginRoot: path.join(bridgeWorkspace, '.grok', 'devcodex', 'plugins', 'devcodex-workspace') }
)
assert.strictEqual(nestedWorkspaceHook.reason, 'outside-managed-workspace', 'a plugin must not cross into a nearer workspace owner')
assert.deepStrictEqual(nestedWorkspaceHook.output, { continue: true })
assert.throws(
  () => buildGrokLaunchPlan([], { cwd: nestedWorkspace }),
  /GROK_LAUNCHER_KERNEL_MISSING/,
  'a nested workspace with spaces and no kernel must fail closed instead of borrowing its parent kernel'
)

// B4: the legacy project projection keeps five workspace surfaces; Cursor is global-only.
const defaults = buildDeploymentDescriptors(ROOT, DEFAULT_HOSTS, deploymentOptions())
const all = buildDeploymentDescriptors(ROOT, ['all'], deploymentOptions())
const workspaceDescriptors = buildDeploymentDescriptors(ROOT, ['grok'], {
  ...deploymentOptions(),
  grokWorkspaceScope: true
})
const workspaceAllDescriptors = buildDeploymentDescriptors(ROOT, ['all'], {
  ...deploymentOptions(),
  grokWorkspaceScope: true
})
const defaultSurfaces = new Set(defaults.map(item => item.surface))
const allSurfaces = new Set(all.map(item => item.surface))
const workspaceDescriptorSurfaces = new Set(workspaceDescriptors.map(item => item.surface))
const workspaceAllDescriptorSurfaces = new Set(workspaceAllDescriptors.map(item => item.surface))
for (const surface of ['copilot', 'claude', 'codex', 'gemini', 'grok', 'shared-kernel', 'full-fallback']) {
  assert(defaultSurfaces.has(surface), `default descriptor missing ${surface}`)
}
assert.strictEqual(defaultSurfaces.has('cursor'), false, 'Cursor must not receive project-local adapter artifacts')
for (const surface of ['gemini', 'grok']) assert(allSurfaces.has(surface), `all descriptor missing ${surface}`)
assert(workspaceDescriptorSurfaces.has('grok-workspace-plugin'))
assert(workspaceAllDescriptorSurfaces.has('grok-workspace-plugin'))
assert(!workspaceAllDescriptorSurfaces.has('grok'))
for (const surface of ['shared-kernel', 'shared-agent-skills', 'full-fallback']) {
  assert(workspaceDescriptorSurfaces.has(surface), `workspace descriptor must include ${surface}`)
}

// F-006: codex-only observes shared MCP; multi-host leaves MCP ownership on claude to avoid dual claim
const codexOnlyDescriptors = buildDeploymentDescriptors(ROOT, ['codex'], deploymentOptions())
assert.strictEqual(
  codexOnlyDescriptors.filter(item => item.surface === 'codex' && item.role === 'shared-mcp-runtime').length,
  1,
  'codex-only descriptors must include shared-mcp-runtime'
)
assert.strictEqual(
  defaults.filter(item => item.surface === 'codex' && item.role === 'shared-mcp-runtime').length,
  0,
  'multi-host defaults must not dual-own .claude/mcp (claude surface already owns it)'
)
assert.ok(
  defaults.some(item => item.surface === 'codex' && item.role === 'managed-segment-owner'),
  'codex descriptors must declare managed-segment ownership for config.toml'
)

// F-007: Codex-only with shared .claude/mcp must not report claude-code
{
  const fixture = fs.mkdtempSync(path.join(require('os').tmpdir(), 'devcodex-host-codex-only-'))
  fs.mkdirSync(path.join(fixture, '.codex'), { recursive: true })
  fs.mkdirSync(path.join(fixture, '.claude', 'mcp'), { recursive: true })
  fs.writeFileSync(path.join(fixture, '.claude', 'mcp', 'memory-server.js'), '//\n')
  const hosts = hostUtils.detectInstalledHostAssets(fixture)
  assert.deepStrictEqual(hosts, ['codex'], 'shared .claude/mcp alone must not imply Claude')
  fs.rmSync(fixture, { recursive: true, force: true })
}

const expectedRuntimeDeps = collectRuntimeScriptDeps(ROOT)

// Project runtime script deps must land under .claude/scripts/lib for Claude hooks + shared MCP.
const claudeMcpScriptDeps = defaults.filter(item =>
  item.surface === 'claude' &&
  String(item.destination || '').replace(/\\/g, '/').startsWith('.claude/scripts/lib/')
)
assert.strictEqual(claudeMcpScriptDeps.length, expectedRuntimeDeps.length, 'claude descriptors must include project scripts/lib runtime deps')
for (const rel of expectedRuntimeDeps) {
  const expected = `.claude/${rel}`
  assert(
    claudeMcpScriptDeps.some(item => String(item.destination || '').replace(/\\/g, '/') === expected),
    `missing claude runtime descriptor: ${expected}`
  )
}

const codexHookScriptDeps = defaults.filter(item =>
  item.surface === 'codex' &&
  String(item.destination || '').replace(/\\/g, '/').startsWith('.codex/scripts/lib/')
)
assert.strictEqual(codexHookScriptDeps.length, expectedRuntimeDeps.length, 'codex descriptors must include hook scripts/lib runtime deps')
for (const rel of expectedRuntimeDeps) {
  const expected = `.codex/${rel}`
  assert(
    codexHookScriptDeps.some(item => String(item.destination || '').replace(/\\/g, '/') === expected),
    `missing codex hook runtime descriptor: ${expected}`
  )
}

console.log(`host installation tests passed selectors=6 dryRunWrites=0 collision=blocked managedManifest=verified workspacePlugin=verified grokCli=${grokCliAvailable ? 'available' : 'unavailable-honest'} uninstall=verified zeroProjectArtifacts=verified defaultHosts=6 runtimeScriptDeps=${expectedRuntimeDeps.length}`)
} else {
  // Always-on descriptor contract (legacy branch is opt-in via env).
  {
    const expectedRuntimeDeps = collectRuntimeScriptDeps(ROOT)
    const defaults = buildDeploymentDescriptors(ROOT, DEFAULT_HOSTS, deploymentOptions())
    const claudeRuntimeDeps = defaults.filter(item =>
      item.surface === 'claude' &&
      String(item.destination || '').replace(/\\/g, '/').startsWith('.claude/scripts/lib/')
    )
    assert.strictEqual(
      claudeRuntimeDeps.length,
      expectedRuntimeDeps.length,
      'claude descriptors must include project scripts/lib runtime deps'
    )
    for (const rel of expectedRuntimeDeps) {
      const expected = `.claude/${rel}`
      assert(
        claudeRuntimeDeps.some(item => String(item.destination || '').replace(/\\/g, '/') === expected),
        `missing claude runtime descriptor: ${expected}`
      )
    }
    const codexHookRuntimeDeps = defaults.filter(item =>
      item.surface === 'codex' &&
      String(item.destination || '').replace(/\\/g, '/').startsWith('.codex/scripts/lib/')
    )
    assert.strictEqual(
      codexHookRuntimeDeps.length,
      expectedRuntimeDeps.length,
      'codex descriptors must include hook scripts/lib runtime deps'
    )
    for (const rel of expectedRuntimeDeps) {
      const expected = `.codex/${rel}`
      assert(
        codexHookRuntimeDeps.some(item => String(item.destination || '').replace(/\\/g, '/') === expected),
        `missing codex hook runtime descriptor: ${expected}`
      )
    }
  }

  const currentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-global-only-host-installation-'))
  process.once('exit', () => cleanupOwnedFixtureRoot(currentRoot))
  const home = path.join(currentRoot, 'home')
  const workspace = path.join(currentRoot, 'workspace')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(path.join(workspace, '.devcodex'), { recursive: true })
  fs.writeFileSync(
    path.join(workspace, '.devcodex', 'layout.json'),
    `${JSON.stringify({ mode: 'workspace-namespace' }, null, 2)}\n`,
    'utf8'
  )
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"global-only-fixture"}\n')
  const env = {
    ...process.env,
    DEVCODEX_TEST_HOME: home,
    USERPROFILE: home,
    HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GEMINI_CLI_HOME: path.join(home, 'gemini-cli-home'),
    GROK_HOME: path.join(home, '.grok'),
    CURSOR_HOME: path.join(home, '.cursor'),
    COPILOT_HOME: path.join(home, '.copilot')
  }
  const install = applyGlobalHostConfig({ packageRoot: ROOT, env, home })
  assert.strictEqual(install.transaction.status, 'committed')
  assert.strictEqual(install.workspaceHostDirectoriesWritten, false)
  const inspection = inspectGlobalHostConfig({ packageRoot: ROOT, env, home })
  assert.strictEqual(inspection.ready, false)
  assert.strictEqual(inspection.overallState, 'degraded')
  const grokInspection = inspection.hosts.find(host => host.host === 'grok')
  assert.strictEqual(grokInspection.adapterReady, true)
  assert.strictEqual(grokInspection.contractStatus, 'passed')
  assert.strictEqual(grokInspection.nativeStatus, 'unverified')
  assert(grokInspection.issues.some(issue => issue.code === 'GROK_PLUGIN_REGISTRY_UNVERIFIED'))
  assert.strictEqual(inspection.hosts.length, 6)
  assert.ok(fs.existsSync(path.join(home, 'gemini-cli-home', '.gemini', 'devcodex', 'global-host-receipt.json')))
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'devcodex', 'global-host-receipt.json')))
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'hooks.json')))
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'devcodex', 'plugins', 'devcodex-workspace', '.cursor-plugin', 'plugin.json')))
  assert.ok(fs.existsSync(path.join(home, '.agents', 'devcodex', 'instructions.full.md')))
  const codexReceipt = JSON.parse(fs.readFileSync(
    path.join(home, '.codex', 'devcodex', 'global-host-receipt.json'),
    'utf8'
  ))
  assert.strictEqual(codexReceipt.skillsDeployMode, 'hidden')
  assert.strictEqual(
    path.resolve(codexReceipt.skillsRuntimeRoot),
    path.resolve(home, '.agents', 'devcodex', 'skills')
  )
  assert.ok(fs.existsSync(path.join(codexReceipt.skillsRuntimeRoot, 'routing', 'SKILL.md')))
  assert.strictEqual(
    fs.existsSync(path.join(home, '.agents', 'skills', 'routing', 'SKILL.md')),
    false,
    'hidden install must not project DevCodex skills into the host-native scan root'
  )

  const globalPluginRoot = path.join(home, '.grok', 'devcodex', 'plugins', 'devcodex-workspace')
  const globalPluginHook = require(path.join(globalPluginRoot, 'hooks', 'devcodex-workspace.cjs'))
  const grokReceiptFile = path.join(home, '.grok', 'devcodex', 'global-host-receipt.json')
  const grokReceiptText = fs.readFileSync(grokReceiptFile, 'utf8')
  const grokReceipt = JSON.parse(grokReceiptText)
  assert.strictEqual(
    path.resolve(globalPluginHook.globalAdapterPath(env)),
    path.resolve(grokReceipt.runtimeRoot, 'hooks', '_runtime', 'lifecycle-host-adapters.cjs')
  )
  const installedRuntimeResolver = require(path.join(globalPluginRoot, 'lib', 'runtime-root.cjs'))
  const grokRuntimeManifestFile = path.join(grokReceipt.runtimeRoot, 'runtime-generation.json')
  const grokRuntimeManifestText = fs.readFileSync(grokRuntimeManifestFile, 'utf8')
  const grokRuntimeManifest = JSON.parse(grokRuntimeManifestText)
  fs.writeFileSync(grokRuntimeManifestFile, `${JSON.stringify({
    ...grokRuntimeManifest,
    sourceDigest: '0'.repeat(64)
  }, null, 2)}\n`, 'utf8')
  assert.strictEqual(
    path.resolve(installedRuntimeResolver.resolveGrokRuntimeRoot(env)),
    path.resolve(home, '.grok', 'devcodex', 'runtime'),
    'Grok plugin must reject a generation manifest whose source identity differs from the receipt'
  )
  fs.writeFileSync(grokRuntimeManifestFile, grokRuntimeManifestText, 'utf8')
  const physicalEscapeFs = {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    realpathSync(value) {
      return path.resolve(value) === path.resolve(grokReceipt.runtimeRoot)
        ? path.join(home, 'outside-managed-runtime')
        : fs.realpathSync(value)
    }
  }
  assert.strictEqual(
    path.resolve(installedRuntimeResolver.resolveGrokRuntimeRoot(env, { fs: physicalEscapeFs })),
    path.resolve(home, '.grok', 'devcodex', 'runtime'),
    'Grok plugin must reject a managed-path junction whose physical target escapes the managed root'
  )
  fs.writeFileSync(grokReceiptFile, `${JSON.stringify({
    ...grokReceipt,
    runtimeRoot: path.join(home, 'outside-managed-runtime')
  }, null, 2)}\n`, 'utf8')
  assert.strictEqual(
    path.resolve(installedRuntimeResolver.resolveGrokRuntimeRoot(env)),
    path.resolve(home, '.grok', 'devcodex', 'runtime'),
    'Grok plugin must not follow a receipt runtime outside its managed root'
  )
  fs.writeFileSync(grokReceiptFile, grokReceiptText, 'utf8')
  const activeHook = globalPluginHook.runWorkspaceBridge(
    { hookEventName: 'UserPromptSubmit', cwd: workspace },
    {
      cwd: workspace,
      env,
      pluginRoot: globalPluginRoot,
      spawnSync: () => ({ status: 0, stdout: '{"continue":true}', stderr: '' })
    }
  )
  assert.strictEqual(activeHook.status, 0)
  assert.strictEqual(activeHook.workspaceRoot, workspace)
  assert.strictEqual(activeHook.reason, 'global-adapter-active')
  assert.strictEqual(activeHook.evidenceMode, 'passive-hook-no-context-injection')
  const missingAdapterHook = globalPluginHook.runWorkspaceBridge(
    { hookEventName: 'PreToolUse', cwd: workspace, toolInput: { command: 'echo ok' } },
    { cwd: workspace, env, pluginRoot: globalPluginRoot, adapterPath: path.join(home, 'missing-adapter.cjs') }
  )
  assert.strictEqual(missingAdapterHook.status, 0)
  assert.strictEqual(missingAdapterHook.reason, 'global-adapter-missing-degraded')
  assert.deepStrictEqual(missingAdapterHook.output, { decision: 'allow' })
  const dangerousWithoutAdapter = globalPluginHook.runWorkspaceBridge(
    { hookEventName: 'PreToolUse', cwd: workspace, toolInput: { command: 'git reset --hard' } },
    { cwd: workspace, env, pluginRoot: globalPluginRoot, adapterPath: path.join(home, 'missing-adapter.cjs') }
  )
  assert.strictEqual(dangerousWithoutAdapter.status, 0)
  assert.strictEqual(dangerousWithoutAdapter.output.decision, 'deny')
  const invalidAdapterOutput = globalPluginHook.runWorkspaceBridge(
    { hookEventName: 'PreToolUse', cwd: workspace, toolInput: { command: 'echo ok' } },
    {
      cwd: workspace,
      env,
      pluginRoot: globalPluginRoot,
      spawnSync: () => ({ status: 0, stdout: 'not-json', stderr: '' })
    }
  )
  assert.strictEqual(invalidAdapterOutput.reason, 'global-adapter-invalid-output-degraded')
  assert.deepStrictEqual(invalidAdapterOutput.output, { decision: 'allow' })
  const dangerousWithInvalidAdapterOutput = globalPluginHook.runWorkspaceBridge(
    { hookEventName: 'PreToolUse', cwd: workspace, toolInput: { command: 'git reset --hard' } },
    {
      cwd: workspace,
      env,
      pluginRoot: globalPluginRoot,
      spawnSync: () => ({ status: 0, stdout: 'not-json', stderr: '' })
    }
  )
  assert.strictEqual(
    dangerousWithInvalidAdapterOutput.reason,
    'global-adapter-invalid-output-local-danger-deny'
  )
  assert.strictEqual(dangerousWithInvalidAdapterOutput.output.decision, 'deny')
  const outsideHook = globalPluginHook.runWorkspaceBridge(
    { hookEventName: 'UserPromptSubmit', cwd: home },
    { cwd: home, env, pluginRoot: globalPluginRoot }
  )
  assert.strictEqual(outsideHook.reason, 'outside-workspace')

  const mcpBridge = path.join(globalPluginRoot, 'mcp', 'workspace-bridge.cjs')
  const mcpBridgeProbe = spawnSync(process.execPath, [mcpBridge, 'memory', workspace], {
    cwd: workspace,
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
    encoding: 'utf8',
    env
  })
  assert.strictEqual(mcpBridgeProbe.status, 0, mcpBridgeProbe.stderr || mcpBridgeProbe.stdout)
  assert.strictEqual(JSON.parse(mcpBridgeProbe.stdout.trim().split(/\r?\n/)[0]).id, 1)
  const mcpOutsideProbe = spawnSync(process.execPath, [mcpBridge, 'memory', home], {
    cwd: home,
    encoding: 'utf8',
    env
  })
  assert.strictEqual(mcpOutsideProbe.status, 2)
  assert.match(mcpOutsideProbe.stderr, /no workspace-namespace/)

  const statusAfterGlobalInstall = spawnSync(process.execPath, [INDEX, 'status', '--json'], {
    cwd: workspace,
    encoding: 'utf8',
    env
  })
  assert.strictEqual(statusAfterGlobalInstall.status, 0, statusAfterGlobalInstall.stderr || statusAfterGlobalInstall.stdout)
  const statusAfterGlobalInstallFacts = JSON.parse(statusAfterGlobalInstall.stdout).payload
  assert.strictEqual(statusAfterGlobalInstallFacts.globalHostConfig.ready, false)
  assert.strictEqual(statusAfterGlobalInstallFacts.globalHostConfig.overallState, 'degraded')
  assert.strictEqual(statusAfterGlobalInstallFacts.entryFiles.instructionProjection.grokPlugin.globalAdapterReady, true)
  assert.strictEqual(statusAfterGlobalInstallFacts.entryFiles.instructionProjection.grokPlugin.workspaceSourceRequired, false)
  assert(!statusAfterGlobalInstallFacts.entryFiles.instructionProjection.issues.some(item =>
    item.code === 'HOST_GROK_WORKSPACE_PLUGIN_MISSING'
  ))
  const doctorAfterGlobalInstall = spawnSync(process.execPath, [INDEX, 'doctor', '--json'], {
    cwd: workspace,
    encoding: 'utf8',
    env
  })
  assert.strictEqual(doctorAfterGlobalInstall.status, 0, doctorAfterGlobalInstall.stderr || doctorAfterGlobalInstall.stdout)
  const doctorAfterGlobalInstallFacts = JSON.parse(doctorAfterGlobalInstall.stdout).payload
  assert.strictEqual(doctorAfterGlobalInstallFacts.globalHostConfig.ready, false)
  assert.strictEqual(doctorAfterGlobalInstallFacts.installArtifacts.instructionProjection.grokPlugin.globalAdapterReady, true)
  assert.strictEqual(doctorAfterGlobalInstallFacts.installArtifacts.instructionProjection.grokPlugin.workspaceSourceRequired, false)
  assert(!doctorAfterGlobalInstallFacts.installArtifacts.instructionProjection.issues.some(item =>
    item.code === 'HOST_GROK_WORKSPACE_PLUGIN_MISSING'
  ))

  const runtimeInit = spawnSync(process.execPath, [INDEX, 'init', '--json'], {
    cwd: workspace,
    encoding: 'utf8',
    env
  })
  assert.strictEqual(runtimeInit.status, 0, runtimeInit.stderr || runtimeInit.stdout)
  const runtimeEnvelope = JSON.parse(runtimeInit.stdout)
  assert.strictEqual(runtimeEnvelope.payload.workspaceHostDirectoriesWritten, false)
  for (const relative of ['.github', '.claude', '.codex', '.gemini', '.grok', '.cursor', '.agents', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.mcp.json']) {
    assert.strictEqual(fs.existsSync(path.join(workspace, relative)), false, `${relative} must remain absent`)
  }

  for (const host of ['copilot', 'claude', 'codex', 'gemini', 'grok', 'cursor']) {
    const denied = spawnSync(process.execPath, [INDEX, 'update', '--host', host, '--json'], {
      cwd: workspace,
      encoding: 'utf8',
      env
    })
    assert.strictEqual(denied.status, 2)
    assert.strictEqual(JSON.parse(denied.stdout).errorCode, 'CLI_HOST_CONFIG_GLOBAL_ONLY')
  }

  const launchPlan = buildGrokLaunchPlan(['--rules', 'fixture-extra', '-p', 'check'], {
    cwd: workspace,
    env,
    home
  })
  assert.strictEqual(launchPlan.schemaVersion, 'GrokGlobalLaunchPlanV1')
  assert.strictEqual(launchPlan.hostScope.scope, 'user-global')
  assert.strictEqual(launchPlan.kernelRequired, true)
  assert.strictEqual(launchPlan.evidenceMode, 'global-launcher-rules')
  assert.ok(launchPlan.kernelPath.startsWith(path.join(home, '.grok')))
  assert.match(launchPlan.args[1], /DevCodex user-global controlling kernel follows/)
  assert.match(launchPlan.args[1], /fixture-extra/)
  assert.match(launchPlan.args[1], /DevCodex Grok MCP tool namespace contract/)
  for (const toolName of Object.values(GROK_MCP_TOOL_NAMES)) {
    assert.match(launchPlan.args[1], new RegExp(toolName))
  }
  assert.match(GROK_MCP_TOOL_CONTRACT, /omit cursor entirely/)
  assert.match(GROK_MCP_TOOL_CONTRACT, /no replan operation/)
  const nestedProjectRoot = path.join(workspace, 'apps', 'api')
  fs.mkdirSync(nestedProjectRoot, { recursive: true })
  fs.writeFileSync(path.join(nestedProjectRoot, 'package.json'), '{"name":"nested-api"}\n')
  const nestedLaunchPlan = buildGrokLaunchPlan(['-p', 'nested check'], {
    cwd: nestedProjectRoot,
    env,
    home
  })
  assert.strictEqual(nestedLaunchPlan.hostScope.project, 'apps/api')
  const grokInstallTarget = install.targets.find(target => target.host === 'grok')
  assert(grokInstallTarget)
  const publishedRuntimeRoot = path.join(
    grokInstallTarget.runtimeBaseRoot,
    'runtime-published-line-endings'
  )
  fs.mkdirSync(publishedRuntimeRoot, { recursive: true })
  fs.writeFileSync(
    path.join(publishedRuntimeRoot, 'AGENTS.md'),
    'published receipt kernel\n',
    'utf8'
  )
  const receiptBoundPlan = buildGrokLaunchPlan(['-p', 'check'], {
    cwd: workspace,
    env,
    home,
    globalTarget: {
      ...grokInstallTarget,
      runtimeRoot: publishedRuntimeRoot
    }
  })
  assert.strictEqual(
    receiptBoundPlan.kernelPath,
    path.join(publishedRuntimeRoot, 'AGENTS.md')
  )
  assert.match(receiptBoundPlan.args[1], /published receipt kernel/)
  assert.throws(
    () => buildGrokLaunchPlan(['-p', 'check'], {
      cwd: workspace,
      env,
      home,
      globalTarget: {
        ...grokInstallTarget,
        runtimeRoot: path.join(currentRoot, 'escaped-runtime')
      }
    }),
    /GROK_GLOBAL_TARGET_INVALID: runtime root escapes/
  )
  let launchedOptions = null
  let launchedArgs = null
  const bootstrapRequests = []
  const bootstrapSkillRouteForTurnFixture = request => {
    bootstrapRequests.push(request)
    return {
      schemaVersion: 'SkillRouteBootstrapOutcomeV1',
      active: true,
      injectionText: `fixture-project-bound-route:${request.project}`,
      modeReceipt: {
        schemaVersion: 'HostModeReceiptV1',
        host: 'grok-cli-single'
      },
      bootstrap: {
        schemaVersion: 'SkillRouteBootstrapV1',
        project: request.project,
        contextEpoch: request.contextEpoch,
        turnBinding: `fixture-turn-${request.contextEpoch}`
      }
    }
  }
  const launchEnv = {
    ...env,
    GROK_HOME: '',
    GROK_CURSOR_HOOKS_ENABLED: 'true',
    DEVCODEX_CONTEXT_EPOCH: '../../invalid-epoch'
  }
  const launched = launchGrok(['-p', 'check'], {
    cwd: nestedProjectRoot,
    env: launchEnv,
    home,
    bootstrapSkillRouteForTurn: bootstrapSkillRouteForTurnFixture,
    spawnSync: (_command, args, options) => {
      launchedArgs = args
      launchedOptions = options
      return { status: 0, signal: null }
    }
  })
  assert.strictEqual(launched.status, 0)
  assert.strictEqual(bootstrapRequests.length, 1)
  assert.strictEqual(bootstrapRequests[0].project, 'apps/api')
  assert.strictEqual(path.resolve(bootstrapRequests[0].cwd), path.resolve(nestedProjectRoot))
  assert.match(launchedArgs[1], /fixture-project-bound-route:apps\/api/)
  assert.match(launchedArgs[1], /devcodex-profile__skill_route/)
  assert.match(launchedArgs[1], /Never send cursor:null/)
  assert.strictEqual(launchedOptions.env.GROK_HOME, path.join(home, '.grok'))
  assert.strictEqual(launchedOptions.env.GROK_CURSOR_HOOKS_ENABLED, 'false')
  assert.strictEqual(launchEnv.GROK_CURSOR_HOOKS_ENABLED, 'true')
  assert.match(launchedOptions.env.DEVCODEX_CONTEXT_EPOCH, GROK_ROUTE_CONTEXT_EPOCH_RE)
  assert.notStrictEqual(
    launchedOptions.env.DEVCODEX_CONTEXT_EPOCH,
    '../../invalid-epoch'
  )
  assert.match(getGrokLauncherAdapterDigest(), /^[a-f0-9]{64}$/)
  assert.strictEqual(launched.plan.promptCarrier.status, 'verified')
  assert.strictEqual(launched.plan.promptCarrier.digest, launched.plan.skillRoute.promptDigest)
  assert.strictEqual(launched.plan.promptCarrier.forwardedDigest, launched.plan.promptCarrier.digest)

  const promptFile = path.join(workspace, 'route-prompt.txt')
  fs.writeFileSync(promptFile, 'prompt from immutable snapshot\n', 'utf8')
  let forwardedPromptSnapshot = null
  const filePromptLaunch = launchGrok(['--prompt-file', promptFile], {
    cwd: nestedProjectRoot,
    env,
    home,
    bootstrapSkillRouteForTurn: bootstrapSkillRouteForTurnFixture,
    spawnSync: (_command, args) => {
      const promptIndex = args.indexOf('--prompt-file')
      forwardedPromptSnapshot = args[promptIndex + 1]
      assert.notStrictEqual(path.resolve(forwardedPromptSnapshot), path.resolve(promptFile))
      assert.strictEqual(fs.readFileSync(forwardedPromptSnapshot, 'utf8'), 'prompt from immutable snapshot\n')
      return { status: 0, signal: null }
    }
  })
  assert.strictEqual(filePromptLaunch.plan.promptCarrier.forwarding, 'snapshot-file')
  assert.strictEqual(filePromptLaunch.plan.promptCarrier.snapshotRemoved, true)
  assert.strictEqual(fs.existsSync(forwardedPromptSnapshot), false)
  assert.strictEqual(bootstrapRequests.length, 2)
  assert.strictEqual(bootstrapRequests[1].prompt, 'prompt from immutable snapshot\n')

  const failureCarrier = {
    kind: 'prompt-file',
    index: 0,
    buffer: Buffer.from('prompt snapshot failure probe\n', 'utf8'),
    digest: crypto.createHash('sha256').update('prompt snapshot failure probe\n').digest('hex')
  }
  const failureOwnerRoot = path.join(FIXTURE_ROOT, 'grok-prompt-failure-owner')
  const makeFailurePlan = () => ({
    hostScope: { ownerRoot: failureOwnerRoot },
    args: ['--rules', 'fixture rules', '--prompt-file', promptFile],
    promptCarrier: { status: 'pending' }
  })
  const snapshotFailureFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'writeFileSync') {
        return (file, ...args) => {
          if (path.basename(String(file)) === 'prompt.txt') {
            const error = new Error('injected prompt snapshot write failure')
            error.code = 'EIO'
            throw error
          }
          return target.writeFileSync(file, ...args)
        }
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  assert.throws(
    () => materializePromptCarrier(makeFailurePlan(), failureCarrier, { fs: snapshotFailureFs }),
    error => error?.code === 'EIO'
  )
  const failurePrivateRoot = path.join(failureOwnerRoot, 'devcodex', 'private', 'prompt-snapshots')
  assert.deepStrictEqual(fs.readdirSync(path.join(failurePrivateRoot, 'owners')), [])
  assert.deepStrictEqual(fs.readdirSync(path.join(failurePrivateRoot, 'index')), [])

  const renameFailureFs = new Proxy(fs, {
    get(target, property) {
      if (property === 'renameSync') {
        return (source, destination) => {
          if (String(source).endsWith('.json.next.tmp')) {
            const error = new Error('injected prompt owner index rename failure')
            error.code = 'EPERM'
            throw error
          }
          return target.renameSync(source, destination)
        }
      }
      const value = target[property]
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  assert.throws(
    () => materializePromptCarrier(makeFailurePlan(), failureCarrier, { fs: renameFailureFs }),
    error => error?.code === 'EPERM'
  )
  assert.deepStrictEqual(fs.readdirSync(path.join(failurePrivateRoot, 'owners')), [])
  assert.deepStrictEqual(fs.readdirSync(path.join(failurePrivateRoot, 'index')), [])
  assert.throws(
    () => extractSinglePrompt(['-p', 'first', '--single', 'second'], workspace),
    /GROK_PROMPT_CARRIER_AMBIGUOUS/
  )
  assert.throws(
    () => extractSinglePrompt(['-p', ''], workspace),
    /GROK_PROMPT_EMPTY/
  )
  assert.throws(
    () => extractSinglePrompt(['--single='], workspace),
    /GROK_PROMPT_EMPTY/
  )
  const emptyPromptFile = path.join(workspace, 'empty-route-prompt.txt')
  fs.writeFileSync(emptyPromptFile, '', 'utf8')
  assert.throws(
    () => extractSinglePrompt(['--prompt-file', emptyPromptFile], workspace),
    /GROK_PROMPT_EMPTY/
  )
  const digestFixtureRoot = path.join(workspace, 'launcher-digest-fixture')
  fs.mkdirSync(digestFixtureRoot, { recursive: true })
  const digestLauncher = path.join(digestFixtureRoot, 'grok-workspace-launcher.js')
  const digestTarget = path.join(digestFixtureRoot, 'global-host-target.js')
  const digestCliEnv = path.join(digestFixtureRoot, 'grok-cli-env.js')
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'grok-workspace-launcher.js'),
    digestLauncher
  )
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'global-host-target.js'),
    digestTarget
  )
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'grok-cli-env.js'),
    digestCliEnv
  )
  const adapterDigestBefore = getGrokLauncherAdapterDigest({
    launcherPath: digestLauncher,
    globalHostTargetPath: digestTarget,
    grokCliEnvPath: digestCliEnv
  })
  fs.appendFileSync(digestTarget, '\n// digest fixture change\n', 'utf8')
  assert.notStrictEqual(
    getGrokLauncherAdapterDigest({
      launcherPath: digestLauncher,
      globalHostTargetPath: digestTarget,
      grokCliEnvPath: digestCliEnv
    }),
    adapterDigestBefore
  )
  const targetChangedDigest = getGrokLauncherAdapterDigest({
    launcherPath: digestLauncher,
    globalHostTargetPath: digestTarget,
    grokCliEnvPath: digestCliEnv
  })
  fs.appendFileSync(digestCliEnv, '\n// digest fixture env isolation change\n', 'utf8')
  assert.notStrictEqual(
    getGrokLauncherAdapterDigest({
      launcherPath: digestLauncher,
      globalHostTargetPath: digestTarget,
      grokCliEnvPath: digestCliEnv
    }),
    targetChangedDigest
  )
  const oversizedPrompt = path.join(workspace, 'oversized-route-prompt.txt')
  fs.writeFileSync(
    oversizedPrompt,
    Buffer.alloc(GROK_ROUTE_PROMPT_MAX_BYTES + 1, 0x61)
  )
  assert.throws(
    () => extractSinglePrompt(['--prompt-file', oversizedPrompt], workspace),
    /GROK_PROMPT_FILE_TOO_LARGE/
  )
  const originalStatSync = fs.statSync
  try {
    fs.statSync = (filePath, ...statArgs) => {
      const stat = originalStatSync(filePath, ...statArgs)
      if (path.resolve(filePath) !== path.resolve(oversizedPrompt)) return stat
      return { ...stat, size: 1, isFile: () => true }
    }
    assert.throws(
      () => extractSinglePrompt(['--prompt-file', oversizedPrompt], workspace),
      /GROK_PROMPT_FILE_TOO_LARGE.*after read/
    )
  } finally {
    fs.statSync = originalStatSync
  }
  fs.unlinkSync(oversizedPrompt)

  fs.rmSync(currentRoot, { recursive: true, force: true })
  assert.strictEqual(fs.existsSync(currentRoot), false, 'global-only fixture root must be removed')
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  assert.strictEqual(fs.existsSync(FIXTURE_ROOT), false, 'host-installation fixture root must be removed')
  console.log('host installation tests passed mode=global-only hosts=6 workspaceHostDirs=0 selectors=blocked grokLauncher=global cursorBeta=ready')
}
