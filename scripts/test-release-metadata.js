#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
const publicCi = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
const publishWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8')

const errors = []

function expect(condition, message) {
  if (!condition) errors.push(message)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function readUrl(field) {
  if (typeof field === 'string') return field
  if (field && typeof field === 'object' && typeof field.url === 'string') return field.url
  return ''
}

const keywords = Array.isArray(pkg.keywords)
  ? pkg.keywords.filter(item => nonEmptyString(item))
  : []
const files = Array.isArray(pkg.files)
  ? pkg.files.filter(item => nonEmptyString(item))
  : []
const pluginKeywords = Array.isArray(plugin.keywords)
  ? plugin.keywords.filter(item => nonEmptyString(item))
  : []
const pluginCategories = Array.isArray(plugin.categories)
  ? plugin.categories.filter(item => nonEmptyString(item))
  : []

expect(nonEmptyString(pkg.name), 'package.json name 不能为空')
expect(nonEmptyString(pkg.version), 'package.json version 不能为空')
expect(nonEmptyString(pkg.description), 'package.json description 不能为空')
expect(keywords.length >= 3, 'package.json keywords 至少需要 3 个非空条目')
expect(nonEmptyString(pkg.license), 'package.json license 不能为空')
expect(nonEmptyString(readUrl(pkg.repository)), 'package.json repository.url 不能为空')
expect(nonEmptyString(readUrl(pkg.bugs)), 'package.json bugs.url 不能为空')
expect(nonEmptyString(pkg.homepage), 'package.json homepage 不能为空')
expect(nonEmptyString(pkg.engines && pkg.engines.node), 'package.json engines.node 不能为空')
expect(pkg.engines.node === '>=18.17.0', 'package.json engines.node 必须匹配 recursive fs API 的精确最低版本 >=18.17.0')
expect(lock.packages?.['']?.engines?.node === pkg.engines.node, 'package-lock 根 engines.node 必须与 package.json 一致')
expect(publicCi.includes('node: 18.17.0'), '公共 CI 必须验证精确最低 Node 18.17.0')
expect(publicCi.includes('node: 26.x'), '公共 CI 必须验证前瞻 Node 26 current compatibility')
expect(publicCi.includes('route: test:windows-control-plane'), '公共 CI 必须在 Windows 运行控制面路线')
expect(publicCi.includes('name: Full quality (Node 24.17)'), '公共 CI 全量质量门必须使用发布 Node 24.17')
expect(publicCi.includes('name: Package boundary (Node 24.17)'), '公共 CI package job 必须只声明实际执行的 package boundary')
expect(!publicCi.includes('Website and package'), '公共 CI 不得把条件缺席的网站构建表述为绿色证据')
expect(publicCi.includes('set -euo pipefail'), '公共 CI 必须让 full plan 管道失败关闭')
expect(
  publicCi.includes('node scripts/run-validation.js --route full --actor trusted-ci') &&
    publicCi.includes('--authority-source "${AUTHORITY_SOURCE}"') &&
    publicCi.includes('--policy-digest "${POLICY_DIGEST}"') &&
    publicCi.includes('--plan --json'),
  '公共 CI 必须由 trusted-ci 先物化 full/V3 精确计划'
)
expect(
  publicCi.includes('--route full --actor trusted-ci') &&
    publicCi.includes('--approve-plan "${BUDGET_DIGEST}"'),
  '公共 CI 必须把同一 BudgetCard 摘要与 trusted-ci 角色绑定回执行'
)
expect(publishWorkflow.includes('set -euo pipefail'), 'Publish workflow 必须让 package plan 管道失败关闭')
expect(
  publishWorkflow.includes('node scripts/run-validation.js --route package-release --purpose release --actor release-pipeline') &&
    publishWorkflow.includes('--plan --json'),
  'Publish workflow 必须由 release-pipeline 先物化 release/V3 精确计划'
)
expect(publishWorkflow.includes('plan?.budgetCard?.digest'), 'Publish workflow 必须读取 BudgetCard 精确摘要')
expect(
  publishWorkflow.includes('--route package-release --purpose release --actor release-pipeline') &&
    publishWorkflow.includes('--approve-plan "${BUDGET_DIGEST}"'),
  'Publish workflow 必须把同一 BudgetCard 摘要与 release-pipeline 角色绑定回执行'
)
expect(!publishWorkflow.includes('run: npm run test:package-release'), 'Publish workflow 不得使用缺少非交互计划批准的旧入口')
expect(
  pkg.scripts?.prepublishOnly === 'node scripts/verify-release-validation-receipt.js',
  'prepublishOnly 必须消费当前候选的稳定 release 终态，禁止再次无授权地执行全量验证'
)
for (const [scriptName, command] of Object.entries({
  'test:actual-candidate-evidence': 'node scripts/test-actual-candidate-evidence.js',
  'test:dangerous-command-context': 'node scripts/test-dangerous-command-context.js',
  'test:mcp-runtime-closure:package': 'node scripts/test-mcp-runtime-closure.js --packlist-only',
  'test:session-route-consumers': 'node scripts/test-session-route-consumers.js',
  'test:task-admission-authority': 'node scripts/test-task-admission-authority.js'
})) {
  expect(pkg.scripts?.[scriptName] === command, `package.json ${scriptName} 必须注册当前控制面回归入口`)
}
expect(nonEmptyString(pkg.publishConfig && pkg.publishConfig.registry), 'package.json publishConfig.registry 不能为空')
expect(nonEmptyString(pkg.publishConfig && pkg.publishConfig.access), 'package.json publishConfig.access 不能为空')
expect(files.length > 0, 'package.json files 不能为空')
expect(
  nonEmptyString(pkg.main) ||
  (pkg.exports && Object.keys(pkg.exports).length > 0) ||
  (pkg.bin && Object.keys(pkg.bin).length > 0),
  'package.json 至少需要 main / exports / bin 之一'
)

expect(nonEmptyString(plugin.version), 'plugin.json version 不能为空')
expect(plugin.version === pkg.version, 'plugin.json version 必须与 package.json version 一致')
expect(nonEmptyString(plugin.description), 'plugin.json description 不能为空')
expect(nonEmptyString(plugin.repository), 'plugin.json repository 不能为空')
expect(nonEmptyString(plugin.homepage), 'plugin.json homepage 不能为空')
expect(nonEmptyString(plugin.license), 'plugin.json license 不能为空')
expect(pluginKeywords.length >= 3, 'plugin.json keywords 至少需要 3 个非空条目')
expect(pluginCategories.length > 0, 'plugin.json categories 不能为空')
if (errors.length) {
  console.error('\x1b[31m✗ Release metadata checks failed:\x1b[0m')
  for (const message of errors) {
    console.error(`  - ${message}`)
  }
  process.exit(1)
}

console.log('\x1b[32m✓ Release metadata checks passed\x1b[0m')
