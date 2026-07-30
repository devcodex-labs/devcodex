'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const WEBSITE = path.join(ROOT, 'website')
const POLICY_FILE = path.join(__dirname, 'fixtures', 'security-audit', 'policy.json')
const policy = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'))
const registryArg = process.argv.find(argument => argument.startsWith('--registry='))
const registry = registryArg ? registryArg.slice('--registry='.length) : policy.registry

function npmAudit(cwd) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(command, [
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
  assert.ok([0, 1].includes(result.status), `npm audit could not complete in ${cwd}: ${result.stderr || result.error?.message}`)
  let payload
  try {
    payload = JSON.parse(String(result.stdout || ''))
  } catch (error) {
    assert.fail(`npm audit returned invalid JSON in ${cwd}: ${error.message}\n${result.stdout}\n${result.stderr}`)
  }
  return payload
}

function advisoryIds(payload) {
  const ids = new Set()
  for (const vulnerability of Object.values(payload.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (!via || typeof via !== 'object' || typeof via.url !== 'string') continue
      const match = via.url.match(/\/(GHSA-[A-Za-z0-9-]+)$/)
      if (match) ids.add(match[1])
    }
  }
  return [...ids].sort()
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

const rootAudit = npmAudit(ROOT)
assert.strictEqual(rootAudit.metadata?.vulnerabilities?.total, 0, 'root production dependency audit must remain clean')
assert.deepStrictEqual(advisoryIds(rootAudit), policy.rootAllowedAdvisories)

const allowedAdvisories = policy.websiteExceptions.map(item => item.advisoryId).sort()
const today = new Date().toISOString().slice(0, 10)
for (const exception of policy.websiteExceptions) {
  assert.ok(today <= exception.expiresOn, `${exception.advisoryId} exception expired on ${exception.expiresOn}`)
  assert.strictEqual(exception.disposition, 'not-applicable-to-static-rspress-site')
  assert.ok(exception.replacementTrigger)
}

const websitePackage = path.join(WEBSITE, 'package.json')
if (fs.existsSync(websitePackage)) {
  const websiteAudit = npmAudit(WEBSITE)
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
