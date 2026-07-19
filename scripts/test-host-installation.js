'use strict'

const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { buildDeploymentDescriptors } = require('./lib/deployment-descriptors')
const { buildCliHostUtils } = require('./lib/cli-host-utils')

const ROOT = path.resolve(__dirname, '..')
const INDEX = path.join(ROOT, 'index.js')
const FIXTURE_ROOT = path.join(os.tmpdir(), 'devcodex-host-installation-contract-v1')

function run(args, cwd) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' }
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
    CODEX_SOURCES: [
      { from: 'hooks/_runtime', to: path.join('.codex', 'hooks', '_runtime') },
      { from: 'codex', to: '.codex' }
    ]
  }
}

fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
const hostUtils = buildCliHostUtils({
  fs,
  path,
  isPlainObject: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  claudeMcpJson: { mcpServers: {} }
})

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
const sourceDryRun = run(['init', '--host', 'grok', '--dry-run'], ROOT)
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
  '.grok/hooks/devcodex.json',
  '.grok/hooks/_runtime/lifecycle-host-adapters.cjs',
  '.devcodex/managed/deployment-manifest.json'
]) {
  assert(fs.existsSync(path.join(managedRoot, relative)), `managed install missing ${relative}`)
}
const managedInspection = hostUtils.inspectHostInstructionSurfaces(managedRoot)
assert.strictEqual(managedInspection.status, 'ready', JSON.stringify(managedInspection.issues))
const managedManifest = JSON.parse(fs.readFileSync(
  path.join(managedRoot, '.devcodex', 'managed', 'deployment-manifest.json'),
  'utf8'
))
const managedSurfaces = new Set(managedManifest.entries.map(entry => entry.surface))
for (const surface of ['grok', 'shared-kernel', 'shared-agent-skills', 'full-fallback']) {
  assert(managedSurfaces.has(surface), `managed manifest missing ${surface}`)
}

// In a workspace namespace, a project-root Grok install stays lightweight and resolves
// the parent kernel/Skills through one locally discoverable bridge Skill.
const bridgeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-grok-workspace-bridge-'))
const bridgeProject = path.join(bridgeWorkspace, 'project-a')
fs.mkdirSync(path.join(bridgeWorkspace, '.devcodex'), { recursive: true })
fs.mkdirSync(bridgeProject, { recursive: true })
fs.writeFileSync(
  path.join(bridgeWorkspace, '.devcodex', 'layout.json'),
  JSON.stringify({ mode: 'workspace-namespace' }, null, 2) + '\n',
  'utf8'
)
fs.writeFileSync(path.join(bridgeProject, 'package.json'), '{"name":"project-a"}\n', 'utf8')
const bridgeInstall = run(['update', '--host', 'grok'], bridgeProject)
assert.strictEqual(bridgeInstall.status, 0, bridgeInstall.stderr || bridgeInstall.stdout)
for (const relative of [
  'AGENTS.md',
  '.grok/skills/devcodex-workspace/SKILL.md',
  '.grok/mcp/workspace-bridge.cjs',
  '.grok/config.toml',
  '.grok/hooks/devcodex.json',
  '.grok/hooks/_runtime/lifecycle-host-adapters.cjs'
]) {
  assert(fs.existsSync(path.join(bridgeProject, relative)), `workspace bridge install missing ${relative}`)
}
assert.strictEqual(
  fs.readFileSync(path.join(bridgeProject, 'AGENTS.md'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'host-projections', 'AGENTS.workspace-bridge.md'), 'utf8')
)
assert(!fs.existsSync(path.join(bridgeProject, '.agents')), 'workspace bridge must not duplicate parent .agents tree')
const bridgeConfig = fs.readFileSync(path.join(bridgeProject, '.grok', 'config.toml'), 'utf8')
assert.match(bridgeConfig, /\[mcp_servers\.devcodex-memory\]/)
assert.match(bridgeConfig, /\[mcp_servers\.devcodex-profile\]/)
const bridgeInspection = hostUtils.inspectHostInstructionSurfaces(bridgeProject)
assert.strictEqual(bridgeInspection.status, 'ready', JSON.stringify(bridgeInspection.issues))
assert.strictEqual(bridgeInspection.entries.find(item => item.surface === 'shared').workspaceBridge, true)
const bridgeManifest = JSON.parse(fs.readFileSync(
  path.join(bridgeWorkspace, '.devcodex', 'project-a', 'managed', 'deployment-manifest.json'),
  'utf8'
))
const bridgeSurfaces = new Set(bridgeManifest.entries.map(entry => entry.surface))
for (const surface of ['grok', 'grok-workspace-bridge']) {
  assert(bridgeSurfaces.has(surface), `workspace bridge manifest missing ${surface}`)
}
for (const surface of ['shared-kernel', 'shared-agent-skills', 'full-fallback']) {
  assert(!bridgeSurfaces.has(surface), `workspace bridge manifest must not duplicate ${surface}`)
}
const bridgeRepeat = run(['init', '--host', 'grok', '--dry-run'], bridgeProject)
assert.strictEqual(bridgeRepeat.status, 0, bridgeRepeat.stderr || bridgeRepeat.stdout)

const mergeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-grok-config-merge-'))
const mergeProject = path.join(mergeWorkspace, 'project-b')
fs.mkdirSync(path.join(mergeWorkspace, '.devcodex'), { recursive: true })
fs.mkdirSync(path.join(mergeProject, '.grok'), { recursive: true })
fs.writeFileSync(path.join(mergeWorkspace, '.devcodex', 'layout.json'), '{"mode":"workspace-namespace"}\n', 'utf8')
fs.writeFileSync(path.join(mergeProject, 'package.json'), '{"name":"project-b"}\n', 'utf8')
fs.writeFileSync(path.join(mergeProject, '.grok', 'config.toml'), '[plugins]\nenabled = ["project-owned"]\n', 'utf8')
const mergeInstall = run(['update', '--host', 'grok'], mergeProject)
assert.strictEqual(mergeInstall.status, 0, mergeInstall.stderr || mergeInstall.stdout)
const mergedConfig = fs.readFileSync(path.join(mergeProject, '.grok', 'config.toml'), 'utf8')
assert.match(mergedConfig, /\[plugins\]\nenabled = \["project-owned"\]/)
assert.match(mergedConfig, /\[mcp_servers\.devcodex-memory\]/)
assert.match(mergedConfig, /\[mcp_servers\.devcodex-profile\]/)

// The legacy default remains the three original hosts; explicit all adds Gemini and Grok.
const defaults = buildDeploymentDescriptors(ROOT, ['copilot', 'claude', 'codex'], deploymentOptions())
const all = buildDeploymentDescriptors(ROOT, ['all'], deploymentOptions())
const bridgeDescriptors = buildDeploymentDescriptors(ROOT, ['grok'], {
  ...deploymentOptions(),
  grokWorkspaceBridge: true
})
const defaultSurfaces = new Set(defaults.map(item => item.surface))
const allSurfaces = new Set(all.map(item => item.surface))
const bridgeDescriptorSurfaces = new Set(bridgeDescriptors.map(item => item.surface))
assert(!defaultSurfaces.has('gemini'))
assert(!defaultSurfaces.has('grok'))
for (const surface of ['copilot', 'claude', 'codex', 'shared-kernel', 'full-fallback']) {
  assert(defaultSurfaces.has(surface), `default descriptor missing ${surface}`)
}
for (const surface of ['gemini', 'grok']) assert(allSurfaces.has(surface), `all descriptor missing ${surface}`)
assert(bridgeDescriptorSurfaces.has('grok-workspace-bridge'))
for (const surface of ['shared-kernel', 'shared-agent-skills', 'full-fallback']) {
  assert(!bridgeDescriptorSurfaces.has(surface), `bridge descriptor must omit ${surface}`)
}

console.log('host installation tests passed selectors=5 dryRunWrites=0 collision=blocked managedManifest=verified workspaceBridge=verified defaultHosts=3')
