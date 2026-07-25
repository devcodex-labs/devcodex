'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  graySkillIdSet,
  isDeployableSkill,
  nonActiveSkillIdSet,
  shouldDeploySkillRelative,
  createSkillDeployFileFilter
} = require('./lib/skill-deploy-filter')
const { sha256File, parseCpSessions, verifyArtifactDigest, buildExtendedCpTable } = require('./lib/cp-digest')
const { buildClosureEvidenceControlChecks } = require('./lib/validate-closure-evidence-controls')

const ROOT = path.resolve(__dirname, '..')

// gray filter
const gray = graySkillIdSet(ROOT)
assert.ok(gray.size >= 3, 'expected >=3 gray skills')
assert.deepStrictEqual(nonActiveSkillIdSet(ROOT), gray, 'current non-active set should equal the gray set')
assert.strictEqual(isDeployableSkill({ id: 'default-active' }), true)
assert.strictEqual(isDeployableSkill({ id: 'explicit-active', lifecycleState: 'active' }), true)
for (const lifecycleState of ['gray', 'deprecated', 'retired']) {
  assert.strictEqual(isDeployableSkill({ id: lifecycleState, lifecycleState }), false)
}
for (const id of gray) {
  assert.strictEqual(shouldDeploySkillRelative(`${id}/SKILL.md`, gray), false)
}
assert.strictEqual(shouldDeploySkillRelative('cp-gate/SKILL.md', gray), true)
const filter = createSkillDeployFileFilter(ROOT)
assert.strictEqual(filter('cp-gate/SKILL.md'), true)
for (const id of gray) assert.strictEqual(filter(`${id}/SKILL.md`), false)

// digest parse + verify
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devcodex-cp-digest-'))
const artifact = path.join(tmp, '01-需求确认.md')
fs.writeFileSync(artifact, '# hello\n', 'utf8')
const hash = sha256File(artifact)
const sessions = buildExtendedCpTable({
  phases: {
    CP1: {
      status: '✅',
      artifactPath: '01-需求确认.md',
      artifactVersion: 'v0.1',
      artifactSha256: hash,
      sourceMessage: '确认 CP1',
      confirmedAt: '12:00'
    },
    CP2: { status: '⏳' },
    CP3: { status: '⏹️' }
  }
})
const parsed = parseCpSessions(sessions)
assert.ok(parsed.CP1.confirmed)
assert.strictEqual(parsed.CP1.artifactSha256, hash)
const ok = verifyArtifactDigest(tmp, parsed.CP1)
assert.strictEqual(ok.ok, true, ok.reason)
fs.writeFileSync(artifact, '# tampered\n', 'utf8')
const bad = verifyArtifactDigest(tmp, parsed.CP1)
assert.strictEqual(bad.ok, false)
assert.strictEqual(bad.reason, 'digest-mismatch')

// V100 anchor checks against source tree
const errors = []
const checks = buildClosureEvidenceControlChecks({
  ROOT,
  fs,
  path,
  read: file => fs.readFileSync(file, 'utf8'),
  err: msg => errors.push(msg),
  console
})
checks.checkV100()
assert.strictEqual(errors.length, 0, errors.join('\n'))

console.log('✓ closure evidence controls (filter + digest + V100 anchors) passed')
