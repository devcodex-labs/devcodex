'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  getRuntimeContractDigest,
  validateCapabilityDocument
} = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  getLifecycleHostAdapterDigest
} = require('../hooks/_runtime/host-adapter-identity.cjs')
const {
  getGrokLauncherAdapterDigest
} = require('./lib/grok-workspace-launcher')
const { isNarrativeMarkdownPath } = require('./lib/narrative-markdown-policy')

const ROOT = path.resolve(__dirname, '..')
const REQUIREMENTS_ROOT = process.env.DEVCODEX_SKILL_ROUTE_REQUIREMENTS_ROOT
  ? path.resolve(process.env.DEVCODEX_SKILL_ROUTE_REQUIREMENTS_ROOT)
  : path.resolve(
      ROOT,
      '..',
      '.devcodex',
      'devcodex',
      'requirements',
      '工作区Skill意图结构化与路由增强'
    )
const TRACE_FILE = path.join(
  __dirname,
  'fixtures',
  'skill-route-closure-trace.v1.json'
)

function read (file) {
  return fs.readFileSync(file, 'utf8')
}

function range (prefix, start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) =>
    `${prefix}${start + index}`
  )
}

const trace = JSON.parse(read(TRACE_FILE))
assert.strictEqual(trace.schemaVersion, 'SkillRouteClosureTraceV1')

const expectedRequirements = range('H', 1, 19)
const expectedAcceptance = range('S', 1, 18)
const expectedTests = [
  ...range('C0', 1, 9),
  ...range('R0', 1, 8),
  ...range('P0', 1, 9),
  'P10',
  'P11',
  'T01',
  'T01a',
  ...range('T0', 2, 9),
  'T10',
  'M01',
  'M02',
  'M02a',
  ...range('M0', 3, 9),
  'M08a',
  'M08b',
  'M10'
]

assert.deepStrictEqual(
  Object.keys(trace.requirementLinks).sort(),
  expectedRequirements.sort()
)
assert.deepStrictEqual(
  Object.keys(trace.acceptanceLinks).sort(),
  expectedAcceptance.sort()
)
assert.deepStrictEqual(
  Object.keys(trace.testCases).sort(),
  expectedTests.sort()
)

for (const [requirementId, acceptanceIds] of Object.entries(trace.requirementLinks)) {
  assert(acceptanceIds.length > 0, `${requirementId} has no acceptance link`)
  for (const acceptanceId of acceptanceIds) {
    assert(trace.acceptanceLinks[acceptanceId], `${requirementId} -> ${acceptanceId} missing`)
  }
}
for (const [acceptanceId, testIds] of Object.entries(trace.acceptanceLinks)) {
  assert(testIds.length > 0, `${acceptanceId} has no executable test link`)
  for (const testId of testIds) {
    assert(trace.testCases[testId], `${acceptanceId} -> ${testId} missing`)
  }
}
for (const [testId, evidence] of Object.entries(trace.testCases)) {
  assert.strictEqual(isNarrativeMarkdownPath(evidence.owner), false, `${testId} must use a machine/control owner`)
  const owner = path.join(ROOT, evidence.owner)
  assert(fs.existsSync(owner), `${testId} owner missing: ${evidence.owner}`)
  assert(
    read(owner).includes(evidence.anchor),
    `${testId} anchor missing from ${evidence.owner}: ${evidence.anchor}`
  )
}

const requirementFile = path.join(REQUIREMENTS_ROOT, '00-需求概况.md')
const designFile = path.join(REQUIREMENTS_ROOT, '02-技术方案.md')
const sourceDocsAvailable = fs.existsSync(requirementFile) && fs.existsSync(designFile)
if (sourceDocsAvailable) {
  const requirement = read(requirementFile)
  const design = read(designFile)
  for (const id of expectedRequirements) {
    assert(new RegExp(`\\| ${id} \\|`).test(requirement), `00 missing ${id}`)
  }
  for (const id of expectedAcceptance) {
    assert(new RegExp(`\\| \\*\\*?${id}\\*\\*? \\||\\| ${id} \\|`).test(requirement), `00 missing ${id}`)
  }
  for (const id of expectedTests) {
    assert(new RegExp(`\\| ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`).test(design), `02 missing ${id}`)
  }

  const terminalSection = design.slice(design.indexOf('## 8. SkillRouteModeV2'))
  for (const forbidden of [
    '当前 BLOCK',
    '默认仍 legacy',
    'SkillRouteModeV1',
    'sample:skill-route:retirement'
  ]) {
    assert.strictEqual(
      terminalSection.includes(forbidden),
      false,
      `terminal design retains superseded contract: ${forbidden}`
    )
  }
}

const packageJson = JSON.parse(read(path.join(ROOT, 'package.json')))
assert.match(packageJson.scripts['test:skill-route'], /test:skill-route-closure/)
const packagedFiles = JSON.stringify(packageJson.files || [])
assert.doesNotMatch(packagedFiles, /retired-workspace-skill-route/)

const activeFiles = [
  ...fs.readdirSync(path.join(ROOT, 'hooks', '_runtime'))
    .map(name => path.join('hooks', '_runtime', name)),
  ...fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter(name => fs.statSync(path.join(ROOT, 'scripts', name)).isFile())
    .map(name => path.join('scripts', name))
]
for (const retired of [
  'workspace-skill-auto-match.cjs',
  'workspace-skill-intent.cjs',
  'workspace-skill-catalog.cjs',
  'skill-route-retirement-gate.cjs',
  'skill-route-retirement-policy.v1.json'
]) {
  assert.strictEqual(
    activeFiles.some(file => path.basename(file) === retired),
    false,
    `retired runtime remains active: ${retired}`
  )
}

const capabilities = JSON.parse(read(path.join(
  ROOT,
  'hooks',
  '_runtime',
  'host-skill-route-capabilities.v1.json'
)))
const pass = capabilities.capabilities.filter(item => item.status === 'PASS')
const capabilityValidation = validateCapabilityDocument(capabilities, { packageRoot: ROOT })
assert.strictEqual(capabilityValidation.valid, true, capabilityValidation.errors.join(', '))
const codexVariant = 'codex-cli/exec-user-global-local-stdio'
const grokVariant = 'grok-cli-single/global-launcher-local-stdio'
assert.deepStrictEqual(
  pass.map(item => item.hostVariant).sort(),
  [codexVariant],
  'only freshly source-replayed host variants may retain PASS evidence'
)
const currentRuntimeDigest = getRuntimeContractDigest()
const currentAdapterDigests = {
  [codexVariant]: getLifecycleHostAdapterDigest('codex', {
    entrySurface: 'codex-cli-exec',
    env: {}
  }),
  [grokVariant]: getGrokLauncherAdapterDigest()
}
for (const capability of pass) {
  assert.strictEqual(
    capability.runtimeContractDigest,
    currentRuntimeDigest,
    `stale runtime PASS evidence retained for ${capability.hostVariant}`
  )
  assert.strictEqual(
    capability.hostAdapterDigest,
    currentAdapterDigests[capability.hostVariant],
    `stale host adapter PASS evidence retained for ${capability.hostVariant}`
  )
  assert.strictEqual(
    capabilityValidation.evidenceByVariant[capability.hostVariant]?.valid,
    true,
    `portable PASS evidence is invalid for ${capability.hostVariant}`
  )
}

const desktopVariant = 'codex-desktop/app-user-global-local-stdio'
const desktopCapability = capabilities.capabilities.find(item => item.hostVariant === desktopVariant)
assert(desktopCapability, `missing capability declaration for ${desktopVariant}`)
assert.strictEqual(desktopCapability.status, 'UNVERIFIED')
assert.strictEqual(desktopCapability.evidenceRef, null)
assert.strictEqual(desktopCapability.defaultEligible, false)

const grokCapability = capabilities.capabilities.find(item => item.hostVariant === grokVariant)
assert(grokCapability, `missing capability declaration for ${grokVariant}`)
assert.strictEqual(grokCapability.status, 'UNVERIFIED')
assert.strictEqual(grokCapability.evidenceRef, null)
assert.strictEqual(grokCapability.defaultEligible, false)

console.log(
  `test-skill-route-closure: ok requirements=${expectedRequirements.length} ` +
  `acceptance=${expectedAcceptance.length} executable=${expectedTests.length} ` +
  `sourceDocs=${sourceDocsAvailable ? 'checked' : 'not-packaged'}`
)
