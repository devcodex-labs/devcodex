'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  getRuntimeContractDigest
} = require('../hooks/_runtime/skill-route-mode.cjs')
const {
  getLifecycleHostAdapterDigest
} = require('../hooks/_runtime/host-adapter-identity.cjs')

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
assert.strictEqual(pass.length, 1)
assert.strictEqual(
  pass[0].hostVariant,
  'codex-cli/exec-user-global-local-stdio'
)
assert.strictEqual(
  pass[0].runtimeContractDigest,
  getRuntimeContractDigest({
    globalRuntime: {
      status: 'resolved',
      root: path.join(ROOT, 'skills')
    }
  })
)
assert.strictEqual(
  pass[0].hostAdapterDigest,
  getLifecycleHostAdapterDigest('codex')
)
assert.match(pass[0].evidenceDigest, /^[a-f0-9]{64}$/)
assert.strictEqual(pass[0].defaultEligible, true)

console.log(
  `test-skill-route-closure: ok requirements=${expectedRequirements.length} ` +
  `acceptance=${expectedAcceptance.length} executable=${expectedTests.length} ` +
  `sourceDocs=${sourceDocsAvailable ? 'checked' : 'not-packaged'}`
)
