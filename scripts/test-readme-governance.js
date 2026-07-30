#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  createCanonicalAwareReader,
  evaluatePublicReadmeContract
} = require('./lib/canonical-consumer-contracts')

const ROOT = path.resolve(__dirname, '..')
const failures = []
const readAbsolute = createCanonicalAwareReader(ROOT, file => fs.readFileSync(file, 'utf8'))

function read(file) {
  return readAbsolute(path.join(ROOT, file))
}

function mustInclude(file, needle) {
  const content = read(file)
  if (file === 'README.md' && evaluatePublicReadmeContract(content).valid) return
  if (!content.includes(needle)) failures.push(`${file} missing "${needle}"`)
}

function mustExist(file) {
  if (!readAbsolute.exists(path.join(ROOT, file))) failures.push(`missing file: ${file}`)
}

function assertOrder(file, headings) {
  const text = read(file)
  let previous = -1
  for (const heading of headings) {
    const index = text.indexOf(heading)
    if (index === -1) {
      failures.push(`${file} missing heading "${heading}"`)
      return
    }
    if (index < previous) {
      failures.push(`${file} heading order drift: "${heading}" appears before an earlier user-path section`)
      return
    }
    previous = index
  }
}

const plugin = JSON.parse(read('plugin.json'))
const publicReadmeContract = evaluatePublicReadmeContract(read('README.md'))
if (!publicReadmeContract.valid) {
  failures.push(`README.md public contract missing: ${publicReadmeContract.missing.join(', ')}`)
}
for (const [id, file] of [
  ['readme-authoring', 'skills/readme-authoring/SKILL.md'],
  ['audit-readme', 'skills/audit-readme/SKILL.md']
]) {
  mustExist(file)
  if (!plugin.skills.some(skill => skill.id === id && skill.file === file)) {
    failures.push(`plugin.json missing ${id} skill entry`)
  }
}

for (const [file, needle] of [
  ['skills/readme-authoring/SKILL.md', 'primaryAudience'],
  ['skills/readme-authoring/SKILL.md', 'userJourney'],
  ['skills/readme-authoring/SKILL.md', 'consumerMap'],
  ['skills/readme-authoring/SKILL.md', '用户 / 使用者'],
  ['skills/audit-readme/SKILL.md', 'RM-1 用户路径完整性'],
  ['skills/audit-readme/SKILL.md', 'RM-6 消费链一致性'],
  ['skills/dev-docs/SKILL.md', 'readme-authoring'],
  ['skills/dev-docs/SKILL.md', 'audit-readme'],
  ['skills/dev-init/SKILL.md', 'readme-authoring'],
  ['skills/document-sync/SKILL.md', 'readme-authoring'],
  ['skills/document-sync/SKILL.md', 'audit-readme'],
  ['skills/audit-document/SKILL.md', 'audit-readme'],
  ['skills/audit-execution-guide/SKILL.md', 'audit-readme'],
  ['prompts/project-readme.prompt.md', '用户 / 使用者优先'],
  ['README.md', 'readme-authoring'],
  ['README.md', 'audit-readme'],
  ['website/docs/intro/index.md', 'readme-authoring'],
  ['website/docs/specs/directory-structure.md', 'audit-readme']
]) {
  mustInclude(file, needle)
}

assertOrder('prompts/project-readme.prompt.md', [
  '## 项目简介',
  '## 适用对象与使用场景',
  '## 快速开始',
  '## 常见用法',
  '## 配置',
  '## 文档与接口',
  '## 常见问题与排错',
  '## 开发与贡献'
])

const pkg = JSON.parse(read('package.json'))
if (pkg.scripts['test:readme-governance'] !== 'node scripts/test-readme-governance.js') {
  failures.push('package.json missing test:readme-governance script')
}
const testAllScript = pkg.scripts['test:all'] || ''
const testScript = pkg.scripts.test || ''
const validationManifest = JSON.parse(read('scripts/validation-manifest.json'))
const readmeGovernanceNode = validationManifest.nodes.find(node => node.id === 'readme-governance')
const fullRouteNodes = validationManifest.routes.full && validationManifest.routes.full.nodes
const readmeGovernanceCovered = Boolean(
  testAllScript.trim() === 'npm test' &&
  testScript === 'node scripts/run-validation.js --route full' &&
  readmeGovernanceNode &&
  readmeGovernanceNode.command === 'node' &&
  Array.isArray(readmeGovernanceNode.args) &&
  readmeGovernanceNode.args.length === 1 &&
  readmeGovernanceNode.args[0] === 'scripts/test-readme-governance.js' &&
  Array.isArray(fullRouteNodes) &&
  fullRouteNodes.includes('readme-governance')
)
if (!readmeGovernanceCovered) {
  failures.push('validation full route missing readme governance targeted node')
}

if (failures.length) {
  console.error('README governance checks failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('README governance checks passed')
