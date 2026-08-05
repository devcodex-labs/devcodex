'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { advisoryIds, runAuditWithBoundedRecheck } = require('./lib/security-audit-runner')

const ROOT = path.resolve(__dirname, '..')
const WEBSITE = path.join(ROOT, 'website')
const POLICY_FILE = path.join(__dirname, 'fixtures', 'security-audit', 'policy.json')
const policy = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'))
const registryArg = process.argv.find(argument => argument.startsWith('--registry='))
const registry = registryArg ? registryArg.slice('--registry='.length) : policy.registry
const evidenceArg = process.argv.find(argument => argument.startsWith('--evidence-out='))
const evidencePath = evidenceArg ? path.resolve(evidenceArg.slice('--evidence-out='.length)) : ''
const auditEvidence = []

process.on('exit', () => {
  if (!evidencePath) return
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true })
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    schemaVersion: 'DevCodexSecurityAuditEvidenceV1',
    registry,
    policyReviewedAt: policy.reviewedAt,
    generatedAt: new Date().toISOString(),
    audits: auditEvidence
  }, null, 2)}\n`)
})

function npmAudit(cwd, expectedAdvisories) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const audit = runAuditWithBoundedRecheck({
    cwd,
    registry,
    expectedAdvisories,
    maxAttempts: 3,
    runAttempt: () => spawnSync(command, [
      'audit',
      '--omit=dev',
      '--json',
      `--registry=${registry}`
    ], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024
    })
  })
  auditEvidence.push(audit.evidence)
  return audit.payload
}

function compareVersion(left, right) {
  const parse = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] || 0) - (b[index] || 0)
    if (delta) return delta
  }
  return 0
}

function installedVersion(packageName) {
  return JSON.parse(fs.readFileSync(
    path.join(WEBSITE, 'node_modules', ...packageName.split('/'), 'package.json'),
    'utf8'
  )).version
}

function websiteRuntimeSources() {
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', 'docs', 'doc_build', '.rspress'].includes(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (/\.(?:[cm]?[jt]sx?)$/i.test(entry.name)) files.push(full)
    }
  }
  visit(WEBSITE)
  return files
}

assert.strictEqual(policy.schemaVersion, 'DevCodexSecurityAuditPolicyV1')
assert.strictEqual(registry, policy.registry, 'CLI registry must match the committed security audit policy')
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(policy.websiteExceptions[0].expiresOn))
assert.ok(Number.isFinite(Date.parse(policy.reviewedAt)), 'security exception must record a review timestamp')
assert.strictEqual(policy.officialEvidence.advisoryUrl, 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2')
assert.strictEqual(policy.officialEvidence.patchedReactRouterVersion, '8.3.0')
assert.strictEqual(policy.officialEvidence.affectedSurface, 'unstable RSC APIs')
assert.strictEqual(policy.registryEvidence.registry, registry)
assert.ok(Number.isFinite(Date.parse(policy.registryEvidence.checkedAt)), 'registry evidence must record a timestamp')
assert.strictEqual(policy.registryEvidence.rspressCore.version, '2.0.19')
assert.strictEqual(policy.registryEvidence.rspressCore.reactRouterDomRange, '^7.18.1')
assert.strictEqual(policy.registryEvidence.patchedReactRouter.version, '8.3.0')
assert.strictEqual(policy.registryEvidence.patchedReactRouter.nodeEngine, '>=22.22.0')
assert.strictEqual(policy.registryEvidence.reactRouterDomPatchedVersionAvailable, false)

const rootAudit = npmAudit(ROOT, policy.rootAllowedAdvisories)
assert.strictEqual(rootAudit.metadata?.vulnerabilities?.total, 0, 'root production dependency audit must remain clean')
assert.deepStrictEqual(advisoryIds(rootAudit), policy.rootAllowedAdvisories)

const allowedAdvisories = policy.websiteExceptions.map(item => item.advisoryId).sort()
const today = new Date().toISOString().slice(0, 10)
for (const exception of policy.websiteExceptions) {
  assert.ok(today <= exception.expiresOn, `${exception.advisoryId} exception expired on ${exception.expiresOn}`)
  const reviewDate = new Date(policy.reviewedAt)
  const expiryDate = new Date(`${exception.expiresOn}T23:59:59.999Z`)
  assert.ok(expiryDate - reviewDate <= 30 * 24 * 60 * 60 * 1000, `${exception.advisoryId} exception exceeds the 30-day review horizon`)
  assert.strictEqual(exception.disposition, 'not-applicable-to-static-rspress-site')
  assert.ok(exception.replacementTrigger)
}

const websitePackage = path.join(WEBSITE, 'package.json')
if (fs.existsSync(websitePackage)) {
  const websiteAudit = npmAudit(WEBSITE, allowedAdvisories)
  assert.deepStrictEqual(advisoryIds(websiteAudit), allowedAdvisories, 'website advisory set changed; review before updating policy')
  const vulnerabilityPackages = Object.keys(websiteAudit.vulnerabilities || {}).sort()
  assert.deepStrictEqual(
    vulnerabilityPackages,
    [...policy.websiteAllowedPackages].sort(),
    'website vulnerability dependency chain changed'
  )

  for (const [packageName, minimum] of Object.entries(policy.minimumVersions)) {
    const installed = installedVersion(packageName)
    assert.ok(
      compareVersion(installed, minimum) >= 0,
      `${packageName}@${installed} is below the security floor ${minimum}`
    )
  }

  const sourceRecords = websiteRuntimeSources().map(file => ({
    file,
    content: fs.readFileSync(file, 'utf8')
  }))
  for (const pattern of policy.forbiddenWebsiteRuntimePatterns) {
    const match = sourceRecords.find(record => record.content.includes(pattern))
    assert.ok(!match, `website runtime source enables unsupported RSC surface ${pattern}: ${match?.file}`)
  }

  console.log(
    `security audit passed root=0 websiteExceptions=${allowedAdvisories.join(',')} ` +
    `expires=${policy.websiteExceptions[0].expiresOn} rspress=${installedVersion('@rspress/core')} ` +
    `reactRouter=${installedVersion('react-router')} braceExpansion=${installedVersion('brace-expansion')}`
  )
} else {
  const websiteReadme = fs.readFileSync(path.join(WEBSITE, 'README.md'), 'utf8')
  assert.match(websiteReadme, /不进入公开 Git 默认跟踪/)
  assert.match(websiteReadme, /website 视为 optional/)
  console.log(
    `security audit passed root=0 website=optional-absent ` +
    `policyExceptions=${allowedAdvisories.join(',')} expires=${policy.websiteExceptions[0].expiresOn}`
  )
}
